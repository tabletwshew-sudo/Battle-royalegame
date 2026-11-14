import { axisQuat, IDENTITY_QUAT, type Quat, quatMultiply } from "../physics/PhysicsWorld";
import type { Vec3 } from "../sim/MathUtil";
import { Rng } from "../sim/Rng";
import type { DoorDef } from "./Doors";
import { Builder, buildHouse, buildTower, emptyBuildOutput } from "./Buildings";
import type { StaticWorld } from "./StaticWorld";

/**
 * The movement playground: a fixed course for testing locomotion (slopes,
 * steps, ledges, a crouch tunnel, walls for the camera) plus seeded scenery
 * blocks. The same data builds the physics colliders and the rendered meshes.
 */

export type BlockKind = "course" | "ramp" | "step" | "wall" | "scenery" | "pad" | "fence" | "structure";

/** A launch pad's top surface (axis-aligned). Stepping onto it throws the character up. */
export interface LaunchPad {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
}

export interface Block {
  /** Short label for the debug overlay and tests. */
  name: string;
  kind: BlockKind;
  center: Vec3;
  half: Vec3;
  rotation: Quat;
  /** Render colour (island pieces carry their own; playground pieces use their kind's colour). */
  color?: number;
  /** Render batch (island: POI id or "wild"). */
  group?: string;
}

export const PLAYGROUND = {
  /** Half size of the square ground slab in metres (large enough to glide over). */
  groundHalf: 400,
  /** Where the player starts (feet), facing -Z toward the course. */
  spawn: { x: 0, y: 0.05, z: 10 } as Vec3,
  spawnYaw: 0,
  /** Slope angles of the ramp row, degrees. */
  rampAngles: [20, 35, 48, 55] as const,
  /** Rise of each step flight, metres. */
  stepRises: [0.3, 0.45, 0.6] as const,
  /** Heights of the jump boxes, metres. */
  ledgeHeights: [0.6, 1.0, 1.5] as const,
  /** Clear height inside the crouch tunnel. */
  tunnelClearance: 1.4,
  /** Heights of the mantle wall row, metres (the last one is too tall). */
  mantleHeights: [0.5, 0.8, 1.1, 1.5, 1.9, 2.3, 2.7] as const,
  /** Heights of the thin hurdle fences, metres (the last one needs a mantle). */
  fenceHeights: [0.9, 1.1, 1.4] as const,
  /** Mesa top height and the slide ramp up to it. */
  mesaHeight: 25,
  mesaRampAngle: 30,
  /** Where the training dummy stands (feet), facing the spawn. */
  dummy: { x: 4, y: 0.05, z: 4 } as Vec3,
  dummyYaw: Math.PI,
  /** Sample island buildings (same generators as the island) for walkability tests. */
  sampleTower: { x: -45, y: 0, z: 45, floors: 5 },
  sampleHouse: { x: -28, y: 0, z: 48 },
} as const;

const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * A ramp whose low edge is centred at (x, 0, startZ) on the ground and which
 * rises along the look direction of `yaw` (yaw 0 = toward -Z).
 */
function ramp(name: string, x: number, startZ: number, angleDeg: number, width: number, length: number, yaw = 0): Block {
  const a = deg(angleDeg);
  const thickness = 0.4;
  // In the ramp's own frame (rising toward -Z): slab centre halfway up the slope,
  // pushed down by half the thickness along the slope normal.
  const localY = (Math.sin(a) * length) / 2 - (Math.cos(a) * thickness) / 2;
  const localZ = -(Math.cos(a) * length) / 2 - (Math.sin(a) * thickness) / 2;
  // Rotate the local offset by yaw about +Y.
  const offsetX = localZ * Math.sin(yaw);
  const offsetZ = localZ * Math.cos(yaw);
  return {
    name,
    kind: "ramp",
    center: { x: x + offsetX, y: localY, z: startZ + offsetZ },
    half: { x: width / 2, y: thickness / 2, z: length / 2 },
    // Pitch about X lifts the -Z end, then yaw turns the ramp.
    rotation: quatMultiply(axisQuat("y", yaw), axisQuat("x", a)),
  };
}

function box(name: string, kind: BlockKind, center: Vec3, half: Vec3): Block {
  return { name, kind, center, half, rotation: IDENTITY_QUAT };
}

