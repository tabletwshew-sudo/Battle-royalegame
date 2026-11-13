import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initPhysics } from "../src/shared/physics/PhysicsWorld";
import { computeCameraPose, defaultCameraConfig, makeCameraPose } from "../src/shared/sim/CameraRig";
import { SIM_DT } from "../src/shared/sim/Constants";
import { Button, type InputFrame, neutralInput } from "../src/shared/sim/InputFrame";
import { defaultMovementConfig, jumpVelocity } from "../src/shared/sim/MovementConfig";
import { SandboxSim } from "../src/shared/sim/SandboxSim";
import { buildPlayground, findBlock, PLAYGROUND } from "../src/shared/world/Playground";

/**
 * Movement v1 behaviour against the playground course. Positions come from
 * the Playground layout: ramps at x = -22/-16/-10/-4 (20/35/48/55 degrees),
 * step flights at x = 6/11/16 (0.3/0.45/0.6 m rises), all rising toward -Z
 * from z = 0; the crouch tunnel is centred at (0, -20).
 */

let sim: SandboxSim;
const sims: SandboxSim[] = [];

beforeAll(async () => {
  await initPhysics();
});

afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

function newSim(): SandboxSim {
  sim = new SandboxSim({ seed: 1, crateCount: 0 });
  sims.push(sim);
  return sim;
}

const idle = neutralInput();
/** Holds W (and optional buttons) facing `yaw`. */
const forward = (buttons = 0, yaw = 0): InputFrame => ({ moveX: 0, moveZ: 1, yaw, pitch: 0, buttons });

function run(ticks: number, frame: InputFrame): void {
  for (let i = 0; i < ticks; i++) sim.step(frame);
}

/** Puts the player at (x, z) on the ground and lets it settle. */
function placeAt(x: number, z: number, y = 0.05): void {
  sim.player.teleport(x, y, z);
  run(20, idle);
}

/** Walks forward for `ticks` and reports the highest feet height reached. */
function walkAndTrackHeight(ticks: number, buttons = 0): number {
  let maxY = -Infinity;
  for (let i = 0; i < ticks; i++) {
    sim.step(forward(buttons));
    maxY = Math.max(maxY, sim.player.state.y);
  }
  return maxY;
}

describe("MovementConfig", () => {
  it("matches the spec defaults", () => {
    const c = defaultMovementConfig();
    expect([c.runSpeed, c.crouchSpeed, c.adsWalkSpeed, c.gravity, c.jumpHeight]).toEqual([6, 3, 3.5, 25, 1.2]);
    expect([c.coyoteTime, c.jumpBuffer, c.capsuleRadius, c.standHeight, c.crouchHeight]).toEqual([0.1, 0.12, 0.35, 1.8, 1.1]);
    expect([c.autostepHeight, c.maxSlopeDeg]).toEqual([0.45, 50]);
  });

  it("compensates the jump velocity for the fixed-step integrator", () => {
    const v = jumpVelocity(defaultMovementConfig(), SIM_DT);
    expect(v).toBeGreaterThan(Math.sqrt(2 * 25 * 1.2));
    // Discrete apex: v^2/2g - v dt/2 = h.
    expect((v * v) / 50 - (v * SIM_DT) / 2).toBeCloseTo(1.2, 9);
  });
});

describe("PlayerController: ground movement", () => {
  it("spawns on the ground at the playground spawn", () => {
    newSim();
    run(30, idle);
    const p = sim.player.state;
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(0, 2);
    expect(p.x).toBeCloseTo(PLAYGROUND.spawn.x, 3);
    expect(p.z).toBeCloseTo(PLAYGROUND.spawn.z, 3);
  });

  it.each([
    ["run", 0, 6.0],
    ["crouch", Button.Crouch, 3.0],
    ["ADS walk", Button.Ads, 3.5],
  ])("reaches %s speed", (_name, buttons, speed) => {
    newSim();
    placeAt(40, 40);
    run(60, forward(buttons, Math.PI / 2));
    expect(sim.player.horizontalSpeed).toBeCloseTo(speed, 3);
  });

  it("is not faster diagonally and moves relative to the look yaw", () => {
    newSim();
    placeAt(40, 40);
    run(60, { moveX: Math.SQRT1_2, moveZ: Math.SQRT1_2, yaw: 0, pitch: 0, buttons: 0 });
    expect(sim.player.horizontalSpeed).toBeCloseTo(6, 3);
    const p = sim.player.state;
    // Facing -Z, forward + right = toward -Z and +X.
    expect(p.vx).toBeGreaterThan(4);
    expect(p.vz).toBeLessThan(-4);
  });

  it("stops quickly when input is released", () => {
    newSim();
    placeAt(40, 40);
    run(60, forward());
    run(10, idle);
    expect(sim.player.horizontalSpeed).toBeLessThan(0.01);
  });

  it("is stopped by walls without sticking", () => {
    newSim();
    // Walk north into the tunnel's west wall face from the side (wall spans x -1.6..-1.0).
    placeAt(-1.3, -14);
    run(80, forward());
    const p = sim.player.state;
    expect(p.z).toBeGreaterThan(-17 + 0.3);
    expect(sim.player.horizontalSpeed).toBeLessThan(0.5);
  });
});

