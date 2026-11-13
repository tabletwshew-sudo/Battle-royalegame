import type RAPIER from "@dimforge/rapier3d-compat";
import { makeRayHit, type PhysicsWorld, QUERY_WORLD_ONLY, type RayHit } from "../physics/PhysicsWorld";
import type { Vec3 } from "./MathUtil";
import { capsuleHalfHeight, type MovementConfig } from "./MovementConfig";

/**
 * Ledge probe for mantles and hurdles (GAME_SPEC §2). Purely a query: it
 * looks at static world geometry in front of a character and returns a
 * traversal plan, or null when nothing can be climbed.
 *
 * 1. Horizontal rays from the body axis at several heights find a wall
 *    within reach whose normal faces the character.
 * 2. A ray cast down just past the wall face finds a walkable top.
 * 3. Hurdle: rays further along find where the top ends and the ground
 *    behind it, for obstacles no taller than `hurdleMaxHeight`.
 * 4. Capsule overlap tests check that the character fits on the ledge (or
 *    behind the obstacle) and along the way up.
 */

export type TraversalKind = "mantle" | "hurdle";

export interface TraversalPlan {
  kind: TraversalKind;
  /** Unit horizontal direction of travel. */
  dirX: number;
  dirZ: number;
  /** Feet position at the end. */
  endX: number;
  endY: number;
  endZ: number;
  /** Height of the obstacle top above the feet at the start. */
  height: number;
  /** Top of the obstacle (world y). */
  topY: number;
  /** Distance from the start axis to the near and far faces of the obstacle (hurdles). */
  nearFace: number;
  farFace: number;
  /** The character only fits crouched at the end. */
  endCrouched: boolean;
}

export interface ProbeOptions {
  /** True while airborne: ledges are measured against `mantleAirReach` instead. */
  airborne: boolean;
  /** Current horizontal speed (hurdles need a run-up). */
  speed: number;
  /** Collider to ignore (the character's own capsule). */
  exclude: RAPIER.Collider | null;
}

/** Heights above the feet at which the wall rays are cast. */
const WALL_RAY_HEIGHTS = [0.3, 0.6, 1.0, 1.4, 1.8] as const;
/** Normal must face back toward the character at least this much (cos of angle). */
const WALL_FACING = 0.6;
/** Ledge tops need a normal at least this vertical. */
const TOP_MIN_NY = 0.7;

const hit: RayHit = makeRayHit();
const origin: Vec3 = { x: 0, y: 0, z: 0 };
const down: Vec3 = { x: 0, y: -1, z: 0 };
const forward: Vec3 = { x: 0, y: 0, z: 0 };
const center: Vec3 = { x: 0, y: 0, z: 0 };

/** Feet y of the nearest walkable surface below (x, fromY, z) within `depth`, or null. */
function groundBelow(physics: PhysicsWorld, x: number, fromY: number, z: number, depth: number, exclude: RAPIER.Collider | null): number | null {
  origin.x = x;
  origin.y = fromY;
  origin.z = z;
  const found = physics.raycast(origin, down, depth, hit, { groups: QUERY_WORLD_ONLY, exclude });
  if (found === null || found.normal.y < TOP_MIN_NY) return null;
  return found.point.y;
}

/** True when a capsule of `height` with its feet at (x, feetY, z) overlaps the world. */
function blocked(
  physics: PhysicsWorld,
  config: MovementConfig,
  x: number,
  feetY: number,
  z: number,
  height: number,
  exclude: RAPIER.Collider | null,
): boolean {
  center.x = x;
  center.y = feetY + config.controllerOffset + height / 2 + 0.03;
  center.z = z;
  return physics.capsuleOverlaps(center, capsuleHalfHeight(height, config.capsuleRadius), config.capsuleRadius, {
    groups: QUERY_WORLD_ONLY,
    exclude,
  });
}

/**
 * Looks for a climbable obstacle in direction (dirX, dirZ) from a character
 * whose feet are at `feet`. `dir` must be a horizontal unit vector.
 */
