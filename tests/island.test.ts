import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics, makeRayHit, PhysicsWorld } from "../src/shared/physics/PhysicsWorld";
import { checkDeterminism } from "../src/shared/sim/Determinism";
import { StateHasher } from "../src/shared/sim/Hash";
import { type InputFrame, neutralInput } from "../src/shared/sim/InputFrame";
import { Rng } from "../src/shared/sim/Rng";
import { SandboxSim } from "../src/shared/sim/SandboxSim";
import { Biome, biomeAt, generateIsland, ISLAND } from "../src/shared/world/Island";
import { fbm, lattice, ridged, valueNoise } from "../src/shared/world/Noise";
import { buildStaticPhysics, rockWorldPoints } from "../src/shared/world/StaticWorld";
import { gridSize, heightAt, rapierHeights, slopeAt, type TerrainGrid } from "../src/shared/world/Terrain";

beforeAll(async () => {
  await initPhysics();
});

/** Digest of a height grid. */
function gridHash(grid: TerrainGrid): number {
  const hasher = new StateHasher();
  for (const h of grid.heights) hasher.addNumber(h);
  return hasher.digest();
}

describe("Noise", () => {
  it("is deterministic, bounded and seed-dependent", () => {
    expect(valueNoise(12.3, -4.5, 7)).toBe(valueNoise(12.3, -4.5, 7));
    expect(valueNoise(12.3, -4.5, 7)).not.toBe(valueNoise(12.3, -4.5, 8));
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.37 - 300;
      const z = i * 0.73 + 50;
      const v = valueNoise(x, z, 3);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(fbm(x, z, 3))).toBeLessThanOrEqual(1);
      const r = ridged(x, z, 3);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
    expect(lattice(1, 2, 3)).toBeGreaterThanOrEqual(0);
    expect(lattice(1, 2, 3)).toBeLessThan(1);
  });

  it("is continuous (no jumps across lattice lines)", () => {
    for (const x of [0.999999, 5.999999, -2.000001]) {
      expect(Math.abs(valueNoise(x, 0.5, 1) - valueNoise(x + 2e-6, 0.5, 1))).toBeLessThan(1e-4);
    }
  });
});

describe("Island generation", () => {
  const island = generateIsland(1);
  const grid = island.grid;

  it("is deterministic per seed and differs between seeds", () => {
    expect(generateIsland(1)).toBe(island);
    const hash = gridHash(grid);
    expect(hash).not.toBe(gridHash(generateIsland(2).grid));
    // The cache is per seed; regenerating seed 1 later must give the same terrain.
    expect(gridHash(generateIsland(1).grid)).toBe(hash);
  });

  it("is an island: ocean at the edges, land in the middle, beaches between", () => {
    const half = gridSize(grid) / 2 - 10;
    for (const [x, z] of [
      [-half, -half],
      [half, -half],
      [-half, half],
      [half, half],
    ] as const) {
      expect(heightAt(grid, x, z)).toBeLessThan(ISLAND.seaLevel);
    }
    expect(heightAt(grid, 0, 0)).toBeGreaterThan(ISLAND.seaLevel);
    let sand = 0;
    for (const b of island.biomes) if (b === Biome.Sand) sand++;
    expect(sand).toBeGreaterThan(1000);
  });

  it("has 11 POIs on flat pads above the water", () => {
    expect(island.pois).toHaveLength(11);
    for (const poi of island.pois) {
      expect(poi.padHeight).toBeGreaterThanOrEqual(4);
      if (poi.lakeRadius > 0) continue;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = poi.flatRadius * 0.8;
        expect(heightAt(grid, poi.x + Math.cos(a) * r, poi.z + Math.sin(a) * r)).toBeCloseTo(poi.padHeight, 3);
      }
    }
  });

  it("carves Loot Lake with an island in the middle", () => {
    const loot = island.pois.find((p) => p.id === "lootlake");
    expect(loot).toBeDefined();
    if (loot === undefined) return;
    expect(heightAt(grid, loot.x, loot.z)).toBeGreaterThan(2);
    expect(heightAt(grid, loot.x + 90, loot.z)).toBeLessThan(-3);
  });

  it("has mountains with cliffs and launch pads on peaks", () => {
    let max = -Infinity;
    for (const h of grid.heights) max = Math.max(max, h);
    expect(max).toBeGreaterThan(50);
    expect(island.peaks.length).toBeGreaterThanOrEqual(2);
    for (const peak of island.peaks) expect(peak.y).toBeGreaterThan(25);
    expect(island.world.launchPads.length).toBeGreaterThanOrEqual(island.peaks.length + 3);
  });

  it("places buildings, doors and props sensibly", () => {
    const w = island.world;
    expect(w.boxes.length).toBeGreaterThan(3000);
    expect(w.doors.length).toBeGreaterThan(30);
    expect(w.trees.length).toBeGreaterThan(3000);
    expect(w.rocks.length).toBeGreaterThan(100);
    for (const box of w.boxes) {
      expect(Number.isFinite(box.center.x + box.center.y + box.center.z)).toBe(true);
      expect(Math.min(box.half.x, box.half.y, box.half.z)).toBeGreaterThan(0);
    }
    for (const tree of w.trees) {
      expect(tree.y).toBeGreaterThan(ISLAND.seaLevel + 0.9);
      expect(biomeAt(island, tree.x, tree.z)).not.toBe(Biome.Town);
      expect(slopeAt(grid, tree.x, tree.z)).toBeLessThan(31);
    }
    // Every POI got its buildings.
    const groups = new Set(w.boxes.map((b) => b.group));
    for (const poi of island.pois) expect(groups.has(poi.id)).toBe(true);
  });

  it("keeps the shared height sampler identical to the physics heightfield", () => {
    const physics = new PhysicsWorld();
    const size = gridSize(grid);
    physics.addHeightfield(grid.cells, rapierHeights(grid), { x: grid.originX + size / 2, y: 0, z: grid.originZ + size / 2 }, size);
    physics.step();
    const rng = new Rng(5);
    const hit = makeRayHit();
    for (let i = 0; i < 300; i++) {
      const x = rng.range(-1100, 1100);
      const z = rng.range(-1100, 1100);
      const found = physics.raycast({ x, y: 400, z }, { x: 0, y: -1, z: 0 }, 1000, hit);
      expect(found).not.toBeNull();
      expect(400 - (found?.distance ?? 0)).toBeCloseTo(heightAt(grid, x, z), 3);
    }
    physics.dispose();
  });

  it("builds a convex collider for every rock", () => {
    const physics = new PhysicsWorld();
    const stats = buildStaticPhysics(physics, island.world);
    const w = island.world;
    expect(stats.colliders).toBe(1 + w.boxes.length + w.cylinders.length + w.trees.length + w.rocks.length);
    const rock = w.rocks[0];
    const prototype = rock === undefined ? undefined : w.rockPrototypes[rock.prototype];
    if (rock !== undefined && prototype !== undefined) {
      const points = rockWorldPoints(prototype, rock);
      expect(points.length).toBe(prototype.points.length);
    }
    physics.dispose();
  });
});

