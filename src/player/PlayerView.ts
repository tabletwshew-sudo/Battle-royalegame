import type { Object3D } from "three/webgpu";
import type { CameraSubject } from "../shared/sim/CameraRig";
import { lerp, lerpAngle } from "../shared/sim/MathUtil";
import type { PlayerState } from "../shared/sim/PlayerSim";
import { CharacterAnimator } from "./CharacterAnimator";
import { buildCharacterRig, type CharacterPalette, type CharacterRig, defaultPalette } from "./CharacterRig";

/** Interpolated player values for one rendered frame. */
export interface PlayerFrame extends CameraSubject {
  vx: number;
  vy: number;
  vz: number;
  bodyYaw: number;
  grounded: boolean;
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
  };
}

/** Blends two sim states; `alpha` 0 = previous tick, 1 = latest tick. */
export function interpolatePlayer(previous: PlayerState, current: PlayerState, alpha: number, out: PlayerFrame): PlayerFrame {
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
  out.grounded = alpha < 0.5 ? previous.grounded : current.grounded;
  return out;
}

/** Visual for one character: the skinned rig plus its procedural animator. */
export class PlayerView {
  readonly rig: CharacterRig;
  private readonly animator: CharacterAnimator;

  constructor(palette: CharacterPalette = defaultPalette()) {
    this.rig = buildCharacterRig(palette);
    this.animator = new CharacterAnimator(this.rig);
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
        vx: frame.vx,
        vy: frame.vy,
        vz: frame.vz,
        bodyYaw: frame.bodyYaw,
        lookYaw,
        lookPitch,
        grounded: frame.grounded,
        crouchBlend: frame.crouchBlend,
        adsBlend: frame.adsBlend,
      },
      dt,
    );
  }

  dispose(): void {
    this.rig.dispose();
  }
}
