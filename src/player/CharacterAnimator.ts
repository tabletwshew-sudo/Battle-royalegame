import type { MoveMode } from "../shared/sim/PlayerSim";
import { clamp, wrapAngle } from "../shared/sim/MathUtil";
import { BONE_NAMES, type BoneName, type CharacterRig } from "./CharacterRig";

/**
 * Procedural animation for the character rig. Every movement mode has its
 * own pose function (locomotion with walk/run/sprint/strafe/crouch/air,
 * slide, mantle, hurdle, roll, skydive, glide, splat); the poses are blended
 * by per-mode weights that ease toward the current mode. Purely cosmetic:
 * hitboxes (M5) follow the sim state, not these bones.
 *
 * Rotation conventions: positive X swings a limb forward (toward -Z) and
 * tilts the body's top backward; negative X on the hips leans forward.
 */
export interface AnimationInput {
  mode: MoveMode;
  /** 0..1 progress through timed modes (mantle, hurdle, roll, splat). */
  progress: number;
  /** Velocity in world space, m/s. */
  vx: number;
  vy: number;
  vz: number;
  /** Facing of the body and the look direction, radians. */
  bodyYaw: number;
  lookYaw: number;
  lookPitch: number;
  grounded: boolean;
  crouchBlend: number;
  adsBlend: number;
  sprinting: boolean;
  /** -1..1 glider bank. */
  glideBank: number;
}

type Euler3 = [number, number, number];

/** Rotations for every bone plus how far the hips drop below their rest height. */
interface Pose {
  bones: Record<BoneName, Euler3>;
  hipsDrop: number;
}

const MODES: readonly MoveMode[] = ["walk", "slide", "mantle", "hurdle", "roll", "skydive", "glide", "splat"];

function makePose(): Pose {
  const bones = {} as Record<BoneName, Euler3>;
  for (const name of BONE_NAMES) bones[name] = [0, 0, 0];
  return { bones, hipsDrop: 0 };
}

function resetPose(pose: Pose): void {
  for (const name of BONE_NAMES) {
    const b = pose.bones[name];
    b[0] = 0;
    b[1] = 0;
    b[2] = 0;
  }
  pose.hipsDrop = 0;
}

function set(pose: Pose, bone: BoneName, x: number, y = 0, z = 0): void {
  const b = pose.bones[bone];
  b[0] = x;
  b[1] = y;
  b[2] = z;
}

/** Ground distance of one full stride cycle (two steps), metres. */
const STRIDE = 1.7;
const SPRINT_STRIDE = 2.3;
/** Speed treated as a full run for blending, m/s. */
const RUN_SPEED = 6;
const TAU = Math.PI * 2;