export function probeTraversal(
  physics: PhysicsWorld,
  config: MovementConfig,
  feet: Vec3,
  dirX: number,
  dirZ: number,
  options: ProbeOptions,
): TraversalPlan | null {
  const radius = config.capsuleRadius;
  // Look further ahead when moving fast, so a sprint does not run past the trigger range.
  const reach = radius + config.mantleReach + options.speed * 0.06;
  forward.x = dirX;
  forward.y = 0;
  forward.z = dirZ;

  // 1. Nearest wall face in front.
  let wallDistance = Infinity;
  for (const h of WALL_RAY_HEIGHTS) {
    origin.x = feet.x;
    origin.y = feet.y + h;
    origin.z = feet.z;
    const found = physics.raycast(origin, forward, reach, hit, { groups: QUERY_WORLD_ONLY, exclude: options.exclude });
    if (found === null) continue;
    const facing = -(found.normal.x * dirX + found.normal.z * dirZ);
    if (facing < WALL_FACING || Math.abs(found.normal.y) > 0.5) continue;
    wallDistance = Math.min(wallDistance, found.distance);
  }
  if (!Number.isFinite(wallDistance)) return null;

  // 2. Walkable top just past the face.
  const maxUp = options.airborne ? config.mantleAirReach : config.mantleMaxHeight;
  const minUp = options.airborne ? 0.25 : config.mantleMinHeight;
  // Just past the face, so thin obstacles (fences, 0.15 m and up) still show their top.
  const probeX = feet.x + dirX * (wallDistance + 0.08);
  const probeZ = feet.z + dirZ * (wallDistance + 0.08);
  const castFrom = feet.y + maxUp + 0.4;
  const topY = groundBelow(physics, probeX, castFrom, probeZ, maxUp + 0.4 - minUp + 0.05, options.exclude);
  if (topY === null) return null;
  const height = topY - feet.y;
  // Small tolerance for the controller skin (feet can sit a centimetre off the floor).
  // A ray that starts inside a taller wall reports a hit at its origin: too high.
  if (height < minUp - 0.05 || height > maxUp + 0.05 || topY >= castFrom - 1e-3) return null;

  // Room overhead: the (crouched) character must fit above its start position at ledge height.
  if (blocked(physics, config, feet.x, topY + 0.05, feet.z, config.crouchHeight, options.exclude)) return null;

  // 3. Hurdle: short obstacle, running, with ground behind it.
  if (!options.airborne && height <= config.hurdleMaxHeight && options.speed >= config.hurdleMinSpeed * 0.8) {
    const plan = planHurdle(physics, config, feet, dirX, dirZ, wallDistance, topY, options.exclude);
    if (plan !== null) return plan;
  }

  // 4. Mantle onto the top.
  const endX = feet.x + dirX * (wallDistance + radius + 0.15);
  const endZ = feet.z + dirZ * (wallDistance + radius + 0.15);
  const standFits = !blocked(physics, config, endX, topY, endZ, config.standHeight, options.exclude);
  if (!standFits && blocked(physics, config, endX, topY, endZ, config.crouchHeight, options.exclude)) return null;
  return {
    kind: "mantle",
    dirX,
    dirZ,
    endX,
    endY: topY,
    endZ,
    height,
    topY,
    nearFace: wallDistance,
    farFace: wallDistance,
    endCrouched: !standFits,
  };
}

/** Finds the far edge of a low obstacle and a landing spot behind it. */
function planHurdle(
  physics: PhysicsWorld,
  config: MovementConfig,
  feet: Vec3,
  dirX: number,
  dirZ: number,
  wallDistance: number,
  topY: number,
  exclude: RAPIER.Collider | null,
): TraversalPlan | null {
  const step = 0.1;
  for (let d = wallDistance + 0.08; d <= wallDistance + config.hurdleMaxDepth + step; d += step) {
    const x = feet.x + dirX * d;
    const z = feet.z + dirZ * d;
    const below = groundBelow(physics, x, topY + 0.3, z, topY - feet.y + 2.5, exclude);
    // Still on top of the obstacle.
    if (below !== null && below > topY - 0.25) continue;
    // Past the far face: land a capsule radius beyond it on the ground found there.
    const land = config.capsuleRadius + 0.25;
    const endX = feet.x + dirX * (d + land);
    const endZ = feet.z + dirZ * (d + land);
    const groundY = groundBelow(physics, endX, topY + 0.3, endZ, topY - feet.y + 2.5, exclude);
    if (groundY === null || groundY > feet.y + 0.5) return null;
    if (blocked(physics, config, endX, groundY, endZ, config.standHeight, exclude)) return null;
    // The crouched character must clear the top on the way over.
    const midX = feet.x + dirX * ((wallDistance + d) / 2);
    const midZ = feet.z + dirZ * ((wallDistance + d) / 2);
    if (blocked(physics, config, midX, topY + 0.1, midZ, config.crouchHeight, exclude)) return null;
    return {
      kind: "hurdle",
      dirX,
      dirZ,
      endX,
      endY: groundY,
      endZ,
      height: topY - feet.y,
      topY,
      nearFace: wallDistance,
      farFace: d,
      endCrouched: false,
    };
  }
  return null;
}