describe("PlayerController: jumping", () => {
  it("reaches the configured jump height on flat ground and lands", () => {
    newSim();
    placeAt(40, 40);
    const y0 = sim.player.state.y;
    sim.step({ ...idle, buttons: Button.Jump });
    let apex = y0;
    for (let i = 0; i < 90; i++) {
      sim.step(idle);
      apex = Math.max(apex, sim.player.state.y);
    }
    expect(apex - y0).toBeCloseTo(1.2, 2);
    expect(sim.player.state.grounded).toBe(true);
    const types = sim.drainEvents().map((e) => e.type);
    expect(types.filter((t) => t === "jump")).toHaveLength(1);
    expect(types[types.length - 1]).toBe("land");
  });

  it("does not jump again while the key stays held", () => {
    newSim();
    placeAt(40, 40);
    sim.drainEvents();
    run(150, { ...idle, buttons: Button.Jump });
    expect(sim.drainEvents().filter((e) => e.type === "jump")).toHaveLength(1);
  });

  it("allows a jump within coyote time after walking off a ledge, but not later", () => {
    const platform = findBlock(buildPlayground(1), "platform");
    const topY = platform.center.y + platform.half.y;
    const edgeZ = platform.center.z - platform.half.z;
    for (const [delayTicks, shouldJump] of [
      [3, true],
      [12, false],
    ] as const) {
      newSim();
      placeAt(platform.center.x, edgeZ + 1.5, topY + 0.05);
      // Walk north off the edge, then press jump a few ticks after leaving the ground.
      let ticksAirborne = -1;
      for (let i = 0; i < 120 && ticksAirborne < delayTicks; i++) {
        sim.step(forward());
        if (!sim.player.state.grounded) ticksAirborne++;
      }
      sim.drainEvents();
      sim.step(forward(Button.Jump));
      const jumped = sim.drainEvents().some((e) => e.type === "jump");
      expect(jumped, `delay ${delayTicks} ticks`).toBe(shouldJump);
    }
  });

  it("buffers a jump pressed shortly before landing, but not one pressed too early", () => {
    for (const [ticksBeforeLanding, shouldJump] of [
      [5, true],
      [12, false],
    ] as const) {
      newSim();
      placeAt(40, 40);
      // Measure when a drop from 3 m lands, then replay with the press timed before it.
      sim.player.teleport(40, 3, 40);
      let landTick = 0;
      for (let i = 0; i < 120; i++) {
        sim.step(idle);
        if (sim.player.state.grounded) {
          landTick = i;
          break;
        }
      }
      sim.player.teleport(40, 3, 40);
      sim.drainEvents();
      for (let i = 0; i < landTick + 3; i++) {
        const press = i === landTick - ticksBeforeLanding;
        sim.step(press ? { ...idle, buttons: Button.Jump } : idle);
      }
      const jumped = sim.drainEvents().some((e) => e.type === "jump");
      expect(jumped, `${ticksBeforeLanding} ticks early`).toBe(shouldJump);
    }
  });

  it("reports the impact speed on landing", () => {
    newSim();
    placeAt(40, 40);
    sim.player.teleport(40, 5, 40);
    sim.drainEvents();
    run(90, idle);
    const land = sim.drainEvents().find((e) => e.type === "land");
    // Free fall of ~5 m under 25 m/s^2: about sqrt(2*25*5) = 15.8 m/s.
    expect(land?.type === "land" && land.speed).toBeGreaterThan(14);
    expect(land?.type === "land" && land.speed).toBeLessThan(17);
  });

  it("puts the player back at spawn after falling out of the world", () => {
    newSim();
    sim.player.teleport(150, 0, 150);
    run(200, idle);
    const respawned = sim.drainEvents().some((e) => e.type === "respawn");
    expect(respawned).toBe(true);
    expect(Math.hypot(sim.player.state.x - PLAYGROUND.spawn.x, sim.player.state.z - PLAYGROUND.spawn.z)).toBeLessThan(0.5);
  });
});