/** Frame-rate independent exponential smoothing factor. */
function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export class CharacterAnimator {
  /** Walk cycle phase, radians. */
  private phase = 0;
  private move = 0;
  private forward = 0;
  private strafe = 0;
  private air = 0;
  private landing = 0;
  private sprint = 0;
  private readonly weights = new Map<MoveMode, number>(MODES.map((m) => [m, m === "walk" ? 1 : 0]));
  private readonly scratch = makePose();
  private readonly blended = makePose();

  constructor(private readonly rig: CharacterRig) {}

  /** Starts a landing squash; `speed` is the impact speed in m/s. */
  land(speed: number): void {
    this.landing = Math.max(this.landing, clamp((speed - 3) / 14, 0, 1));
  }

  update(input: AnimationInput, dt: number): void {
    this.updateLocomotionState(input, dt);
    this.updateWeights(input.mode, dt);

    resetPose(this.blended);
    for (const mode of MODES) {
      const weight = this.weights.get(mode) ?? 0;
      if (weight < 1e-3) continue;
      resetPose(this.scratch);
      this.pose(mode, input, this.scratch);
      for (const name of BONE_NAMES) {
        const target = this.blended.bones[name];
        const source = this.scratch.bones[name];
        target[0] += source[0] * weight;
        target[1] += source[1] * weight;
        target[2] += source[2] * weight;
      }
      this.blended.hipsDrop += this.scratch.hipsDrop * weight;
    }
    this.apply(this.blended);
  }

  private updateLocomotionState(input: AnimationInput, dt: number): void {
    // Velocity in the body's frame: forward is -Z at bodyYaw.
    const sin = Math.sin(input.bodyYaw);
    const cos = Math.cos(input.bodyYaw);
    const localForward = -input.vx * sin - input.vz * cos;
    const localRight = input.vx * cos - input.vz * sin;
    const speed = Math.hypot(input.vx, input.vz);

    const k = smoothing(10, dt);
    const moving = input.grounded ? clamp(speed / RUN_SPEED, 0, 1.4) : 0;
    this.move += (moving - this.move) * k;
    const total = Math.max(speed, 0.001);
    this.forward += (localForward / total - this.forward) * k;
    this.strafe += (localRight / total - this.strafe) * k;
    this.air += ((input.grounded ? 0 : 1) - this.air) * smoothing(8, dt);
    this.sprint += ((input.sprinting && input.grounded ? 1 : 0) - this.sprint) * smoothing(8, dt);
    this.landing = Math.max(0, this.landing - dt * 4);
    const stride = STRIDE + (SPRINT_STRIDE - STRIDE) * this.sprint;
    if (input.grounded) this.phase = (this.phase + (TAU * speed * dt) / stride) % TAU;
  }

  private updateWeights(mode: MoveMode, dt: number): void {
    const k = smoothing(14, dt);
    for (const m of MODES) {
      const target = m === mode ? 1 : 0;
      // The roll is a full flip: blending it would spin the body back, so it snaps.
      const next = m === "roll" || mode === "roll" ? target : (this.weights.get(m) ?? 0) + (target - (this.weights.get(m) ?? 0)) * k;
      this.weights.set(m, next);
    }
  }

  private pose(mode: MoveMode, input: AnimationInput, out: Pose): void {
    switch (mode) {
      case "walk":
        this.locomotionPose(input, out);
        break;
      case "slide":
        slidePose(input, out);
        break;
      case "mantle":
        mantlePose(input.progress, out);
        break;
      case "hurdle":
        hurdlePose(input.progress, out);
        break;
      case "roll":
        rollPose(input.progress, out);
        break;
      case "skydive":
        skydivePose(input, out);
        break;
      case "glide":
        glidePose(input, out);
        break;
      case "splat":
        splatPose(input.progress, out);
        break;
    }
  }

  /** Walk/run/sprint cycle with backward and strafe blending, crouch, air tuck, ADS and look. */
  private locomotionPose(input: AnimationInput, out: Pose): void {
    const m = Math.min(1, this.move);
    const crouch = input.crouchBlend;
    const ads = input.adsBlend;
    const sprint = this.sprint;
    const swing = Math.sin(this.phase);
    const lift = Math.cos(this.phase);
    const amp = 1 + 0.35 * sprint;
    const fwdSwing = swing * m * amp * Math.sign(this.forward || 1) * Math.min(1, Math.abs(this.forward) + 0.2);
    const sideSwing = swing * m * this.strafe;

    out.hipsDrop = -Math.abs(lift) * (0.045 + 0.03 * sprint) * m + 0.37 * crouch + 0.12 * this.landing;

    const thighCrouch = 1.15 * crouch + 0.45 * this.air + 0.5 * this.landing;
    const kneeCrouch = -1.85 * crouch - 0.9 * this.air - 0.9 * this.landing;
    set(out, "upperLegL", fwdSwing * 0.65 + thighCrouch, 0, -sideSwing * 0.3 - 0.05 * this.air);
    set(out, "upperLegR", -fwdSwing * 0.65 + thighCrouch, 0, -sideSwing * 0.3 + 0.05 * this.air);
    set(out, "lowerLegL", kneeCrouch - Math.max(0, -lift) * (0.95 + 0.4 * sprint) * m);
    set(out, "lowerLegR", kneeCrouch - Math.max(0, lift) * (0.95 + 0.4 * sprint) * m);
    set(out, "footL", -(out.bones.upperLegL[0] + out.bones.lowerLegL[0]) * 0.8);
    set(out, "footR", -(out.bones.upperLegR[0] + out.bones.lowerLegR[0]) * 0.8);

    const twist = clamp(wrapAngle(input.lookYaw - input.bodyYaw), -0.9, 0.9);
    set(out, "spine", -0.38 * crouch - 0.08 * m * Math.max(0, this.forward) - 0.22 * sprint, twist * 0.35);
    set(out, "chest", input.lookPitch * 0.3 * (1 - sprint), twist * 0.35);
    set(out, "head", input.lookPitch * 0.45 + 0.2 * sprint, twist * 0.3);

    // Arms: counter-swing (pumping and bent when sprinting), out in the air, forward when aiming.
    const hipArmL = -fwdSwing * (0.55 + 0.3 * sprint) + 0.15;
    const hipArmR = fwdSwing * (0.55 + 0.3 * sprint) + 0.15;
    const aimUpper = 1.45 + input.lookPitch;
    set(out, "upperArmL", hipArmL * (1 - ads) + (aimUpper - 0.15) * ads, 0.5 * ads, -0.12 - 0.5 * this.air * (1 - ads));
    set(out, "upperArmR", hipArmR * (1 - ads) + aimUpper * ads, -0.15 * ads, 0.12 + 0.5 * this.air * (1 - ads));
    set(out, "lowerArmL", 0.35 + 0.25 * m + 0.9 * sprint + 0.6 * ads);
    set(out, "lowerArmR", 0.35 + 0.25 * m + 0.9 * sprint + 0.15 * ads);
  }

  /** Writes the blended pose onto the bones. */
  private apply(pose: Pose): void {
    const bones = this.rig.bones;
    const rest = this.rig.rest;
    for (const name of BONE_NAMES) {
      if (name === "root") continue;
      const r = pose.bones[name];
      bones[name].rotation.set(r[0], r[1], r[2]);
    }
    bones.hips.position.set(rest.hips.x, rest.hips.y - pose.hipsDrop, rest.hips.z);
  }
}

