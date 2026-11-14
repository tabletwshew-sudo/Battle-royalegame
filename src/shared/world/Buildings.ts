import { axisQuat, type Quat, quatMultiply } from "../physics/PhysicsWorld";
import type { Vec3 } from "../sim/MathUtil";
import type { Rng } from "../sim/Rng";
import type { DoorDef } from "./Doors";
import type { Block, LaunchPad } from "./Playground";
import type { CylinderPiece } from "./StaticWorld";

/**
 * Procedural buildings and landmarks (original designs) for the island.
 * Everything is made of boxes and upright cylinders so the same pieces
 * serve as colliders and render geometry. Every interior is walkable:
 * floors are slabs, stairs rise at most 0.3 m per step (below the 0.45 m
 * autostep), doorways are 2.35 m tall and stairwells have head room.
 *
 * Local frame of a building: origin at the centre of its footprint at
 * ground level, x to the right, front wall toward -z (the building "faces"
 * its yaw, like characters do).
 */

export interface BuildOutput {
  boxes: Block[];
  cylinders: CylinderPiece[];
  doors: DoorDef[];
  launchPads: LaunchPad[];
}

export function emptyBuildOutput(): BuildOutput {
  return { boxes: [], cylinders: [], doors: [], launchPads: [] };
}

/** Wall opening along the wall's axis (local units), from the wall base. */
export interface Opening {
  from: number;
  to: number;
  bottom: number;
  top: number;
}

export const PALETTE = {
  plaster: [0xe9dcc3, 0xd7e3df, 0xf0c9a8, 0xc9d8ee, 0xe8e2a6, 0xd9c2e6] as const,
  brick: [0xb8604a, 0x9c5a46, 0xc2754e] as const,
  roof: [0x3c5a73, 0x8a3b2e, 0x4d4a5c, 0x2f6b5a] as const,
  trim: 0xf2e3c6,
  floor: 0x8f7a63,
  concrete: 0xa7adb0,
  darkConcrete: 0x6f7679,
  metal: 0x8d99a3,
  wood: 0x8a6440,
  glass: 0x9fd4e6,
  hedge: 0x3f7d3a,
  signal: 0xff7a3d,
  violet: 0x8a4bff,
  teal: 0x0f2a33,
  container: [0xc2553a, 0x2f6fa8, 0x3d8a4f, 0xd6a53a, 0x7b4fa8] as const,
} as const;

/** Places pieces in a building's local frame (yaw about +Y around `origin`). */
export class Builder {
  private readonly cos: number;
  private readonly sin: number;
  private readonly yawQuat: Quat;

  constructor(
    readonly out: BuildOutput,
    readonly origin: Vec3,
    readonly yaw: number,
    readonly group: string,
  ) {
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.yawQuat = axisQuat("y", yaw);
  }

  /** Local (x, y, z) to world. */
  toWorld(x: number, y: number, z: number): Vec3 {
    return {
      x: this.origin.x + x * this.cos + z * this.sin,
      y: this.origin.y + y,
      z: this.origin.z - x * this.sin + z * this.cos,
    };
  }

