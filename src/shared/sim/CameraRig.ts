import type RAPIER from "@dimforge/rapier3d-compat";
import { type PhysicsWorld, QUERY_WORLD_ONLY } from "../physics/PhysicsWorld";
import { clamp, lerp, lookDirection, type Vec3 } from "./MathUtil";

/**
 * Over-the-shoulder camera placement (GAME_SPEC §2 "Camera"). Lives in the
 * shared sim because aiming depends on it: shots are traced from the camera
 * through the crosshair, so client and server must agree on the camera.
 */
export interface CameraConfig {
  /** Hip-fire offset: metres to the side of the body axis (times shoulder side). */
  shoulderOffset: number;
  /** Pivot height above the feet, standing and crouched. */
  pivotHeight: number;
  crouchPivotHeight: number;
  /** Distance behind the pivot. */
  distance: number;
  /** ADS placement (closer, lower, more centred). Weapons may override it from M5. */
  adsShoulderOffset: number;
  adsPivotHeight: number;
  adsDistance: number;
  /** FOV multiplier at full ADS (smaller = more zoom). */
  adsFovScale: number;
  /** Radius of the sphere swept along the arm so the lens never clips walls. */
  probeRadius: number;
  /** Shortest arm allowed when the camera is squeezed against a wall. */
  minDistance: number;
  /** Extra arm length and pivot height while skydiving and gliding (wider view). */
  skydiveArmExtra: number;
  skydiveHeightExtra: number;
  glideArmExtra: number;
  glideHeightExtra: number;
  /** FOV multiplier at full sprint. */
  sprintFovScale: number;
}

export function defaultCameraConfig(): CameraConfig {
  return {
    shoulderOffset: 0.55,
    pivotHeight: 1.6,
    crouchPivotHeight: 1.08,
    distance: 3.2,
    adsShoulderOffset: 0.75,
    adsPivotHeight: 1.58,
    adsDistance: 1.9,
    adsFovScale: 0.75,
    probeRadius: 0.2,
    minDistance: 0.3,
    skydiveArmExtra: 3.2,
    skydiveHeightExtra: 0.9,
    glideArmExtra: 2.4,
    glideHeightExtra: 1.3,
    sprintFovScale: 1.08,
  };
}

/** The player values the rig needs (all interpolatable). */
export interface CameraSubject {
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** 0 standing .. 1 crouched. */
  crouchBlend: number;
  /** 0 hip .. 1 aiming. */
  adsBlend: number;
  /** -1 left shoulder .. +1 right shoulder. */
  shoulderBlend: number;
  /** Extra arm length and pivot height (skydive/glide framing), metres. Default 0. */
  armExtra?: number;
  heightExtra?: number;
}

export interface CameraPose {
  position: Vec3;
  /** Unit view direction. */
  forward: Vec3;
  /** Where the arm ends without collision; position lies on the segment pivot -> ideal. */
  pivot: Vec3;
  /** Collision-free arm length actually used. */
  armLength: number;
  /** Arm length the rig wanted before collision. */
  idealArmLength: number;
  /** FOV multiplier for ADS. */
  fovScale: number;
}

export function makeCameraPose(): CameraPose {
  return {
    position: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    pivot: { x: 0, y: 0, z: 0 },
    armLength: 0,
    idealArmLength: 0,
    fovScale: 1,
  };
}

const scratchAxis: Vec3 = { x: 0, y: 0, z: 0 };
const scratchDir: Vec3 = { x: 0, y: 0, z: 0 };
const scratchBack: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Computes the camera pose. Two sphere sweeps keep it out of walls: first
 * from the body axis sideways to the shoulder pivot (so a wall at your
 * shoulder pulls the pivot in), then from the pivot backwards along the arm.
 * Only static world geometry blocks the camera; props and characters do not.
 *
 * @param physics   null skips collision (ideal pose)
 * @param exclude   the subject's own capsule
 */
export function computeCameraPose(
  subject: CameraSubject,
  config: CameraConfig,
  physics: PhysicsWorld | null,
  exclude: RAPIER.Collider | null,
  out: CameraPose,
): CameraPose {
  const ads = clamp(subject.adsBlend, 0, 1);
  const crouch = clamp(subject.crouchBlend, 0, 1);
  const hipHeight = lerp(config.pivotHeight, config.crouchPivotHeight, crouch);
  const adsHeight = config.adsPivotHeight - (config.pivotHeight - hipHeight);
  const height = lerp(hipHeight, adsHeight, ads) + (subject.heightExtra ?? 0);
  const side = lerp(config.shoulderOffset, config.adsShoulderOffset, ads) * clamp(subject.shoulderBlend, -1, 1);
  const ideal = lerp(config.distance, config.adsDistance, ads) + (subject.armExtra ?? 0);

  const forward = lookDirection(subject.yaw, subject.pitch, out.forward);
  // Right vector on the horizontal plane.
  const rightX = Math.cos(subject.yaw);
  const rightZ = -Math.sin(subject.yaw);

  // Body axis at pivot height.
  scratchAxis.x = subject.x;
  scratchAxis.y = subject.y + height;
  scratchAxis.z = subject.z;

  // Sideways sweep from the body axis to the shoulder pivot.
  let sideReach = Math.abs(side);
  if (physics !== null && sideReach > 0) {
    scratchDir.x = rightX * Math.sign(side);
    scratchDir.y = 0;
    scratchDir.z = rightZ * Math.sign(side);
    sideReach = physics.sphereCast(scratchAxis, scratchDir, sideReach, config.probeRadius, {
      groups: QUERY_WORLD_ONLY,
      exclude,
    });
  }
  const signedSide = Math.sign(side) * sideReach;
  out.pivot.x = scratchAxis.x + rightX * signedSide;
  out.pivot.y = scratchAxis.y;
  out.pivot.z = scratchAxis.z + rightZ * signedSide;

  // Backward sweep along the arm.
  scratchBack.x = -forward.x;
  scratchBack.y = -forward.y;
  scratchBack.z = -forward.z;
  let arm = ideal;
  if (physics !== null) {
    arm = physics.sphereCast(out.pivot, scratchBack, ideal, config.probeRadius, { groups: QUERY_WORLD_ONLY, exclude });
  }
  arm = Math.max(Math.min(config.minDistance, ideal), arm);

  out.armLength = arm;
  out.idealArmLength = ideal;
  out.position.x = out.pivot.x + scratchBack.x * arm;
  out.position.y = out.pivot.y + scratchBack.y * arm;
  out.position.z = out.pivot.z + scratchBack.z * arm;
  out.fovScale = lerp(1, config.adsFovScale, ads);
  return out;
}