/** Leaning back, lead leg out front, trailing leg tucked, arms out for balance. */
function slidePose(input: AnimationInput, out: Pose): void {
  out.hipsDrop = 0.58;
  set(out, "hips", 0.42);
  set(out, "spine", -0.25);
  set(out, "chest", -0.15 + input.lookPitch * 0.2);
  set(out, "head", -0.25 + input.lookPitch * 0.3);
  set(out, "upperLegL", 1.35, 0, -0.1);
  set(out, "lowerLegL", -0.25);
  set(out, "footL", -0.4);
  set(out, "upperLegR", 0.55, 0, 0.15);
  set(out, "lowerLegR", -1.7);
  set(out, "footR", 0.6);
  set(out, "upperArmL", 0.4, 0, -0.75);
  set(out, "lowerArmL", 0.5);
  set(out, "upperArmR", 0.9 + input.adsBlend * 0.6, 0, 0.35);
  set(out, "lowerArmR", 0.6);
}

/** Reach up, pull the knees in, then push down onto the ledge. */
function mantlePose(progress: number, out: Pose): void {
  const reach = clamp(1 - progress * 1.6, 0, 1);
  const push = clamp((progress - 0.45) / 0.55, 0, 1);
  const tuck = Math.sin(clamp(progress, 0, 1) * Math.PI);
  out.hipsDrop = 0.15 * tuck;
  set(out, "hips", -0.35 * tuck);
  set(out, "spine", -0.2);
  set(out, "head", 0.25 * reach);
  const arms = 2.7 * reach + 0.6 * push;
  set(out, "upperArmL", arms, 0, -0.15);
  set(out, "upperArmR", arms, 0, 0.15);
  set(out, "lowerArmL", 0.2 + 0.9 * push);
  set(out, "lowerArmR", 0.2 + 0.9 * push);
  set(out, "upperLegL", 1.3 * tuck + 0.2);
  set(out, "upperLegR", 0.9 * tuck);
  set(out, "lowerLegL", -1.7 * tuck);
  set(out, "lowerLegR", -1.4 * tuck);
}