  /** Box with local centre and half extents; `tilt` is applied in the local frame. */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, color: number, name = "", tilt?: Quat): void {
    if (hx <= 0.001 || hy <= 0.001 || hz <= 0.001) return;
    this.out.boxes.push({
      name,
      kind: "structure",
      center: this.toWorld(cx, cy, cz),
      half: { x: hx, y: hy, z: hz },
      rotation: tilt === undefined ? this.yawQuat : quatMultiply(this.yawQuat, tilt),
      color,
      group: this.group,
    });
  }

  /** Box spanning local bounds. */
  span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number, name = ""): void {
    this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2, color, name);
  }

  /** Upright cylinder with local centre. */
  cylinder(cx: number, cy: number, cz: number, radius: number, halfHeight: number, color: number, name = "", tilt?: Quat): void {
    const piece: CylinderPiece = {
      name,
      center: this.toWorld(cx, cy, cz),
      radius,
      halfHeight,
      color,
      group: this.group,
    };
    if (tilt !== undefined) piece.rotation = quatMultiply(this.yawQuat, tilt);
    this.out.cylinders.push(piece);
  }

  /** Hinged door whose hinge is at local (hx, 0, hz); the panel extends along local yaw `localYaw`'s +X. */
  door(hx: number, hz: number, width: number, height: number, localYaw: number): void {
    const hinge = this.toWorld(hx, 0, hz);
    this.out.doors.push({
      hingeX: hinge.x,
      hingeY: hinge.y,
      hingeZ: hinge.z,
      width,
      height,
      thickness: 0.08,
      closedYaw: this.yaw + localYaw,
    });
  }

  /** Launch pad (3 x 3 m) centred at local (x, z) on a surface at local height y. */
  launchPad(x: number, y: number, z: number): void {
    this.box(x, y + 0.075, z, 1.5, 0.075, 1.5, 0x3fd0c9, "launch pad");
    // The pad is axis-aligned in world space for the trigger test, so use its world centre.
    const c = this.toWorld(x, y + 0.15, z);
    this.out.launchPads.push({ minX: c.x - 1.4, maxX: c.x + 1.4, minZ: c.z - 1.4, maxZ: c.z + 1.4, topY: c.y });
  }

  /**
   * Wall along local x at depth z, from x0 to x1, standing on y0, with
   * rectangular openings (doors and windows) cut out.
   */
  wallX(z: number, x0: number, x1: number, y0: number, height: number, thickness: number, color: number, openings: Opening[] = []): void {
    this.wall(x0, x1, y0, height, openings, (a, b, ya, yb) => this.span(a, b, ya, yb, z - thickness / 2, z + thickness / 2, color));
  }

  /** Wall along local z at x, from z0 to z1. */
  wallZ(x: number, z0: number, z1: number, y0: number, height: number, thickness: number, color: number, openings: Opening[] = []): void {
    this.wall(z0, z1, y0, height, openings, (a, b, ya, yb) => this.span(x - thickness / 2, x + thickness / 2, ya, yb, a, b, color));
  }

  private wall(
    a0: number,
    a1: number,
    y0: number,
    height: number,
    openings: Opening[],
    emit: (a: number, b: number, ya: number, yb: number) => void,
  ): void {
    const sorted = [...openings].sort((p, q) => p.from - q.from);
    let cursor = a0;
    for (const o of sorted) {
      if (o.from > cursor) emit(cursor, o.from, y0, y0 + height);
      if (o.bottom > 0) emit(o.from, o.to, y0, y0 + o.bottom);
      if (o.top < height) emit(o.from, o.to, y0 + o.top, y0 + height);
      cursor = o.to;
    }
    if (cursor < a1) emit(cursor, a1, y0, y0 + height);
  }

  /** Floor/roof slab with its top at `topY`, optionally with one rectangular hole. */
  slab(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    topY: number,
    thickness: number,
    color: number,
    hole?: { x0: number; x1: number; z0: number; z1: number },
  ): void {
    const y0 = topY - thickness;
    if (hole === undefined) {
      this.span(x0, x1, y0, topY, z0, z1, color);
      return;
    }
    this.span(x0, hole.x0, y0, topY, z0, z1, color);
    this.span(hole.x1, x1, y0, topY, z0, z1, color);
    this.span(hole.x0, hole.x1, y0, topY, z0, hole.z0, color);
    this.span(hole.x0, hole.x1, y0, topY, hole.z1, z1, color);
  }

  /**
   * Straight stair flight along local z between x0 and x1. Each step is a
   * solid block from `baseY` up to its tread.
   * @param direction +1 climbs toward +z, -1 toward -z
   */
  stairs(x0: number, x1: number, zStart: number, direction: 1 | -1, baseY: number, fromY: number, rise: number, run: number, steps: number, color: number): void {
    for (let i = 0; i < steps; i++) {
      const top = fromY + rise * (i + 1);
      const za = zStart + direction * i * run;
      const zb = zStart + direction * (i + 1) * run;
      this.span(x0, x1, baseY, top, Math.min(za, zb), Math.max(za, zb), color);
    }
  }
}