/** Builds every static block of the playground. Scenery placement depends on the seed. */
export function buildPlayground(seed: number): Block[] {
  const blocks: Block[] = [];
  const g = PLAYGROUND.groundHalf;
  blocks.push(box("ground", "course", { x: 0, y: -0.5, z: 0 }, { x: g, y: 0.5, z: g }));

  // Ramp row west of the spawn: x = -22 .. -4, rising toward -Z from z = 0.
  PLAYGROUND.rampAngles.forEach((angle, i) => {
    blocks.push(ramp(`ramp ${angle} deg`, -22 + i * 6, 0, angle, 4.5, 9));
  });

  // Step flights east of the spawn: 6 steps each, 0.8 m deep, rising toward -Z.
  PLAYGROUND.stepRises.forEach((rise, flight) => {
    const x = 6 + flight * 5;
    for (let i = 0; i < 6; i++) {
      const top = rise * (i + 1);
      blocks.push(
        box(`steps ${rise} m #${i + 1}`, "step", { x, y: top / 2, z: -0.4 - i * 0.8 }, { x: 2, y: top / 2, z: 0.4 }),
      );
    }
  });

  // Jump boxes straight ahead of the spawn.
  PLAYGROUND.ledgeHeights.forEach((height, i) => {
    blocks.push(box(`ledge ${height} m`, "course", { x: -3 + i * 3, y: height / 2, z: -10 }, { x: 1.2, y: height / 2, z: 1.2 }));
  });

  // Crouch tunnel: two side walls and a roof leaving PLAYGROUND.tunnelClearance of head room.
  const clear = PLAYGROUND.tunnelClearance;
  const tz = -20;
  blocks.push(box("tunnel roof", "wall", { x: 0, y: clear + 0.3, z: tz }, { x: 1.6, y: 0.3, z: 3 }));
  blocks.push(box("tunnel wall west", "wall", { x: -1.3, y: clear / 2, z: tz }, { x: 0.3, y: clear / 2, z: 3 }));
  blocks.push(box("tunnel wall east", "wall", { x: 1.3, y: clear / 2, z: tz }, { x: 0.3, y: clear / 2, z: 3 }));

  // Tall walls with a narrow gap: squeezes the camera arm and the shoulder pivot.
  blocks.push(box("camera wall north", "wall", { x: 24, y: 3, z: 12 }, { x: 6, y: 3, z: 0.4 }));
  blocks.push(box("camera wall south", "wall", { x: 24, y: 3, z: 15 }, { x: 6, y: 3, z: 0.4 }));

  // A raised platform with a sheer drop for coyote-time tests (top at 2 m).
  blocks.push(box("platform", "course", { x: -14, y: 1, z: 14 }, { x: 4, y: 1, z: 4 }));
  // Stairs up to the platform from the east (0.4 m rises).
  for (let i = 0; i < 4; i++) {
    const top = 1.6 - i * 0.4;
    blocks.push(box(`platform stairs #${i + 1}`, "step", { x: -9.6 + i * 0.8, y: top / 2, z: 14 }, { x: 0.4, y: top / 2, z: 2 }));
  }

  // Mesa with a long 30 degree ramp up its east side: slides, boosted jumps, glider redeploy.
  const mesaH = PLAYGROUND.mesaHeight;
  blocks.push(box("mesa", "course", { x: -66, y: mesaH / 2, z: -40 }, { x: 10, y: mesaH / 2, z: 10 }));
  const rampLength = mesaH / Math.sin(deg(PLAYGROUND.mesaRampAngle));
  const rampStartX = -56 + Math.cos(deg(PLAYGROUND.mesaRampAngle)) * rampLength;
  blocks.push({ ...ramp("mesa ramp", rampStartX, -40, PLAYGROUND.mesaRampAngle, 6, rampLength, Math.PI / 2), name: "mesa ramp" });

  // Mantle wall row behind the spawn (front faces at z = 24.5).
  PLAYGROUND.mantleHeights.forEach((height, i) => {
    blocks.push(box(`mantle ${height} m`, "course", { x: -12 + i * 4, y: height / 2, z: 26 }, { x: 1.5, y: height / 2, z: 1.5 }));
  });

  // Thin fences for hurdles (z = 30).
  PLAYGROUND.fenceHeights.forEach((height, i) => {
    blocks.push(box(`fence ${height} m`, "fence", { x: 18 + i * 5, y: height / 2, z: 30 }, { x: 1.5, y: height / 2, z: 0.1 }));
  });

  // Launch pad near the spawn.
  blocks.push(box("launch pad", "pad", { x: -6, y: 0.075, z: 19 }, { x: 1.5, y: 0.075, z: 1.5 }));

  // A small hut with two doors (south and west walls), open roof.
  const hut = { minX: 34, maxX: 42, minZ: 24, maxZ: 32, height: 3, t: 0.15 };
  const wallH = hut.height / 2;
  // South wall (z = 24) with a 1.2 m door gap at x 37.4..38.6.
  blocks.push(box("hut south wall a", "wall", { x: 35.7, y: wallH, z: hut.minZ }, { x: 1.7, y: wallH, z: hut.t }));
  blocks.push(box("hut south wall b", "wall", { x: 40.3, y: wallH, z: hut.minZ }, { x: 1.7, y: wallH, z: hut.t }));
  blocks.push(box("hut south header", "wall", { x: 38, y: 2.6, z: hut.minZ }, { x: 0.6, y: 0.4, z: hut.t }));
  // West wall (x = 34) with a gap at z 27.4..28.6.
  blocks.push(box("hut west wall a", "wall", { x: hut.minX, y: wallH, z: 25.7 }, { x: hut.t, y: wallH, z: 1.7 }));
  blocks.push(box("hut west wall b", "wall", { x: hut.minX, y: wallH, z: 30.3 }, { x: hut.t, y: wallH, z: 1.7 }));
  blocks.push(box("hut west header", "wall", { x: hut.minX, y: 2.6, z: 28 }, { x: hut.t, y: 0.4, z: 0.6 }));
  blocks.push(box("hut north wall", "wall", { x: 38, y: wallH, z: hut.maxZ }, { x: 4 + hut.t, y: wallH, z: hut.t }));
  blocks.push(box("hut east wall", "wall", { x: hut.maxX, y: wallH, z: 28 }, { x: hut.t, y: wallH, z: 4 }));

  // Seeded scenery ring well away from the course.
  const rng = new Rng(seed).fork("playground-scenery");
  for (let i = 0; i < 14; i++) {
    const half = { x: rng.range(0.8, 3), y: rng.range(0.5, 4), z: rng.range(0.8, 3) };
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(40, 80);
    blocks.push(
      box(`scenery ${i + 1}`, "scenery", { x: Math.cos(angle) * radius, y: half.y, z: Math.sin(angle) * radius }, half),
    );
  }
  return blocks;
}