describe("PlayerController: steps and slopes", () => {
  it.each([
    [0.3, 6, true],
    [0.45, 11, true],
    [0.6, 16, false],
  ])("steps of %s m: climbable = %s", (rise, x, climbable) => {
    newSim();
    placeAt(x, 2);
    const maxY = walkAndTrackHeight(180);
    if (climbable) expect(maxY).toBeGreaterThan(rise * 5);
    else expect(maxY).toBeLessThan(0.1);
  });

  it.each([
    [20, -22, true],
    [35, -16, true],
    [48, -10, true],
    [55, -4, false],
  ])("%s degree ramp: climbable = %s", (angle, x, climbable) => {
    newSim();
    placeAt(x, 2);
    const maxY = walkAndTrackHeight(240);
    const top = 9 * Math.sin((angle * Math.PI) / 180);
    if (climbable) expect(maxY).toBeGreaterThan(top - 0.5);
    else expect(maxY).toBeLessThan(0.6);
  });

  it("keeps most of its speed going up a walkable slope", () => {
    newSim();
    placeAt(-16, 2);
    let speedOnRamp = 0;
    for (let i = 0; i < 120; i++) {
      sim.step(forward());
      const p = sim.player.state;
      if (p.y > 2 && p.y < 4) speedOnRamp = Math.hypot(p.vx, p.vy, p.vz);
    }
    // Surface speed equals run speed on the 35 degree ramp.
    expect(speedOnRamp).toBeGreaterThan(5.5);
  });
});

describe("PlayerController: crouch", () => {
  it("fits through the crouch tunnel only when crouched and stays crouched under the roof", () => {
    newSim();
    placeAt(0, -15);
    run(80, forward());
    expect(sim.player.state.z).toBeGreaterThan(-17.1);

    newSim();
    placeAt(0, -15);
    run(100, forward(Button.Crouch));
    expect(sim.player.state.z).toBeLessThan(-18);
    expect(sim.player.state.crouched).toBe(true);
    // Release crouch under the roof: still crouched.
    run(10, idle);
    expect(sim.player.state.crouched).toBe(true);
    // Walk out the far end (without holding crouch) and stand up automatically.
    run(120, forward());
    expect(sim.player.state.z).toBeLessThan(-23.5);
    expect(sim.player.state.crouched).toBe(false);
  });

  it("blends the crouch amount smoothly", () => {
    newSim();
    placeAt(40, 40);
    sim.step({ ...idle, buttons: Button.Crouch });
    const first = sim.player.state.crouchBlend;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5);
    run(30, { ...idle, buttons: Button.Crouch });
    expect(sim.player.state.crouchBlend).toBe(1);
  });
});