const WALL_T = 0.25;
const DOOR_W = 1.2;
const DOOR_H = 2.35;

/** Window openings spread along a wall of `length`. */
function windows(length: number, count: number, bottom = 1.0, top = 2.2, width = 1.2, skip?: [number, number]): Opening[] {
  const out: Opening[] = [];
  for (let i = 0; i < count; i++) {
    const c = -length / 2 + (length * (i + 0.5)) / count;
    if (skip !== undefined && c + width / 2 > skip[0] && c - width / 2 < skip[1]) continue;
    out.push({ from: c - width / 2, to: c + width / 2, bottom, top });
  }
  return out;
}

/** Pitched roof (two tilted slabs) over a W x D footprint at height `eaveY`. */
function pitchedRoof(b: Builder, w: number, d: number, eaveY: number, color: number): void {
  const angle = 0.5;
  const halfSpan = d / 2 + 0.4;
  const slope = halfSpan / Math.cos(angle);
  const rise = Math.tan(angle) * halfSpan;
  for (const side of [-1, 1] as const) {
    const tilt = axisQuat("x", side * angle);
    b.box(0, eaveY + rise / 2 + 0.1, (side * halfSpan) / 2, w / 2 + 0.4, 0.12, slope / 2, color, "roof", tilt);
  }
  // Gable ends.
  for (const side of [-1, 1] as const) {
    b.span(side * (w / 2 - WALL_T / 2) - WALL_T / 2, side * (w / 2 - WALL_T / 2) + WALL_T / 2, eaveY, eaveY + rise * 0.55, -d / 4, d / 4, PALETTE.trim);
  }
}

export interface HouseOptions {
  floors: 1 | 2;
  pitched: boolean;
}

/** Two-storey (or bungalow) house: front door, windows on every wall, interior stairs. */
export function buildHouse(b: Builder, rng: Rng, options: HouseOptions): void {
  const W = 10;
  const D = 8;
  const FH = 3.2;
  const wall = rng.pick(PALETTE.plaster);
  const roof = rng.pick(PALETTE.roof);
  const floorTop = 0.15;
  b.slab(-W / 2, W / 2, -D / 2, D / 2, floorTop, 0.3, PALETTE.floor);

  const front: Opening[] = [{ from: -DOOR_W / 2, to: DOOR_W / 2, bottom: 0, top: DOOR_H }, ...windows(W, 4, 1.0, 2.2, 1.2, [-1, 1])];
  b.wallX(-D / 2 + WALL_T / 2, -W / 2, W / 2, 0, FH + floorTop, WALL_T, wall, front);
  b.wallX(D / 2 - WALL_T / 2, -W / 2, W / 2, 0, FH + floorTop, WALL_T, wall, windows(W, 3));
  b.wallZ(-W / 2 + WALL_T / 2, -D / 2 + WALL_T, D / 2 - WALL_T, 0, FH + floorTop, WALL_T, wall, windows(D - 2 * WALL_T, 2));
  b.wallZ(W / 2 - WALL_T / 2, -D / 2 + WALL_T, D / 2 - WALL_T, 0, FH + floorTop, WALL_T, wall, windows(D - 2 * WALL_T, 1, 1.4));
  b.door(-DOOR_W / 2, -D / 2 + WALL_T / 2, DOOR_W, DOOR_H, 0);

  let eave = FH + floorTop;
  if (options.floors === 2) {
    // Stairs along the right wall, climbing toward the back.
    const steps = 11;
    const rise = FH / steps;
    const run = 0.3;
    const x1 = W / 2 - WALL_T;
    const x0 = x1 - 1.2;
    const z0 = -0.2;
    b.stairs(x0, x1, z0, 1, 0, floorTop, rise, run, steps, PALETTE.wood);
    const upperTop = floorTop + FH;
    b.slab(-W / 2 + WALL_T, W / 2 - WALL_T, -D / 2 + WALL_T, D / 2 - WALL_T, upperTop, 0.25, PALETTE.floor, {
      x0: x0 - 0.05,
      x1,
      z0: z0 - 0.3,
      z1: z0 + steps * run,
    });
    b.wallX(-D / 2 + WALL_T / 2, -W / 2, W / 2, upperTop, FH, WALL_T, wall, windows(W, 3));
    b.wallX(D / 2 - WALL_T / 2, -W / 2, W / 2, upperTop, FH, WALL_T, wall, windows(W, 3));
    b.wallZ(-W / 2 + WALL_T / 2, -D / 2 + WALL_T, D / 2 - WALL_T, upperTop, FH, WALL_T, wall, windows(D - 2 * WALL_T, 2));
    b.wallZ(W / 2 - WALL_T / 2, -D / 2 + WALL_T, D / 2 - WALL_T, upperTop, FH, WALL_T, wall, windows(D - 2 * WALL_T, 2));
    eave = upperTop + FH;
  }
  if (options.pitched) {
    b.slab(-W / 2, W / 2, -D / 2, D / 2, eave + 0.2, 0.2, PALETTE.trim);
    pitchedRoof(b, W, D, eave + 0.2, roof);
  } else {
    b.slab(-W / 2, W / 2, -D / 2, D / 2, eave + 0.25, 0.25, roof);
    for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) b.span(-W / 2, W / 2, eave + 0.25, eave + 0.85, z - 0.1, z + 0.1, PALETTE.trim);
  }
}