describe("Island sandbox", () => {
  const walk = (moveZ: number, yaw: number): InputFrame => ({ moveX: 0, moveZ, yaw, pitch: 0, buttons: 0 });

  it("spawns the player standing on the ground at Tilted Towers", () => {
    const sim = new SandboxSim({ seed: 1, crateCount: 0, world: "island", dummy: false });
    for (let i = 0; i < 60; i++) sim.step(neutralInput());
    const p = sim.player.state;
    expect(p.grounded).toBe(true);
    const tilted = generateIsland(1).pois.find((poi) => poi.id === "tilted");
    expect(p.y).toBeCloseTo(tilted?.padHeight ?? 0, 0);
    sim.dispose();
  });

  it("replays identically on the island, including a snapshot restore", () => {
    const create = (): SandboxSim => new SandboxSim({ seed: 3, crateCount: 10, world: "island" });
    const report = checkDeterminism(create, 3, 360);
    expect(report.rerunDivergence).toBe(-1);
    expect(report.restoreDivergence).toBe(-1);
  });

  it("swims across Loot Lake and wades out on the far shore", () => {
    const sim = new SandboxSim({ seed: 1, crateCount: 0, world: "island", dummy: false });
    const loot = generateIsland(1).pois.find((poi) => poi.id === "lootlake");
    if (loot === undefined) throw new Error("no Loot Lake");
    // Drop into the lake east of the island and swim east to the shore.
    sim.player.teleport(loot.x + 70, 3, loot.z);
    const east = -Math.PI / 2;
    let swam = false;
    let floatY = 0;
    for (let i = 0; i < 60 * 40; i++) {
      sim.step(walk(1, east));
      if (sim.player.state.mode === "swim") {
        swam = true;
        floatY = sim.player.state.y;
        expect(sim.player.horizontalSpeed).toBeLessThanOrEqual(4.5 + 1e-6);
      }
      if (swam && sim.player.state.mode === "walk") break;
    }
    const events = sim.drainEvents();
    expect(swam).toBe(true);
    expect(events.some((e) => e.type === "splash")).toBe(true);
    expect(events.filter((e) => e.type === "land").every((e) => e.type !== "land" || e.damage === 0)).toBe(true);
    expect(floatY).toBeLessThan(0);
    expect(sim.player.state.mode).toBe("walk");
    expect(sim.player.state.x).toBeGreaterThan(loot.x + 80);
    sim.dispose();
  });
});