describe("PlayerController: aiming, shoulder and facing", () => {
  it("blends ADS in over adsTime and back out", () => {
    newSim();
    placeAt(40, 40);
    run(6, { ...idle, buttons: Button.Ads });
    expect(sim.player.state.adsBlend).toBeCloseTo(0.5, 5);
    run(10, { ...idle, buttons: Button.Ads });
    expect(sim.player.state.adsBlend).toBe(1);
    run(12, idle);
    expect(sim.player.state.adsBlend).toBe(0);
  });

  it("swaps shoulders on press and eases between sides", () => {
    newSim();
    placeAt(40, 40);
    expect(sim.player.state.shoulder).toBe(1);
    sim.step({ ...idle, buttons: Button.ShoulderSwap });
    expect(sim.player.state.shoulder).toBe(-1);
    expect(sim.player.state.shoulderBlend).toBeGreaterThan(0);
    run(20, { ...idle, buttons: Button.ShoulderSwap });
    expect(sim.player.state.shoulderBlend).toBe(-1);
    sim.step(idle);
    sim.step({ ...idle, buttons: Button.ShoulderSwap });
    expect(sim.player.state.shoulder).toBe(1);
  });

  it("turns the body toward the look while moving, but not for small idle look changes", () => {
    newSim();
    placeAt(40, 40);
    run(30, { ...idle, yaw: 0.5 });
    expect(sim.player.state.bodyYaw).toBeCloseTo(0, 5);
    run(30, { ...forward(0, 0.5) });
    expect(sim.player.state.bodyYaw).toBeCloseTo(0.5, 5);
    run(60, { ...idle, yaw: 0.5 + Math.PI / 2 });
    expect(sim.player.state.bodyYaw).toBeCloseTo(0.5 + Math.PI / 2, 5);
  });

  it("clamps the pitch to the camera limit", () => {
    newSim();
    sim.step({ ...idle, pitch: 1.5 });
    expect(sim.player.state.pitch).toBeCloseTo((80 * Math.PI) / 180, 9);
  });
});

describe("CameraRig", () => {
  const config = defaultCameraConfig();
  const subject = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouchBlend: 0, adsBlend: 0, shoulderBlend: 1 };

  it("places the hip camera over the right shoulder, behind the player", () => {
    const pose = computeCameraPose(subject, config, null, null, makeCameraPose());
    expect(pose.position.x).toBeCloseTo(0.55, 6);
    expect(pose.position.y).toBeCloseTo(1.6, 6);
    expect(pose.position.z).toBeCloseTo(3.2, 6);
    expect(pose.forward.z).toBeCloseTo(-1, 6);
    expect(pose.fovScale).toBe(1);
  });

  it("moves closer, zooms and lowers for ADS and crouch; mirrors for the left shoulder", () => {
    const ads = computeCameraPose({ ...subject, adsBlend: 1 }, config, null, null, makeCameraPose());
    expect(ads.armLength).toBeCloseTo(config.adsDistance, 6);
    expect(ads.fovScale).toBeCloseTo(config.adsFovScale, 6);
    const crouch = computeCameraPose({ ...subject, crouchBlend: 1 }, config, null, null, makeCameraPose());
    expect(crouch.position.y).toBeCloseTo(config.crouchPivotHeight, 6);
    const left = computeCameraPose({ ...subject, shoulderBlend: -1 }, config, null, null, makeCameraPose());
    expect(left.position.x).toBeCloseTo(-0.55, 6);
  });

  it("orbits with yaw and pitch", () => {
    const pose = computeCameraPose({ ...subject, yaw: Math.PI / 2, pitch: 0.5 }, config, null, null, makeCameraPose());
    // Looking toward -X and up: the camera sits toward +X and below the pivot.
    expect(pose.forward.x).toBeLessThan(-0.8);
    expect(pose.forward.y).toBeGreaterThan(0.4);
    expect(pose.position.x).toBeGreaterThan(2);
    expect(pose.position.y).toBeLessThan(config.pivotHeight);
  });

  it("pulls the arm in against walls and pulls the pivot in at a side wall", () => {
    newSim();
    // Between the two camera walls (z = 12 and 15), looking along +Z: the north wall is behind.
    placeAt(24, 13.5);
    const p = sim.player.state;
    const pose = computeCameraPose(
      { ...subject, x: p.x, y: p.y, z: p.z, yaw: Math.PI },
      config,
      sim.world,
      sim.player.collider,
      makeCameraPose(),
    );
    expect(pose.idealArmLength).toBeCloseTo(3.2, 6);
    expect(pose.armLength).toBeLessThan(1.5);
    // The camera stays on the player's side of the wall (wall face at z = 14.6).
    expect(pose.position.z).toBeLessThan(14.6 - config.probeRadius + 0.01);

    // Facing +X (yaw -PI/2) the right shoulder points to +Z, toward the south wall.
    const side = computeCameraPose(
      { ...subject, x: p.x, y: p.y, z: 14.0, yaw: -Math.PI / 2 },
      config,
      sim.world,
      sim.player.collider,
      makeCameraPose(),
    );
    expect(side.pivot.z).toBeLessThan(14.6 - config.probeRadius + 0.01);
    expect(side.pivot.z).toBeGreaterThan(14.0);
  });
});