/** Single-storey shop: wide storefront, side door, counters, an outside stair to a walkable roof. */
export function buildShop(b: Builder, rng: Rng): void {
  const W = 14;
  const D = 12;
  const H = 4.2;
  const wall = rng.pick(PALETTE.brick);
  b.slab(-W / 2, W / 2, -D / 2, D / 2, 0.15, 0.3, PALETTE.concrete);
  b.wallX(-D / 2 + WALL_T / 2, -W / 2, W / 2, 0, H, WALL_T, wall, [{ from: -2.6, to: 2.6, bottom: 0, top: 3.1 }, ...windows(W, 4, 0.9, 3.0, 2.2, [-3.2, 3.2])]);
  b.wallX(D / 2 - WALL_T / 2, -W / 2, W / 2, 0, H, WALL_T, wall, windows(W, 3, 1.4, 2.4));
  // Side door near the front of the left wall (the outside stair runs along the back half).
  b.wallZ(-W / 2 + WALL_T / 2, -D / 2 + WALL_T, D / 2 - WALL_T, 0, H, WALL_T, wall, [{ from: -3.3 - DOOR_W, to: -3.3, bottom: 0, top: DOOR_H }]);
  b.wallZ(W / 2 - WALL_T / 2, -D / 2 + WALL_T, D / 2 - WALL_T, 0, H, WALL_T, wall, windows(D - 2 * WALL_T, 2));
  b.door(-W / 2 + WALL_T / 2, -3.3, DOOR_W, DOOR_H, Math.PI / 2);
  // Counters and shelves as cover.
  b.span(-4, 1, 0.15, 1.15, 1.5, 2.3, PALETTE.wood);
  b.span(3.5, 6.2, 0.15, 2.0, 3.5, 5.4, PALETTE.metal);
  // Roof with parapet and a striped awning over the storefront.
  b.slab(-W / 2, W / 2, -D / 2, D / 2, H + 0.25, 0.25, PALETTE.darkConcrete);
  b.wallX(-D / 2 + 0.1, -W / 2, W / 2, H + 0.25, 0.9, 0.2, PALETTE.trim);
  b.wallX(D / 2 - 0.1, -W / 2, W / 2, H + 0.25, 0.9, 0.2, PALETTE.trim);
  // Gap in the left parapet where the outside stair arrives (its top step is at z 1.3..1.6).
  b.wallZ(-W / 2 + 0.1, -D / 2 + 0.2, D / 2 - 0.2, H + 0.25, 0.9, 0.2, PALETTE.trim, [{ from: 0.6, to: 2.4, bottom: 0, top: 1 }]);
  b.wallZ(W / 2 - 0.1, -D / 2 + 0.2, D / 2 - 0.2, H + 0.25, 0.9, 0.2, PALETTE.trim);
  b.span(-3, 3, 3.3, 3.45, -D / 2 - 1.6, -D / 2, rng.chance(0.5) ? PALETTE.signal : PALETTE.violet);
  // Outside stairs up the left side to the roof (15 steps of 0.297 m).
  const steps = 15;
  const rise = (H + 0.25) / steps;
  b.stairs(-W / 2 - 1.3, -W / 2, D / 2 - 0.2, -1, 0, 0, rise, 0.3, steps, PALETTE.concrete);
}

