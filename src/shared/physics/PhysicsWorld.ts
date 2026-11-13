import RAPIER from "@dimforge/rapier3d-compat";
import { SIM_DT } from "../sim/Constants";
import type { Vec3 } from "../sim/MathUtil";

/**
 * Thin wrapper around a Rapier world, used identically in the browser and in
 * Node. Rapier holds static world geometry and loose physics props; player
 * hitboxes are analytic and live elsewhere (see ARCHITECTURE.md).
 */

let initPromise: Promise<void> | null = null;

/** Loads the Rapier WASM module once. Must resolve before any PhysicsWorld is created. */
export function initPhysics(): Promise<void> {
  if (initPromise === null) initPromise = RAPIER.init();
  return initPromise;
}

/** Version string of the loaded physics library (shown in the debug overlay). */
export function physicsVersion(): string {
  return RAPIER.version();
}

export interface RayHit {
  /** Distance along the ray in metres. */
  distance: number;
  point: Vec3;
  normal: Vec3;
  /** Handle of the collider that was hit. */
  colliderHandle: number;
}

export interface BoxOptions {
  friction?: number;
  restitution?: number;
  density?: number;
}

export const DEFAULT_GRAVITY = 25;

export class PhysicsWorld {
  world: RAPIER.World;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  /** @param gravity downward acceleration in m/s^2 (positive number) */
  constructor(gravity = DEFAULT_GRAVITY) {
    this.world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
    this.world.timestep = SIM_DT;
  }

  /** Advances physics by one fixed tick. */
  step(): void {
    this.world.step();
  }

  /** Adds an immovable axis-aligned box given its centre and half extents. */
  addStaticBox(center: Vec3, half: Vec3, options: BoxOptions = {}): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(options.friction ?? 0.9)
      .setRestitution(options.restitution ?? 0);
    return this.world.createCollider(desc);
  }

  /** Adds a simulated box and returns its rigid body. */
  addDynamicBox(center: Vec3, half: Vec3, options: BoxOptions = {}): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(center.x, center.y, center.z).setCanSleep(true),
    );
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setFriction(options.friction ?? 0.7)
      .setRestitution(options.restitution ?? 0.05)
      .setDensity(options.density ?? 1);
    this.world.createCollider(desc, body);
    return body;
  }

  /**
   * Casts a ray against all solid colliders.
   * @param direction must be normalized
   * @returns the closest hit written into `out`, or null when nothing is hit
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number, out: RayHit): RayHit | null {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    this.ray.dir.x = direction.x;
    this.ray.dir.y = direction.y;
    this.ray.dir.z = direction.z;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDistance, true);
    if (hit === null) return null;
    out.distance = hit.timeOfImpact;
    out.point.x = origin.x + direction.x * hit.timeOfImpact;
    out.point.y = origin.y + direction.y * hit.timeOfImpact;
    out.point.z = origin.z + direction.z * hit.timeOfImpact;
    out.normal.x = hit.normal.x;
    out.normal.y = hit.normal.y;
    out.normal.z = hit.normal.z;
    out.colliderHandle = hit.collider.handle;
    return out;
  }

  get bodyCount(): number {
    return this.world.bodies.len();
  }

  get colliderCount(): number {
    return this.world.colliders.len();
  }

  /** Serializes the entire physics state (bodies, colliders, solver caches). */
  takeSnapshot(): Uint8Array {
    return this.world.takeSnapshot();
  }

  /** Replaces the world with one restored from a snapshot. Body and collider handles stay valid. */
  restoreSnapshot(data: Uint8Array): void {
    const restored = RAPIER.World.restoreSnapshot(data);
    this.world.free();
    this.world = restored;
  }

  /** Frees the WASM memory held by this world. */
  dispose(): void {
    this.world.free();
  }
}

/** Creates an empty reusable RayHit. */
export function makeRayHit(): RayHit {
  return { distance: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, colliderHandle: -1 };
}
