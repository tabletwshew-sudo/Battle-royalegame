import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics, makeRayHit, PhysicsWorld } from "../src/shared/physics/PhysicsWorld";
import { checkDeterminism, firstDivergence, makeInputScript, runAndHash } from "../src/shared/sim/Determinism";
import { Button, neutralInput } from "../src/shared/sim/InputFrame";
import { SandboxSim } from "../src/shared/sim/SandboxSim";

const create = (seed: number) => (): SandboxSim => new SandboxSim({ seed, crateCount: 60, obstacleCount: 8 });

beforeAll(async () => {
  await initPhysics();
});

describe("PhysicsWorld", () => {
  it("raycasts against static geometry and reports distance, point and normal", () => {
    const world = new PhysicsWorld();
    world.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 10, y: 0.5, z: 10 });
    world.step();
    const hit = world.raycast({ x: 1, y: 5, z: 2 }, { x: 0, y: -1, z: 0 }, 20, makeRayHit());
    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(5, 4);
    expect(hit?.point.y).toBeCloseTo(0, 4);
    expect(hit?.normal.y).toBeCloseTo(1, 4);
    expect(world.raycast({ x: 1, y: 5, z: 2 }, { x: 0, y: 1, z: 0 }, 20, makeRayHit())).toBeNull();
    expect(world.raycast({ x: 1, y: 5, z: 2 }, { x: 0, y: -1, z: 0 }, 2, makeRayHit())).toBeNull();
    world.dispose();
  });

  it("drops a dynamic box onto the ground and lets it come to rest", () => {
    const world = new PhysicsWorld();
    world.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 10, y: 0.5, z: 10 });
    const body = world.addDynamicBox({ x: 0, y: 3, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 });
    for (let i = 0; i < 240; i++) world.step();
    expect(body.translation().y).toBeCloseTo(0.5, 1);
    expect(world.bodyCount).toBe(1);
    expect(world.colliderCount).toBe(2);
    world.dispose();
  });
});

describe("Determinism harness (SandboxSim + Rapier)", () => {
  it("replays identically and survives snapshot/restore", () => {
    for (const seed of [1, 2024]) {
      const report = checkDeterminism(create(seed), seed, 480);
      expect(report.rerunDivergence).toBe(-1);
      expect(report.restoreDivergence).toBe(-1);
      expect(report.finalHash).not.toBe(0);
    }
  });

  it("produces different worlds for different seeds", () => {
    const script = makeInputScript(1, 120);
    const a = create(1)();
    const b = create(2)();
    expect(firstDivergence(runAndHash(a, script), runAndHash(b, script))).toBe(0);
    a.dispose();
    b.dispose();
  });

  it("is sensitive to a single changed input", () => {
    const script = makeInputScript(5, 200);
    const altered = script.map((frame) => ({ ...frame }));
    altered[100]!.moveZ = altered[100]!.moveZ === 1 ? 0 : 1;
    const a = create(5)();
    const b = create(5)();
    expect(firstDivergence(runAndHash(a, script), runAndHash(b, altered))).toBe(100);
    a.dispose();
    b.dispose();
  });

  it("generates the same input script for the same seed", () => {
    expect(makeInputScript(8, 50)).toEqual(makeInputScript(8, 50));
    expect(makeInputScript(8, 50)).not.toEqual(makeInputScript(9, 50));
  });
});

describe("SandboxSim behaviour", () => {
  it("lets crates fall and settle on the ground", () => {
    const sim = create(3)();
    for (let i = 0; i < 900; i++) sim.step(neutralInput());
    for (let i = 0; i < sim.crateCount; i++) {
      const y = sim.transforms[i * 7 + 1] as number;
      expect(y).toBeGreaterThan(0.3);
      expect(y).toBeLessThan(12);
    }
    expect(sim.awakeCount).toBeLessThan(sim.crateCount);
    expect(sim.tick).toBe(900);
    sim.dispose();
  });

  it("moves the probe with input and keeps the previous state for interpolation", () => {
    const sim = create(3)();
    const startZ = sim.probe.z;
    sim.step({ moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0 });
    expect(sim.probe.z).toBeCloseTo(startZ - 10 / 60, 6);
    expect(sim.previousProbe.z).toBe(startZ);
    sim.step({ moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: Button.Sprint });
    expect(sim.probe.z).toBeCloseTo(startZ - 10 / 60 - 30 / 60, 6);
    const y = sim.probe.y;
    sim.step({ moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: Button.Jump });
    expect(sim.probe.y).toBeGreaterThan(y);
    sim.dispose();
  });

  it("emits one kick event per press and pushes nearby crates", () => {
    const sim = create(3)();
    for (let i = 0; i < 600; i++) sim.step(neutralInput());
    sim.drainEvents();
    // Fly level to the middle of the yard (26 m at 10 m/s), then aim straight down at the pile.
    for (let i = 0; i < 156; i++) sim.step({ moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0 });
    expect(Math.abs(sim.probe.z)).toBeLessThan(0.2);
    const aim = { moveX: 0, moveZ: 0, yaw: 0, pitch: -1.45, buttons: 0 };
    sim.step(aim);
    const before = Float32Array.from(sim.transforms);
    sim.step({ ...aim, buttons: Button.Fire });
    sim.step({ ...aim, buttons: Button.Fire });
    for (let i = 0; i < 30; i++) sim.step(aim);
    const events = sim.drainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("sandboxKick");
    const kick = events[0] as Extract<(typeof events)[number], { type: "sandboxKick" }>;
    expect(kick.bodies).toBeGreaterThan(0);
    let moved = 0;
    for (let i = 0; i < sim.crateCount; i++) {
      if (Math.abs((sim.transforms[i * 7 + 1] as number) - (before[i * 7 + 1] as number)) > 0.05) moved++;
    }
    expect(moved).toBeGreaterThan(0);
    sim.dispose();
  });

  it("respawns crates on Reload with a new reproducible layout", () => {
    const a = create(4)();
    const b = create(4)();
    for (const sim of [a, b]) {
      for (let i = 0; i < 60; i++) sim.step(neutralInput());
      sim.step({ ...neutralInput(), buttons: Button.Reload });
    }
    const events = a.drainEvents();
    expect(events).toEqual([{ type: "sandboxRespawn", tick: 60, generation: 1, crates: 60 }]);
    expect(a.hash()).toBe(b.hash());
    let high = 0;
    for (let i = 0; i < a.crateCount; i++) if ((a.transforms[i * 7 + 1] as number) > 1.5) high++;
    expect(high).toBeGreaterThan(40);
    a.dispose();
    b.dispose();
  });
});
