import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { axisQuat, type Quat } from "../physics/PhysicsWorld";
import type { Vec3 } from "../sim/MathUtil";
import type { DoorDef } from "./Doors";
import type { Block, LaunchPad } from "./Playground";
import { gridSize, rapierHeights, type TerrainGrid } from "./Terrain";

/**
 * Everything static a simulation stands on: terrain, building and prop
 * pieces, trees, rocks, doors, launch pads and water. Both the movement
 * playground and the island produce one; the sim builds its physics from
 * it and the client renders from the same data.
 */

/** Vertical-axis cylinder piece (posts, tanks, stacks, columns). */
export interface CylinderPiece {
  name: string;
  center: Vec3;
  radius: number;
  halfHeight: number;
  /** Optional tilt (for blades and booms); defaults to upright. */
  rotation?: Quat;
  color: number;
  /** Render batch (usually the POI id). */
  group: string;
}

export type TreeKind = "pine" | "round" | "palm";

export interface TreeInstance {
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** Trunk collider dimensions per tree kind at scale 1. */
export const TREE_TRUNKS: Readonly<Record<TreeKind, { radius: number; height: number }>> = {
  pine: { radius: 0.38, height: 7 },
  round: { radius: 0.45, height: 5 },
  palm: { radius: 0.3, height: 7.5 },
};

/** One of a few rock shapes (convex point clouds), shared by physics and rendering. */
export interface RockPrototype {
  /** Local points (unit-ish size) of the convex shape, xyz triplets. */
  points: Float32Array;
}

export interface RockInstance {
  prototype: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** Decorative bush (no collision; still cover from sight). */
export interface BushInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
}

export interface StaticWorld {
  kind: "playground" | "island";
  boxes: Block[];
  cylinders: CylinderPiece[];
  terrain: TerrainGrid | null;
  trees: TreeInstance[];
  rockPrototypes: RockPrototype[];
  rocks: RockInstance[];
  bushes: BushInstance[];
  doors: DoorDef[];
  launchPads: LaunchPad[];
  /** Height of the water surface, or null when the world has no water. */
  waterLevel: number | null;
  spawn: Vec3;
  spawnYaw: number;
}

/** World-space hull points of a rock instance (yaw + uniform scale applied). */
export function rockWorldPoints(prototype: RockPrototype, rock: RockInstance): Float32Array {
  const src = prototype.points;
  const out = new Float32Array(src.length);
  const c = Math.cos(rock.yaw);
  const s = Math.sin(rock.yaw);
  for (let i = 0; i < src.length; i += 3) {
    const x = (src[i] as number) * rock.scale;
    const y = (src[i + 1] as number) * rock.scale;
    const z = (src[i + 2] as number) * rock.scale;
    // Same yaw convention as Object3D.rotation.y.
    out[i] = rock.x + x * c + z * s;
    out[i + 1] = rock.y + y;
    out[i + 2] = rock.z - x * s + z * c;
  }
  return out;
}

/** Statistics returned by `buildStaticPhysics` (debug overlay and tests). */
export interface StaticPhysicsStats {
  colliders: number;
}

/** Creates every static collider of a world (doors are built by the DoorSystem). */
export function buildStaticPhysics(physics: PhysicsWorld, world: StaticWorld): StaticPhysicsStats {
  let colliders = 0;
  if (world.terrain !== null) {
    const grid = world.terrain;
    const size = gridSize(grid);
    physics.addHeightfield(grid.cells, rapierHeights(grid), { x: grid.originX + size / 2, y: 0, z: grid.originZ + size / 2 }, size);
    colliders++;
  }
  for (const box of world.boxes) {
    physics.addStaticBox(box.center, box.half, {}, box.rotation);
    colliders++;
  }
  for (const cylinder of world.cylinders) {
    physics.addStaticCylinder(cylinder.center, cylinder.radius, cylinder.halfHeight, cylinder.rotation);
    colliders++;
  }
  for (const tree of world.trees) {
    const trunk = TREE_TRUNKS[tree.kind];
    const halfHeight = (trunk.height * tree.scale) / 2;
    physics.addStaticCylinder({ x: tree.x, y: tree.y + halfHeight - 0.3, z: tree.z }, trunk.radius * tree.scale, halfHeight);
    colliders++;
  }
  for (const rock of world.rocks) {
    const prototype = world.rockPrototypes[rock.prototype];
    if (prototype === undefined) continue;
    if (physics.addStaticConvexHull(rockWorldPoints(prototype, rock)) !== null) colliders++;
  }
  return { colliders };
}

/** Yaw-only rotation helper for world generators. */
export function yawQuat(yaw: number): Quat {
  return axisQuat("y", yaw);
}