/** Tall warehouse / barn: big doorway, side door, crates inside. */
export function buildWarehouse(b: Builder, rng: Rng, color?: number): void {
  const W = 22;
  const D = 14;
  const H = 7;
  const wall = color ?? rng.pick([PALETTE.metal, PALETTE.brick[0], 0x7a8f6a]);
  b.slab(-W / 2, W / 2, -D / 2, D / 2, 0.15, 0.3, PALETTE.darkConcrete);
  b.wallX(-D / 2 + WALL_T / 2, -W / 2, W / 2, 0, H, WALL_T, wall, [{ from: -3, to: 3, bottom: 0, top: 5 }]);
  b.wallX(D / 2 - WALL_T / 2, -W / 2, W / 2, 0, H, WALL_T, wall, windows(W, 5, 4.5, 6.0, 2));
  b.wallZ(-W / 2 + WALL_T / 2, -D / 2 + WALL_T, D / 2 - WALL_T, 0, H, WALL_T, wall, [{ from: -0.6, to: 0.6, bottom: 0, top: DOOR_H }]);
  b.wallZ(W / 2 - WALL_T / 2, -D / 2 + WALL_T, D / 2 - WALL_T, 0, H, WALL_T, wall, windows(D - 2 * WALL_T, 3, 4.5, 6.0, 2));
  b.door(-W / 2 + WALL_T / 2, 0.6, DOOR_W, DOOR_H, Math.PI / 2);
  b.slab(-W / 2 - 0.3, W / 2 + 0.3, -D / 2 - 0.3, D / 2 + 0.3, H + 0.3, 0.3, rng.pick(PALETTE.roof));
  // Crates for cover (deterministic per building).
  for (let i = 0; i < 6; i++) {
    const x = rng.range(-W / 2 + 2, W / 2 - 2);
    const z = rng.range(-D / 2 + 3, D / 2 - 2);
    const size = rng.pick([0.6, 0.8, 1.0]);
    b.box(x, 0.15 + size, z, size, size, size, PALETTE.wood);
  }
}

/**
 * Tower block with `floors` storeys and a switchback stair in the back-right
 * corner that reaches every floor and the roof (two lanes; each floor's slab
 * has a hole above the flight that leads to it).
 */
