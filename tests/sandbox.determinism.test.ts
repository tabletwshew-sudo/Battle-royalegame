import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics, makeRayHit, PhysicsWorld } from "../src/shared/physics/PhysicsWorld";
import { checkDeterminism, firstDivergence, makeInputScript, runAndHash } from "../src/shared/sim/Determinism";
import { Button, type InputFrame, neutralInput } from "../src/shared/sim/InputFrame";
import { SandboxSim } from "../src/shared/sim/SandboxSim";
import { CRATE_AREA } from "../src/shared/world/Playground";

const create = (seed: number) => (): SandboxSim => new SandboxSim({ seed, crateCount: 40 });

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

  it("sphere-casts, tests capsule overlap and respects excluded colliders", () => {
    const world = new PhysicsWorld();
    world.addStaticBox({ x: 0, y: 1, z: -5 }, { x: 5, y: 1, z: 0.5 });
    const capsule = world.addCharacterCapsule({ x: 0, y: 1, z: 0 }, 0.55, 0.35);
    world.step();
    // Wall front face at z = -4.5; a 0.2 m sphere from z = 0 stops 0.2 m short.
    expect(world.sphereCast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 10, 0.2, { exclude: capsule })).toBeCloseTo(4.3, 2);
    expect(world.sphereCast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 10, 0.2, { exclude: capsule })).toBe(10);
    expect(world.capsuleOverlaps({ x: 0, y: 1, z: -4.6 }, 0.5, 0.3)).toBe(true);
    expect(world.capsuleOverlaps({ x: 0, y: 1, z: 0 }, 0.5, 0.3)).toBe(true);
    expect(world.capsuleOverlaps({ x: 0, y: 1, z: 0 }, 0.5, 0.3, { exclude: capsule })).toBe(false);
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

describe("Determinism harness (SandboxSim with player + Rapier)", () => {
  it("replays identically and survives snapshot/restore", () => {
    for (const seed of [1, 2024]) {
      const report = checkDeterminism(create(seed), seed, 480);
      expect(report.rerunDivergence).toBe(-1);
      expect(report.restoreDivergence).toBe(-1);
      expect(report.finalHash).not.toBe(0);
    }
  });

  it("stays identical through launch pad, skydive, glide, cut and landing with a mid-air snapshot", () => {
    // Walk onto the launch pad (spawn faces -Z; the pad is behind-left at x -6, z 19).
    const script: InputFrame[] = [];
    const push = (ticks: number, frame: InputFrame): void => {
      for (let i = 0; i < ticks; i++) script.push(frame);
    };
    const toPad = Math.atan2(-(-6 - 0), -(19 - 10));
    push(20, { moveX: 0, moveZ: 0, yaw: toPad, pitch: 0, buttons: 0 });
    push(110, { moveX: 0, moveZ: 1, yaw: toPad, pitch: 0, buttons: 0 });
    push(500, { moveX: 0.3, moveZ: 1, yaw: 0.4, pitch: -0.6, buttons: 0 });
    push(1, { moveX: 0, moveZ: 0, yaw: 0.4, pitch: 0, buttons: Button.Jump });
    push(300, { moveX: -0.5, moveZ: 0.5, yaw: 0.9, pitch: 0, buttons: 0 });
    push(1, { moveX: 0, moveZ: 0, yaw: 0.9, pitch: 0, buttons: Button.Jump });
    push(400, { moveX: 0, moveZ: 1, yaw: 0.9, pitch: 0, buttons: 0 });
    const report = checkDeterminism(create(9), 9, script.length, script);
    expect(report.rerunDivergence).toBe(-1);
    expect(report.restoreDivergence).toBe(-1);
    // Sanity: the script really went through the air modes.
    const sim = create(9)();
    const seen = new Set<string>();
    for (const frame of script) {
      sim.step(frame);
      seen.add(sim.player.state.mode);
    }
    sim.dispose();
    expect([...seen].sort()).toEqual(expect.arrayContaining(["glide", "skydive", "walk"]));
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

describe("SandboxSim props", () => {
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

  it("kicks crates at the point aimed at through the camera", () => {
    const sim = create(3)();
    for (let i = 0; i < 600; i++) sim.step(neutralInput());
    // Stand south-west of the pile and look at its centre, slightly downward.
    sim.player.teleport(CRATE_AREA.x, 0.05, CRATE_AREA.z + 14);
    const aim: InputFrame = { moveX: 0, moveZ: 0, yaw: 0, pitch: -0.2, buttons: 0 };
    for (let i = 0; i < 30; i++) sim.step(aim);
    sim.drainEvents();
    const before = Float32Array.from(sim.transforms);
    sim.step({ ...aim, buttons: Button.Fire });
    sim.step({ ...aim, buttons: Button.Fire });
    for (let i = 0; i < 30; i++) sim.step(aim);
    const kicks = sim.drainEvents().filter((event) => event.type === "sandboxKick");
    expect(kicks).toHaveLength(1);
    expect(kicks[0]?.type === "sandboxKick" && kicks[0].bodies).toBeGreaterThan(0);
    let moved = 0;
    for (let i = 0; i < sim.crateCount * 7; i += 7) {
      if (Math.abs((sim.transforms[i] as number) - (before[i] as number)) > 0.05) moved++;
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
    const events = a.drainEvents().filter((event) => event.type === "sandboxRespawn");
    expect(events).toEqual([{ type: "sandboxRespawn", tick: 60, generation: 1, crates: 40 }]);
    expect(a.hash()).toBe(b.hash());
    let high = 0;
    for (let i = 0; i < a.crateCount; i++) if ((a.transforms[i * 7 + 1] as number) > 1.5) high++;
    expect(high).toBeGreaterThan(25);
    a.dispose();
    b.dispose();
  });
});
