import { axisQuat, IDENTITY_QUAT, type Quat } from "../physics/PhysicsWorld";
import type { Vec3 } from "../sim/MathUtil";
import { Rng } from "../sim/Rng";

/**
 * The movement playground: a fixed course for testing locomotion (slopes,
 * steps, ledges, a crouch tunnel, walls for the camera) plus seeded scenery
 * blocks. The same data builds the physics colliders and the rendered meshes.
 */

export type BlockKind = "course" | "ramp" | "step" | "wall" | "scenery";

export interface Block {
  /** Short label for the debug overlay and tests. */
  name: string;
  kind: BlockKind;
  center: Vec3;
  half: Vec3;
  rotation: Quat;
}

export const PLAYGROUND = {
  /** Half size of the square ground slab in metres. */
  groundHalf: 100,
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
} as const;

const deg = (d: number): number => (d * Math.PI) / 180;

/** A ramp rising toward -Z, with its low edge at z = startZ on the ground. */
function ramp(name: string, x: number, startZ: number, angleDeg: number, width: number, length: number): Block {
  const a = deg(angleDeg);
  const thickness = 0.4;
  // Slab centre: halfway up the slope, pushed down by half the thickness along the slope normal.
  const cy = (Math.sin(a) * length) / 2 - (Math.cos(a) * thickness) / 2;
  const cz = startZ - (Math.cos(a) * length) / 2 - (Math.sin(a) * thickness) / 2;
  return {
    name,
    kind: "ramp",
    center: { x, y: cy, z: cz },
    half: { x: width / 2, y: thickness / 2, z: length / 2 },
    // Positive rotation about X lifts the -Z end.
    rotation: axisQuat("x", a),
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

/** Finds a block by name (tests and debug tools). */
export function findBlock(blocks: readonly Block[], name: string): Block {
  const block = blocks.find((b) => b.name === name);
  if (block === undefined) throw new Error(`Playground block not found: ${name}`);
  return block;
}

/** Centre of the crate pile (north-east, clear of the course). */
export const CRATE_AREA = { x: 24, z: -24, spread: 7 } as const;
