import { clamp, wrapAngle } from "../shared/sim/MathUtil";
import type { CharacterRig } from "./CharacterRig";

/**
 * Procedural animation for the character rig: walk/run cycle with forward,
 * backward and strafe blending, crouch, airborne tuck, ADS arm pose, look
 * pitch/twist and a landing squash. Purely cosmetic (client only); the
 * hitboxes in M5 follow the sim state, not these bones.
 */
export interface AnimationInput {
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
}

/** Ground distance of one full stride cycle (two steps), metres. */
const STRIDE = 1.7;
/** Speed treated as a full run for blending, m/s. */
const RUN_SPEED = 6;

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

  constructor(private readonly rig: CharacterRig) {}

  /** Starts a landing squash; `speed` is the impact speed in m/s. */
  land(speed: number): void {
    this.landing = Math.max(this.landing, clamp((speed - 3) / 14, 0, 1));
  }

  update(input: AnimationInput, dt: number): void {
    const b = this.rig.bones;
    const rest = this.rig.rest;

    // Velocity in the body's frame: forward is -Z at bodyYaw.
    const sin = Math.sin(input.bodyYaw);
    const cos = Math.cos(input.bodyYaw);
    const localForward = -input.vx * sin - input.vz * cos;
    const localRight = input.vx * cos - input.vz * sin;
    const speed = Math.hypot(input.vx, input.vz);

    const k = smoothing(10, dt);
    const moving = input.grounded ? clamp(speed / RUN_SPEED, 0, 1) : 0;
    this.move += (moving - this.move) * k;
    const total = Math.max(speed, 0.001);
    this.forward += (localForward / total - this.forward) * k;
    this.strafe += (localRight / total - this.strafe) * k;
    this.air += ((input.grounded ? 0 : 1) - this.air) * smoothing(8, dt);
    this.landing = Math.max(0, this.landing - dt * 4);
    if (input.grounded) this.phase = (this.phase + (2 * Math.PI * speed * dt) / STRIDE) % (Math.PI * 2);

    const m = this.move;
    const crouch = input.crouchBlend;
    const ads = input.adsBlend;
    const swing = Math.sin(this.phase);
    const lift = Math.cos(this.phase);
    // Backward walking reverses the swing; strafing swings the legs sideways.
    const fwdSwing = swing * m * Math.sign(this.forward || 1) * Math.min(1, Math.abs(this.forward) + 0.2);
    const sideSwing = swing * m * this.strafe;

    // Hips: bob, crouch drop, landing squash.
    const bob = Math.abs(lift) * 0.045 * m;
    b.hips.position.set(rest.hips.x, rest.hips.y + bob - 0.37 * crouch - 0.12 * this.landing, rest.hips.z);

    // Legs. Positive X rotation swings a limb forward (toward -Z).
    const thighCrouch = 1.15 * crouch + 0.45 * this.air + 0.5 * this.landing;
    const kneeCrouch = -1.85 * crouch - 0.9 * this.air - 0.9 * this.landing;
    b.upperLegL.rotation.set(fwdSwing * 0.65 + thighCrouch, 0, -sideSwing * 0.3 - 0.05 * this.air);
    b.upperLegR.rotation.set(-fwdSwing * 0.65 + thighCrouch, 0, -sideSwing * 0.3 + 0.05 * this.air);
    b.lowerLegL.rotation.x = kneeCrouch - Math.max(0, -lift) * 0.95 * m;
    b.lowerLegR.rotation.x = kneeCrouch - Math.max(0, lift) * 0.95 * m;
    // Feet stay roughly level with the ground.
    b.footL.rotation.x = -(b.upperLegL.rotation.x + b.lowerLegL.rotation.x) * 0.8;
    b.footR.rotation.x = -(b.upperLegR.rotation.x + b.lowerLegR.rotation.x) * 0.8;

    // Spine: crouch lean, look pitch, and a twist toward the look direction.
    const twist = clamp(wrapAngle(input.lookYaw - input.bodyYaw), -0.9, 0.9);
    b.spine.rotation.set(-0.38 * crouch - 0.08 * m * Math.max(0, this.forward), twist * 0.35, 0);
    b.chest.rotation.set(input.lookPitch * 0.3, twist * 0.35, 0);
    b.head.rotation.set(input.lookPitch * 0.45, twist * 0.3, 0);

    // Arms: counter-swing while moving, out to the sides in the air, raised forward when aiming.
    const hipArmL = -fwdSwing * 0.55 + 0.15;
    const hipArmR = fwdSwing * 0.55 + 0.15;
    const aimUpper = 1.45 + input.lookPitch;
    b.upperArmL.rotation.set(
      hipArmL * (1 - ads) + (aimUpper - 0.15) * ads,
      0.5 * ads,
      -0.12 - 0.5 * this.air * (1 - ads),
    );
    b.upperArmR.rotation.set(hipArmR * (1 - ads) + aimUpper * ads, -0.15 * ads, 0.12 + 0.5 * this.air * (1 - ads));
    b.lowerArmL.rotation.set(0.35 + 0.25 * m + 0.6 * ads, 0, 0);
    b.lowerArmR.rotation.set(0.35 + 0.25 * m + 0.15 * ads, 0, 0);
  }
}