export function buildTower(b: Builder, rng: Rng, floors: number): void {
  const W = 12;
  const D = 12;
  const FH = 3.4;
  const T = 0.3;
  const wall = rng.pick([...PALETTE.plaster, ...PALETTE.brick]);
  const steps = 12;
  const rise = FH / steps;
  const run = 0.28;
  const laneB: [number, number] = [W / 2 - T - 1.2, W / 2 - T];
  const laneA: [number, number] = [laneB[0] - 1.2, laneB[0]];
  const zLow = -1.7;
  const zHigh = zLow + steps * run;
  b.slab(-W / 2, W / 2, -D / 2, D / 2, 0.15, 0.3, PALETTE.concrete);
  for (let f = 0; f < floors; f++) {
    const base = 0.15 + f * FH;
    const lane = f % 2 === 0 ? laneA : laneB;
    if (f % 2 === 0) b.stairs(lane[0], lane[1], zLow, 1, base - 0.15, base, rise, run, steps, PALETTE.concrete);
    else b.stairs(lane[0], lane[1], zHigh, -1, base - 0.15, base, rise, run, steps, PALETTE.concrete);
    // Slab above this floor, with a hole over the flight that climbs to it.
    const top = base + FH;
    const isRoof = f === floors - 1;
    b.slab(-W / 2, W / 2, -D / 2, D / 2, top, 0.3, isRoof ? PALETTE.darkConcrete : PALETTE.concrete, {
      x0: lane[0] - 0.05,
      x1: lane[1],
      z0: zLow - 0.05,
      z1: zHigh + 0.05,
    });
    const frontOpenings: Opening[] = f === 0 ? [{ from: -0.9, to: 0.9, bottom: 0, top: DOOR_H + 0.2 }, ...windows(W, 4, 1.0, 2.5, 1.6, [-1.5, 1.5])] : windows(W, 4, 1.0, 2.6, 1.8);
    b.wallX(-D / 2 + T / 2, -W / 2, W / 2, base - 0.15, FH, T, wall, frontOpenings);
    b.wallX(D / 2 - T / 2, -W / 2, W / 2, base - 0.15, FH, T, wall, windows(W, 4, 1.0, 2.6, 1.8));
    b.wallZ(-W / 2 + T / 2, -D / 2 + T, D / 2 - T, base - 0.15, FH, T, wall, windows(D - 2 * T, 3, 1.0, 2.6, 1.8));
    b.wallZ(W / 2 - T / 2, -D / 2 + T, D / 2 - T, base - 0.15, FH, T, wall, windows(D - 2 * T, 3, 1.0, 2.6, 1.8, [zLow - 0.6, zHigh + 0.6]));
  }
  // Roof parapet.
  const roofTop = 0.15 + floors * FH;
  b.wallX(-D / 2 + 0.15, -W / 2, W / 2, roofTop, 1.0, 0.3, PALETTE.trim);
  b.wallX(D / 2 - 0.15, -W / 2, W / 2, roofTop, 1.0, 0.3, PALETTE.trim);
  b.wallZ(-W / 2 + 0.15, -D / 2 + 0.3, D / 2 - 0.3, roofTop, 1.0, 0.3, PALETTE.trim);
  b.wallZ(W / 2 - 0.15, -D / 2 + 0.3, D / 2 - 0.3, roofTop, 1.0, 0.3, PALETTE.trim);
}

// ------------------------------------------------------------------ landmarks

/** Slim clock tower with clock faces, a stair core and an open belfry with a launch pad. */
export function buildClockTower(b: Builder, rng: Rng): void {
  buildTower(b, rng, 7);
  const top = 0.15 + 7 * 3.4;
  for (const [x, z, yaw] of [
    [0, -6.2, 0],
    [0, 6.2, Math.PI],
    [-6.2, 0, Math.PI / 2],
    [6.2, 0, -Math.PI / 2],
  ] as const) {
    b.cylinder(x, top - 2.4, z, 1.8, 0.12, PALETTE.trim, "clock face", quatMultiply(axisQuat("y", yaw), axisQuat("x", Math.PI / 2)));
  }
  // Belfry posts and cap.
  for (const [x, z] of [
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ] as const) {
    b.cylinder(x, top + 2.2, z, 0.35, 2.2, PALETTE.trim);
  }
  b.span(-6, 6, top + 4.4, top + 4.8, -6, 6, PALETTE.roof[0]);
  b.launchPad(-2.5, top, -3);
}

/** Park gazebo: posts, a ring bench and a roof, standing on a low platform. */
export function buildGazebo(b: Builder): void {
  b.cylinder(0, 0.2, 0, 6, 0.2, PALETTE.wood, "gazebo floor");
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.cylinder(Math.cos(a) * 5.4, 2.0, Math.sin(a) * 5.4, 0.22, 1.6, PALETTE.trim);
  }
  b.cylinder(0, 3.8, 0, 6.4, 0.2, PALETTE.roof[1], "gazebo roof");
  b.cylinder(0, 4.4, 0, 3.2, 0.4, PALETTE.roof[1]);
}

