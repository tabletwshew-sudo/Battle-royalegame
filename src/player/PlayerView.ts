import type { Group, Mesh, Object3D } from "three/webgpu";
import type { CameraSubject } from "../shared/sim/CameraRig";
import { clamp, lerp, lerpAngle } from "../shared/sim/MathUtil";
import type { MovementConfig } from "../shared/sim/MovementConfig";
import { type MoveMode, PICKAXE_SLOT, type PlayerState } from "../shared/sim/PlayerSim";
import { CharacterAnimator } from "./CharacterAnimator";
import { buildCharacterRig, type CharacterPalette, type CharacterRig, defaultPalette } from "./CharacterRig";
import { attachmentPivot, buildGlider, buildPickaxe } from "./Gear";

/** Interpolated player values for one rendered frame. */
export interface PlayerFrame extends CameraSubject {
  vx: number;
  vy: number;
  vz: number;
  bodyYaw: number;
  grounded: boolean;
  mode: MoveMode;
  /** 0..1 progress through timed modes (mantle, hurdle, roll, splat). */
  progress: number;
  sprinting: boolean;
  glideBank: number;
  equipSlot: number;
  holstered: boolean;
}

export function makePlayerFrame(): PlayerFrame {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    crouchBlend: 0,
    adsBlend: 0,
    shoulderBlend: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    bodyYaw: 0,
    grounded: true,
    mode: "walk",
    progress: 0,
    sprinting: false,
    glideBank: 0,
    equipSlot: 1,
    holstered: false,
  };
}

/** Progress (0..1) through the timed part of a mode. */
function modeProgress(state: PlayerState, config: MovementConfig): number {
  switch (state.mode) {
    case "mantle":
    case "hurdle":
      return clamp(state.modeTime / Math.max(state.travelDuration, 1e-6), 0, 1);
    case "roll":
      return clamp(state.modeTime / config.rollTime, 0, 1);
    case "splat":
      return clamp(state.modeTime / config.splatTime, 0, 1);
    default:
      return 0;
  }
}

/** Blends two sim states; `alpha` 0 = previous tick, 1 = latest tick. */
export function interpolatePlayer(
  previous: PlayerState,
  current: PlayerState,
  alpha: number,
  config: MovementConfig,
  out: PlayerFrame,
): PlayerFrame {
  out.x = lerp(previous.x, current.x, alpha);
  out.y = lerp(previous.y, current.y, alpha);
  out.z = lerp(previous.z, current.z, alpha);
  out.vx = lerp(previous.vx, current.vx, alpha);
  out.vy = lerp(previous.vy, current.vy, alpha);
  out.vz = lerp(previous.vz, current.vz, alpha);
  out.yaw = lerpAngle(previous.yaw, current.yaw, alpha);
  out.pitch = lerp(previous.pitch, current.pitch, alpha);
  out.bodyYaw = lerpAngle(previous.bodyYaw, current.bodyYaw, alpha);
  out.crouchBlend = lerp(previous.crouchBlend, current.crouchBlend, alpha);
  out.adsBlend = lerp(previous.adsBlend, current.adsBlend, alpha);
  out.shoulderBlend = lerp(previous.shoulderBlend, current.shoulderBlend, alpha);
  out.glideBank = lerp(previous.glideBank, current.glideBank, alpha);
  const latest = alpha < 0.5 ? previous : current;
  out.grounded = latest.grounded;
  out.mode = current.mode;
  out.progress = current.mode === previous.mode ? lerp(modeProgress(previous, config), modeProgress(current, config), alpha) : modeProgress(current, config);
  out.sprinting = latest.sprinting;
  out.equipSlot = current.equipSlot;
  out.holstered = current.holstered;
  return out;
}

/** Visual for one character: the skinned rig, its procedural animator and its gear. */
export class PlayerView {
  readonly rig: CharacterRig;
  private readonly animator: CharacterAnimator;
  private readonly glider: Mesh;
  private readonly gliderPivot: Group;
  private readonly pickaxeInHand: Group;
  private readonly pickaxeOnBack: Group;
  /** Glider open amount (0 folded .. 1 open). */
  private gliderOpen = 0;