/** Lead leg extended, trailing leg swung out to the side, one hand planted. */
function hurdlePose(progress: number, out: Pose): void {
  const arc = Math.sin(clamp(progress, 0, 1) * Math.PI);
  out.hipsDrop = 0.1 * arc;
  set(out, "hips", -0.3 * arc);
  set(out, "spine", -0.15 * arc);
  set(out, "upperLegL", 1.4 * arc + 0.2);
  set(out, "lowerLegL", -0.15);
  set(out, "upperLegR", 0.5 * arc, 0, 0.9 * arc);
  set(out, "lowerLegR", -1.5 * arc);
  set(out, "upperArmL", 1.1 * arc, 0, -0.2);
  set(out, "lowerArmL", 0.1);
  set(out, "upperArmR", 0.4, 0, 1.0 * arc);
  set(out, "lowerArmR", 0.3);
}

/** Forward somersault from a tight tuck. */
function rollPose(progress: number, out: Pose): void {
  const p = clamp(progress, 0, 1);
  const tuck = Math.sin(p * Math.PI);
  out.hipsDrop = 0.45 + 0.1 * tuck;
  set(out, "hips", -TAU * p);
  set(out, "spine", -0.5 * tuck);
  set(out, "head", -0.4 * tuck);
  set(out, "upperLegL", 1.9 * tuck);
  set(out, "upperLegR", 1.9 * tuck);
  set(out, "lowerLegL", -2.3 * tuck);
  set(out, "lowerLegR", -2.3 * tuck);
  set(out, "upperArmL", 1.3 * tuck, 0, -0.3);
  set(out, "upperArmR", 1.3 * tuck, 0, 0.3);
  set(out, "lowerArmL", 1.2 * tuck);
  set(out, "lowerArmR", 1.2 * tuck);
}

/** Face-down, arms and legs spread; diving tips the body further down. */
function skydivePose(input: AnimationInput, out: Pose): void {
  const dive = clamp((-input.vy - 55) / 20, 0, 1);
  set(out, "hips", -1.35 - 0.6 * dive);
  set(out, "head", 0.9 - 0.4 * dive);
  set(out, "upperArmL", 0.45 + 1.0 * dive, 0, -1.25 + 1.0 * dive);
  set(out, "upperArmR", 0.45 + 1.0 * dive, 0, 1.25 - 1.0 * dive);
  set(out, "lowerArmL", 0.6);
  set(out, "lowerArmR", 0.6);
  set(out, "upperLegL", -0.2, 0, -0.35 + 0.3 * dive);
  set(out, "upperLegR", -0.2, 0, 0.35 - 0.3 * dive);
  set(out, "lowerLegL", -0.5 + 0.4 * dive);
  set(out, "lowerLegR", -0.5 + 0.4 * dive);
}

/** Hanging from the glider bar, legs trailing, rolling into banks. */
function glidePose(input: AnimationInput, out: Pose): void {
  set(out, "hips", -0.25, 0, -input.glideBank * 0.35);
  set(out, "head", 0.35);
  set(out, "upperArmL", 2.95, 0, -0.3);
  set(out, "upperArmR", 2.95, 0, 0.3);
  set(out, "lowerArmL", 0.25);
  set(out, "lowerArmR", 0.25);
  set(out, "upperLegL", -0.1, 0, -0.08);
  set(out, "upperLegR", -0.25, 0, 0.08);
  set(out, "lowerLegL", -0.35);
  set(out, "lowerLegR", -0.55);
}

/** Flat on the face, then pushing back up near the end. */
function splatPose(progress: number, out: Pose): void {
  const getUp = clamp((progress - 0.7) / 0.3, 0, 1);
  out.hipsDrop = 0.8 * (1 - getUp) + 0.4 * getUp;
  set(out, "hips", -1.5 * (1 - getUp) - 0.6 * getUp);
  set(out, "head", 0.5);
  set(out, "upperArmL", 0.3 + 1.2 * getUp, 0, -1.3 * (1 - getUp));
  set(out, "upperArmR", 0.3 + 1.2 * getUp, 0, 1.3 * (1 - getUp));
  set(out, "lowerArmL", 0.4);
  set(out, "lowerArmR", 0.4);
  set(out, "upperLegL", 0.1 + 1.2 * getUp, 0, -0.15);
  set(out, "upperLegR", 0.1 + 0.6 * getUp, 0, 0.15);
  set(out, "lowerLegL", -1.6 * getUp);
  set(out, "lowerLegR", -0.8 * getUp);
}