/** Water tower: a tank on four legs with a walkable gantry and a pad on top. */
export function buildWaterTower(b: Builder): void {
  for (const [x, z] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ] as const) {
    b.cylinder(x, 7, z, 0.35, 7, PALETTE.metal);
  }
  b.cylinder(0, 14.2, 0, 5, 0.2, PALETTE.metal, "gantry");
  b.cylinder(0, 17.5, 0, 4, 3.1, PALETTE.signal, "tank");
  b.cylinder(0, 20.8, 0, 4.2, 0.2, PALETTE.trim);
  b.launchPad(0, 21, 0);
}

/** Gas station: canopy on pillars, pump islands and a small kiosk. */
export function buildGasStation(b: Builder, rng: Rng): void {
  for (const [x, z] of [
    [-6, -4],
    [6, -4],
    [-6, 4],
    [6, 4],
  ] as const) {
    b.cylinder(x, 2.6, z, 0.3, 2.6, PALETTE.trim);
  }
  b.span(-8, 8, 5.2, 5.7, -6, 6, PALETTE.signal);
  for (const x of [-3, 3]) {
    b.span(x - 1, x + 1, 0, 0.25, -2.5, 2.5, PALETTE.concrete);
    b.span(x - 0.4, x + 0.4, 0.25, 1.9, -0.6, 0.6, PALETTE.violet);
  }
  const kiosk = new Builder(b.out, b.toWorld(0, 0, 12), b.yaw, b.group);
  buildHouse(kiosk, rng, { floors: 1, pitched: false });
}

/** Wooden pier reaching out over the water with a boathouse at its end. */
export function buildPier(b: Builder, length: number): void {
  b.span(-1.5, 1.5, 0.6, 0.9, 0, length, PALETTE.wood, "pier");
  for (let z = 2; z < length; z += 4) {
    for (const x of [-1.4, 1.4]) b.cylinder(x, -1.5, z, 0.18, 2.3, PALETTE.wood);
  }
  b.span(-4, 4, 0.6, 0.9, length, length + 8, PALETTE.wood);
  b.wallX(length + 7.9, -4, 4, 0.9, 3, 0.2, PALETTE.wood, [{ from: -1.5, to: 1.5, bottom: 0, top: 2.4 }]);
  b.wallZ(-3.9, length, length + 8, 0.9, 3, 0.2, PALETTE.wood, windows(8, 2));
  b.wallZ(3.9, length, length + 8, 0.9, 3, 0.2, PALETTE.wood, windows(8, 2));
  b.span(-4.4, 4.4, 3.9, 4.1, length - 0.4, length + 8.4, PALETTE.roof[2]);
}

/** Lifeguard tower: raised hut on posts, reached by a stair. */
export function buildLifeguardTower(b: Builder): void {
  for (const [x, z] of [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
  ] as const) {
    b.cylinder(x, 2.2, z, 0.2, 2.2, PALETTE.trim);
  }
  b.span(-2.6, 2.6, 4.2, 4.5, -2.6, 2.6, PALETTE.wood);
  b.wallX(2.5, -2.6, 2.6, 4.5, 2.2, 0.15, PALETTE.signal, windows(5.2, 2, 0.9, 2.0, 1.6));
  b.wallZ(-2.5, -2.6, 2.6, 4.5, 2.2, 0.15, PALETTE.signal, windows(5.2, 1, 0.9, 2.0, 2));
  b.wallZ(2.5, -2.6, 2.6, 4.5, 2.2, 0.15, PALETTE.signal, windows(5.2, 1, 0.9, 2.0, 2));
  b.span(-2.8, 2.8, 6.7, 6.9, -2.8, 2.8, PALETTE.trim);
  // Stair down the front (15 steps of 0.3 m).
  b.stairs(-0.7, 0.7, -2.6, -1, 0, 0, 0.3, 0.32, 15, PALETTE.wood);
}