/** The hut's two doors (hinge at floor level, panel along local +X). */
export function playgroundDoors(): DoorDef[] {
  return [
    { hingeX: 37.4, hingeY: 0, hingeZ: 24, width: 1.2, height: 2.2, thickness: 0.1, closedYaw: 0 },
    { hingeX: 34, hingeY: 0, hingeZ: 28.6, width: 1.2, height: 2.2, thickness: 0.1, closedYaw: Math.PI / 2 },
  ];
}

/** Launch pads of the playground (top surfaces of the "pad" blocks). */
export function playgroundLaunchPads(blocks: readonly Block[]): LaunchPad[] {
  return blocks
    .filter((block) => block.kind === "pad")
    .map((block) => ({
      minX: block.center.x - block.half.x,
      maxX: block.center.x + block.half.x,
      minZ: block.center.z - block.half.z,
      maxZ: block.center.z + block.half.z,
      topY: block.center.y + block.half.y,
    }));
}

/** Finds a block by name (tests and debug tools). */
export function findBlock(blocks: readonly Block[], name: string): Block {
  const block = blocks.find((b) => b.name === name);
  if (block === undefined) throw new Error(`Playground block not found: ${name}`);
  return block;
}

/** Centre of the crate pile (north-east, clear of the course). */
export const CRATE_AREA = { x: 24, z: -24, spread: 7 } as const;

/** The playground as a StaticWorld (flat ground slab, no terrain or water) with two sample buildings. */
export function playgroundWorld(seed: number): StaticWorld {
  const boxes = buildPlayground(seed);
  const samples = emptyBuildOutput();
  const rng = new Rng(seed).fork("playground-buildings");
  const t = PLAYGROUND.sampleTower;
  buildTower(new Builder(samples, { x: t.x, y: t.y, z: t.z }, 0, "samples"), rng, t.floors);
  const h = PLAYGROUND.sampleHouse;
  buildHouse(new Builder(samples, { x: h.x, y: h.y, z: h.z }, 0, "samples"), rng, { floors: 2, pitched: true });
  boxes.push(...samples.boxes);
  return {
    kind: "playground",
    boxes,
    cylinders: samples.cylinders,
    terrain: null,
    trees: [],
    rockPrototypes: [],
    rocks: [],
    bushes: [],
    doors: [...playgroundDoors(), ...samples.doors],
    launchPads: playgroundLaunchPads(boxes),
    waterLevel: null,
    spawn: PLAYGROUND.spawn,
    spawnYaw: PLAYGROUND.spawnYaw,
  };
}
