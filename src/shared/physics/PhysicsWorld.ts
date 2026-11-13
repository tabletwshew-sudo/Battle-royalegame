import RAPIER from "@dimforge/rapier3d-compat";
import { SIM_DT } from "../sim/Constants";
import type { Vec3 } from "../sim/MathUtil";

/**
 * Thin wrapper around a Rapier world, used identically in the browser and in
 * Node. Rapier holds static world geometry, loose physics props and the
 * movement capsules of characters; player HITBOXES are analytic and live
 * elsewhere (see ARCHITECTURE.md).
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

/** Collision layers (16-bit membership masks). */
export const Layer = {
  World: 1 << 0,
  Character: 1 << 1,
  Prop: 1 << 2,
  All: 0xffff,
} as const;

/** Packs Rapier interaction groups: high 16 bits = memberships, low 16 bits = filter. */
export function interactionGroups(memberships: number, filter: number): number {
  return ((memberships & 0xffff) << 16) | (filter & 0xffff);
}

/** Query groups that only see static world geometry (camera arms, ledge probes). */
export const QUERY_WORLD_ONLY = interactionGroups(Layer.All, Layer.World);
/** Query groups that see world geometry and props but not characters. */
export const QUERY_WORLD_AND_PROPS = interactionGroups(Layer.All, Layer.World | Layer.Prop);

export interface RayHit {
  /** Distance along the ray in metres. */
  distance: number;
  point: Vec3;
  normal: Vec3;
  /** Handle of the collider that was hit. */
  colliderHandle: number;
}

export interface QueryOptions {
  /** Interaction groups for the query (default: everything). */
  groups?: number;
  /** A collider the query ignores (usually the caller's own capsule). */
  exclude?: RAPIER.Collider | null;
}

export interface BoxOptions {
  friction?: number;
  restitution?: number;
  density?: number;
}

/** Unit quaternion. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const IDENTITY_QUAT: Readonly<Quat> = { x: 0, y: 0, z: 0, w: 1 };

/** Quaternion for a rotation of `angle` radians about the X, Y or Z axis. */
export function axisQuat(axis: "x" | "y" | "z", angle: number): Quat {
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  return { x: axis === "x" ? s : 0, y: axis === "y" ? s : 0, z: axis === "z" ? s : 0, w: c };
}

/** Hamilton product a * b (apply b first, then a). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export const DEFAULT_GRAVITY = 25;

export class PhysicsWorld {
  world: RAPIER.World;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly balls = new Map<number, RAPIER.Ball>();

  /** @param gravity downward acceleration in m/s^2 (positive number) */
  constructor(gravity = DEFAULT_GRAVITY) {
    this.world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
    this.world.timestep = SIM_DT;
  }

  /** Advances physics by one fixed tick. */
  step(): void {
    this.world.step();
  }

  /** Adds an immovable box given its centre, half extents and optional rotation. */
  addStaticBox(center: Vec3, half: Vec3, options: BoxOptions = {}, rotation: Quat = IDENTITY_QUAT): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation(rotation)
      .setFriction(options.friction ?? 0.9)
      .setRestitution(options.restitution ?? 0)
      .setCollisionGroups(interactionGroups(Layer.World, Layer.All));
    return this.world.createCollider(desc);
  }

  /** Adds a simulated box (a prop) and returns its rigid body. */
  addDynamicBox(center: Vec3, half: Vec3, options: BoxOptions = {}): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(center.x, center.y, center.z).setCanSleep(true),
    );
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setFriction(options.friction ?? 0.7)
      .setRestitution(options.restitution ?? 0.05)
      .setDensity(options.density ?? 1)
      .setCollisionGroups(interactionGroups(Layer.Prop, Layer.All));
    this.world.createCollider(desc, body);
    return body;
  }

  /**
   * Adds a free-standing capsule collider for a character's movement shape.
   * It has no rigid body: the character controller moves it explicitly.
   */
  addCharacterCapsule(center: Vec3, halfHeight: number, radius: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(0)
      .setCollisionGroups(interactionGroups(Layer.Character, Layer.All));
    return this.world.createCollider(desc);
  }

  /** Creates a kinematic character controller bound to this world. Free it with `.free()`. */
  createCharacterController(offset: number): RAPIER.KinematicCharacterController {
    return this.world.createCharacterController(offset);
  }

  /** Looks up a collider by handle (handles survive snapshot restore). */
  getCollider(handle: number): RAPIER.Collider {
    return this.world.getCollider(handle);
  }

  /**
   * Casts a ray against solid colliders.
   * @param direction must be normalized
   * @returns the closest hit written into `out`, or null when nothing is hit
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number, out: RayHit, options: QueryOptions = {}): RayHit | null {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    this.ray.dir.x = direction.x;
    this.ray.dir.y = direction.y;
    this.ray.dir.z = direction.z;
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxDistance,
      true,
      undefined,
      options.groups,
      options.exclude ?? undefined,
    );
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

  /**
   * Sweeps a sphere from `origin` along the unit `direction`.
   * @returns the travel distance before contact (0 if it starts overlapping),
   *          or `maxDistance` when the path is clear
   */
  sphereCast(origin: Vec3, direction: Vec3, maxDistance: number, radius: number, options: QueryOptions = {}): number {
    if (maxDistance <= 0) return 0;
    const hit = this.world.castShape(
      origin,
      IDENTITY_QUAT,
      direction,
      this.ball(radius),
      0,
      maxDistance,
      true,
      undefined,
      options.groups,
      options.exclude ?? undefined,
    );
    return hit === null ? maxDistance : Math.max(0, hit.time_of_impact);
  }

  /** True when a capsule placed at `center` would overlap anything (except `options.exclude`). */
  capsuleOverlaps(center: Vec3, halfHeight: number, radius: number, options: QueryOptions = {}): boolean {
    const shape = new RAPIER.Capsule(halfHeight, radius);
    const hit = this.world.intersectionWithShape(
      center,
      IDENTITY_QUAT,
      shape,
      undefined,
      options.groups,
      options.exclude ?? undefined,
    );
    return hit !== null;
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

  /**
   * Replaces the world with one restored from a snapshot. Body and collider
   * handles stay valid; character controllers must be recreated by their owners.
   */
  restoreSnapshot(data: Uint8Array): void {
    const restored = RAPIER.World.restoreSnapshot(data);
    this.world.free();
    this.world = restored;
  }

  /** Frees the WASM memory held by this world. */
  dispose(): void {
    this.world.free();
  }

  /** Cached ball shape per radius (shapes are plain descriptions, safe to reuse). */
  private ball(radius: number): RAPIER.Ball {
    let shape = this.balls.get(radius);
    if (shape === undefined) {
      shape = new RAPIER.Ball(radius);
      this.balls.set(radius, shape);
    }
    return shape;
  }
}

/** Creates an empty reusable RayHit. */
export function makeRayHit(): RayHit {
  return { distance: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, colliderHandle: -1 };
}