  constructor(palette: CharacterPalette = defaultPalette()) {
    this.rig = buildCharacterRig(palette);
    this.animator = new CharacterAnimator(this.rig);

    this.glider = buildGlider();
    this.gliderPivot = attachmentPivot(this.glider);
    // The hand bar sits above the head where the raised hands are.
    this.gliderPivot.position.set(0, 2.3, -0.05);
    this.gliderPivot.visible = false;
    this.rig.mesh.add(this.gliderPivot);

    // In hand: grip in the right hand, handle forward and up, head on top.
    this.pickaxeInHand = attachmentPivot(buildPickaxe());
    this.pickaxeInHand.position.set(0, -0.07, 0);
    this.pickaxeInHand.rotation.set(-1.25, 0, 0);
    this.rig.bones.handR.add(this.pickaxeInHand);
    // On the back: diagonal across the backpack.
    this.pickaxeOnBack = attachmentPivot(buildPickaxe());
    this.pickaxeOnBack.position.set(0.05, -0.12, 0.29);
    this.pickaxeOnBack.rotation.set(0, Math.PI, 0.7);
    this.rig.bones.chest.add(this.pickaxeOnBack);
  }

  get object(): Object3D {
    return this.rig.mesh;
  }

  /**
   * Fades the model out when the camera is pressed close to it (a wall right
   * behind the player), so the view never ends up inside the character.
   * @param cameraDistance distance from the camera to the player's head, metres
   */
  setCameraDistance(cameraDistance: number): void {
    this.rig.setOpacity((cameraDistance - PlayerView.FADE_NEAR) / (PlayerView.FADE_FAR - PlayerView.FADE_NEAR));
  }

  /** Camera distance (to the head) below which the model is fully hidden / starts fading. */
  static readonly FADE_NEAR = 0.85;
  static readonly FADE_FAR = 1.05;

  /** Plays the landing squash. */
  land(speed: number): void {
    this.animator.land(speed);
  }

  /**
   * Poses the model for a frame.
   * @param lookYaw/lookPitch the live view angles (may be newer than the sim tick)
   */
  update(frame: PlayerFrame, lookYaw: number, lookPitch: number, dt: number): void {
    const mesh = this.rig.mesh;
    mesh.position.set(frame.x, frame.y, frame.z);
    mesh.rotation.y = frame.bodyYaw;
    this.animator.update(
      {
        mode: frame.mode,
        progress: frame.progress,
        vx: frame.vx,
        vy: frame.vy,
        vz: frame.vz,
        bodyYaw: frame.bodyYaw,
        lookYaw,
        lookPitch,
        grounded: frame.grounded,
        crouchBlend: frame.crouchBlend,
        adsBlend: frame.adsBlend,
        sprinting: frame.sprinting,
        glideBank: frame.glideBank,
      },
      dt,
    );
    this.updateGear(frame, dt);
  }

  dispose(): void {
    this.rig.dispose();
    for (const object of [this.glider, ...this.pickaxeInHand.children, ...this.pickaxeOnBack.children]) {
      const mesh = object as Mesh;
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
    }
  }

  private updateGear(frame: PlayerFrame, dt: number): void {
    // Glider unfolds over ~0.25 s and folds away just as fast.
    const target = frame.mode === "glide" ? 1 : 0;
    this.gliderOpen = clamp(this.gliderOpen + Math.sign(target - this.gliderOpen) * dt * 4, 0, 1);
    this.gliderPivot.visible = this.gliderOpen > 0.01;
    const open = this.gliderOpen * this.gliderOpen * (3 - 2 * this.gliderOpen);
    this.gliderPivot.scale.set(open, 0.3 + 0.7 * open, open);
    this.gliderPivot.rotation.set(-0.12, 0, -frame.glideBank * 0.35);

    const hasPickaxe = frame.equipSlot === PICKAXE_SLOT;
    const inHand = hasPickaxe && !frame.holstered;
    this.pickaxeInHand.visible = inHand;
    this.pickaxeOnBack.visible = hasPickaxe && !inHand;
  }
}
