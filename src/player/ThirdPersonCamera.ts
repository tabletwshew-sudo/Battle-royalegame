import type RAPIER from "@dimforge/rapier3d-compat";
import type { PerspectiveCamera } from "three/webgpu";
import type { PhysicsWorld } from "../shared/physics/PhysicsWorld";
import { type CameraConfig, type CameraSubject, computeCameraPose, makeCameraPose } from "../shared/sim/CameraRig";
import { clamp } from "../shared/sim/MathUtil";

/**
 * Client camera on top of the shared CameraRig. The rig decides where the
 * camera may be (collision included); this class adds the presentation:
 * the arm pulls in instantly but eases back out, landings dip the view,
 * and the FOV follows the ADS zoom.
 */
export class ThirdPersonCamera {
  private readonly pose = makeCameraPose();
  private arm = -1;
  private dip = 0;
  private dipVelocity = 0;

  /** Arm ease-out speed after an obstruction clears, metres per second. */
  static readonly ARM_RETURN_SPEED = 7;

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly config: CameraConfig,
  ) {
    this.camera.rotation.order = "YXZ";
  }

  /** Kicks the landing dip; `speed` is the impact speed in m/s. */
  land(speed: number): void {
    this.dipVelocity -= clamp((speed - 4) * 0.12, 0, 2.2);
  }

  /** Current collision-free arm length (debug overlay). */
  get armLength(): number {
    return this.arm;
  }

  update(subject: CameraSubject, physics: PhysicsWorld, exclude: RAPIER.Collider | null, baseFov: number, dt: number): void {
    const pose = computeCameraPose(subject, this.config, physics, exclude, this.pose);

    // Snap in when something blocks the view; ease out when it clears.
    if (this.arm < 0 || pose.armLength < this.arm) this.arm = pose.armLength;
    else this.arm = Math.min(pose.armLength, this.arm + ThirdPersonCamera.ARM_RETURN_SPEED * dt);

    // Critically damped spring for the landing dip.
    const stiffness = 90;
    const damping = 2 * Math.sqrt(stiffness);
    this.dipVelocity += (-stiffness * this.dip - damping * this.dipVelocity) * dt;
    this.dip += this.dipVelocity * dt;

    const f = pose.forward;
    this.camera.position.set(pose.pivot.x - f.x * this.arm, pose.pivot.y - f.y * this.arm + this.dip * 0.12, pose.pivot.z - f.z * this.arm);
    this.camera.rotation.set(subject.pitch, subject.yaw, 0);
    const fov = baseFov * pose.fovScale;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