/** Windmill: round stone tower, cap and four static sails. */
export function buildWindmill(b: Builder): void {
  b.cylinder(0, 7, 0, 3.4, 7, 0xd9cfb8, "windmill tower");
  b.cylinder(0, 14.6, 0, 3.8, 0.6, PALETTE.roof[1]);
  for (let i = 0; i < 4; i++) {
    // A rotation of -a about z turns the sail's long (y) axis toward (sin a, cos a), where it sits.
    const a = (i * Math.PI) / 2 + 0.4;
    b.box(Math.sin(a) * 4.8, 12 + Math.cos(a) * 4.8, -3.8, 0.7, 4.4, 0.08, PALETTE.trim, "sail", axisQuat("z", -a));
  }
}

/** Greenhouse with glass walls and hedge rows around it. */
export function buildGreenhouse(b: Builder): void {
  const W = 16;
  const D = 10;
  b.slab(-W / 2, W / 2, -D / 2, D / 2, 0.15, 0.3, PALETTE.concrete);
  b.wallX(-D / 2 + 0.1, -W / 2, W / 2, 0, 3.4, 0.12, PALETTE.glass, [{ from: -0.8, to: 0.8, bottom: 0, top: 2.4 }]);
  b.wallX(D / 2 - 0.1, -W / 2, W / 2, 0, 3.4, 0.12, PALETTE.glass);
  b.wallZ(-W / 2 + 0.1, -D / 2, D / 2, 0, 3.4, 0.12, PALETTE.glass);
  b.wallZ(W / 2 - 0.1, -D / 2, D / 2, 0, 3.4, 0.12, PALETTE.glass);
  pitchedRoof(b, W, D, 3.4, PALETTE.glass);
  for (let i = 0; i < 4; i++) b.span(-6 + i * 4, -4.5 + i * 4, 0.15, 1.0, -2, 2, PALETTE.hedge);
  for (const z of [-12, 12]) b.span(-14, 14, 0, 1.6, z - 0.5, z + 0.5, PALETTE.hedge, "hedge");
  for (const x of [-14, 14]) b.span(x - 0.5, x + 0.5, 0, 1.6, -11.5, 11.5, PALETTE.hedge, "hedge");
}

/** Dock crane (tower, cab, boom) plus stacks of shipping containers. */
export function buildDockCrane(b: Builder, rng: Rng): void {
  for (const [x, z] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ] as const) {
    b.span(x - 0.4, x + 0.4, 0, 22, z - 0.4, z + 0.4, PALETTE.signal);
  }
  b.span(-4, 4, 22, 25, -4, 4, PALETTE.signal, "crane cab");
  b.span(-1, 1, 24, 25.5, -30, 10, PALETTE.signal, "crane boom");
  b.launchPad(0, 25, 0);
  // Container stacks (2.4 x 2.6 x 6 m).
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const height = rng.int(1, 4);
      for (let level = 0; level < height; level++) {
        const x = -14 + col * 3.2;
        const z = 10 + row * 7.5;
        b.span(x - 1.2, x + 1.2, level * 2.6, (level + 1) * 2.6, z - 3, z + 3, rng.pick(PALETTE.container), "container");
      }
    }
  }
}

/** Two tall cooling stacks beside a factory hall, with a pad between them. */
export function buildStacks(b: Builder, rng: Rng): void {
  b.cylinder(-14, 22, 0, 9, 22, 0xc7c1b6, "stack");
  b.cylinder(14, 22, 0, 9, 22, 0xc7c1b6, "stack");
  b.cylinder(-14, 44.6, 0, 9.4, 0.6, PALETTE.signal);
  b.cylinder(14, 44.6, 0, 9.4, 0.6, PALETTE.signal);
  b.launchPad(0, 0, 0);
  const hall = new Builder(b.out, b.toWorld(0, 0, 22), b.yaw, b.group);
  buildWarehouse(hall, rng, PALETTE.darkConcrete);
}

/** House on the island in the middle of Loot Lake, with a jetty. */
export function buildLakeHouse(b: Builder, rng: Rng): void {
  buildHouse(b, rng, { floors: 2, pitched: true });
  b.span(-1.2, 1.2, -0.1, 0.25, -4, -22, PALETTE.wood, "jetty");
}
