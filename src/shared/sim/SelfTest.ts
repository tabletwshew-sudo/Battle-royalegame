import { defaultRules, type RulesConfig } from "../rules/RulesConfig";
import { findBlock, PLAYGROUND, buildPlayground } from "../world/Playground";
import type { SimEvent, SimEventType } from "./Events";
import { Button, type InputFrame } from "./InputFrame";
import { fallDamage, jumpVelocity } from "./MovementConfig";
import type { PlayerState } from "./PlayerSim";
import { SandboxSim } from "./SandboxSim";
import { SIM_DT } from "./Constants";

/**
 * Movement self-test (F9 panel and `npm test`). Each case drives a fresh
 * SandboxSim through scripted inputs on the playground course and checks
 * the result against the spec values. Pure sim code, so the browser runs
 * exactly what the tests run.
 *
 * Yaw reminder: 0 faces -Z, PI faces +Z, -PI/2 faces +X, PI/2 faces -X.
 */

export interface SelfTestResult {
  name: string;
  passed: boolean;
  /** Measured values on success, the failed expectation otherwise. */
  detail: string;
}

class SelfTestFailure extends Error {}

const FACE_PLUS_Z = Math.PI;
const FACE_PLUS_X = -Math.PI / 2;
const FACE_MINUS_X = Math.PI / 2;

/** Open ground far from every course piece. */
const OPEN = { x: 150, z: 150 } as const;

/** Builds an input frame. */
function frame(moveZ = 0, yaw = 0, buttons = 0, moveX = 0, pitch = 0): InputFrame {
  return { moveX, moveZ, yaw, pitch, buttons };
}

/** Test bench around one SandboxSim with an event log. */
class Bench {
  readonly sim: SandboxSim;
  readonly log: SimEvent[] = [];

  constructor(rules: RulesConfig = defaultRules(), dummy = false) {
    this.sim = new SandboxSim({ seed: 1, crateCount: 0, rules, dummy });
  }

  get p(): PlayerState {
    return this.sim.player.state;
  }

  get speed(): number {
    return this.sim.player.horizontalSpeed;
  }

  /** Teleports the player and lets it settle for a few ticks facing `yaw`. */
  place(x: number, y: number, z: number, yaw = 0, settleTicks = 15): void {
    this.sim.player.teleport(x, y, z);
    this.run(settleTicks, frame(0, yaw));
  }

  /** Runs `ticks` ticks with the same input and records events. */
  run(ticks: number, input: InputFrame): void {
    for (let i = 0; i < ticks; i++) this.tick(input);
  }

  /** Runs until `until()` is true or `maxTicks` passed; returns ticks used (or -1). */
  runUntil(maxTicks: number, input: InputFrame, until: () => boolean): number {
    for (let i = 0; i < maxTicks; i++) {
      this.tick(input);
      if (until()) return i + 1;
    }
    return -1;
  }

  tick(input: InputFrame): void {
    this.sim.step(input);
    this.log.push(...this.sim.drainEvents());
  }

  events<K extends SimEventType>(type: K): Extract<SimEvent, { type: K }>[] {
    return this.log.filter((event): event is Extract<SimEvent, { type: K }> => event.type === type);
  }

  clearLog(): void {
    this.log.length = 0;
  }

  dispose(): void {
    this.sim.dispose();
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new SelfTestFailure(message);
}

function near(value: number, target: number, tolerance: number, label: string): void {
  expect(Math.abs(value - target) <= tolerance, `${label}: ${value.toFixed(3)} (expected ${target} ± ${tolerance})`);
}

const f2 = (n: number): string => n.toFixed(2);

/** Highest feet height reached while running `ticks` ticks. */
function apexOver(bench: Bench, ticks: number, input: InputFrame): number {
  let apex = -Infinity;
  for (let i = 0; i < ticks; i++) {
    bench.tick(input);
    apex = Math.max(apex, bench.p.y);
  }
  return apex;
}

/** Drops the player from `height` above open ground and returns the land event. */
function drop(bench: Bench, height: number, rollTicksBefore = -1): Extract<SimEvent, { type: "land" }> | undefined {
  bench.place(OPEN.x, 0.05, OPEN.z);
  bench.sim.player.teleport(OPEN.x, height, OPEN.z);
  bench.clearLog();
  // Fall time under constant gravity (the terminal speed is far away for these drops).
  const fallTicks = Math.ceil(Math.sqrt((2 * height) / 25) / SIM_DT);
  for (let i = 0; i < fallTicks + 30; i++) {
    const press = rollTicksBefore >= 0 && i === fallTicks - rollTicksBefore;
    bench.tick(frame(0, 0, press ? Button.Jump : 0));
    if (bench.events("land").length > 0) break;
  }
  return bench.events("land")[0];
}

type Case = { name: string; run: (bench: Bench) => string; rules?: Partial<RulesConfig>; dummy?: boolean };

const CASES: Case[] = [
  {
    name: "Sprint reaches 8.5 m/s and drains 10 stamina/s",
    run: (b) => {
      b.place(OPEN.x, 0.05, OPEN.z);
      b.run(120, frame(1, 0, Button.Sprint));
      expect(b.p.sprinting, "not sprinting");
      near(b.speed, 8.5, 0.01, "speed");
      near(b.p.stamina, 80, 0.5, "stamina after 2 s");
      return `speed ${f2(b.speed)} m/s, stamina ${f2(b.p.stamina)}`;
    },
  },
  {
    name: "Empty stamina ends sprint, locks out 0.5 s, regenerates after 0.8 s",
    run: (b) => {
      b.place(OPEN.x, 0.05, OPEN.z);
      const ticks = b.runUntil(900, frame(1, 0, Button.Sprint), () => b.events("staminaEmpty").length > 0);
      expect(ticks > 0, "stamina never ran out");
      near(ticks * SIM_DT, 10, 0.1, "seconds of sprint");
      expect(!b.p.sprinting, "still sprinting at 0 stamina");
      b.run(20, frame(1, 0, Button.Sprint));
      expect(!b.p.sprinting, "sprint restarted inside the lockout / below 15");
      b.run(25, frame(1, 0));
      near(b.p.stamina, 0, 1e-9, "stamina before the regen delay");
      b.run(10, frame(1, 0));
      expect(b.p.stamina > 0, "no regen after the delay");
      return `empty after ${(ticks * SIM_DT).toFixed(2)} s, regen ${f2(b.p.stamina)} after 1 s`;
    },
  },
  {
    name: "Sprint needs 15 stamina to start",
    run: (b) => {
      b.place(OPEN.x, 0.05, OPEN.z);
      b.p.stamina = 10;
      b.p.sinceDrain = -100;
      b.run(10, frame(1, 0, Button.Sprint));
      expect(!b.p.sprinting, "sprint started at 10 stamina");
      b.p.stamina = 16;
      b.run(2, frame(1, 0, Button.Sprint));
      expect(b.p.sprinting, "sprint did not start at 16 stamina");
      return "refused at 10, started at 16";
    },
  },
  {
    name: "Pickaxe in hand: unlimited sprint",
    run: (b) => {
      b.place(OPEN.x, 0.05, OPEN.z);
      b.tick(frame(0, 0, Button.Pickaxe));
      expect(b.p.equipSlot === 0, "pickaxe not equipped");
      b.run(300, frame(1, 0, Button.Sprint));
      expect(b.p.sprinting, "not sprinting");
      near(b.p.stamina, 100, 1e-9, "stamina");
      return `5 s sprint, stamina ${f2(b.p.stamina)}`;
    },
  },
  {
    name: "Sprint holsters the held item; it comes back 0.25 s after",
    run: (b) => {
      b.place(OPEN.x, 0.05, OPEN.z);
      expect(b.sim.player.canUseItem, "item not usable at rest");
      b.run(30, frame(1, 0, Button.Sprint));
      expect(b.p.holstered && !b.sim.player.canUseItem, "item usable while sprinting");
      b.run(10, frame(1, 0));
      expect(!b.sim.player.canUseItem, "item usable right after sprint");
      b.run(10, frame(1, 0));
      expect(b.sim.player.canUseItem, "item still lowered 0.33 s after sprint");
      return "holstered while sprinting, raised after 0.25 s";
    },
  },
  {
    name: "Sprint jump is 15% higher than a standing jump",
    run: (b) => {
      b.place(OPEN.x, 0.05, OPEN.z);
      const base = b.p.y;
      b.tick(frame(0, 0, Button.Jump));
      const normal = apexOver(b, 70, frame()) - base;
      b.run(60, frame(1, 0, Button.Sprint));
      const sprintBase = b.p.y;
      b.tick(frame(1, 0, Button.Sprint | Button.Jump));
      const sprint = apexOver(b, 70, frame(1, 0, Button.Sprint)) - sprintBase;
      near(normal, 1.2, 0.01, "standing jump");
      near(sprint, 1.38, 0.02, "sprint jump");
      return `standing ${f2(normal)} m, sprint ${f2(sprint)} m`;
    },
  },
  {
    name: "Slide on flat ground starts from a run, slows and ends",
    run: (b) => {
      b.place(OPEN.x, 0.05, OPEN.z);
      b.run(60, frame(1, 0, Button.Sprint));
      b.tick(frame(1, 0, Button.Sprint | Button.Crouch));
      expect(b.p.mode === "slide" && b.p.crouched, `mode ${b.p.mode} after crouch press`);
      const start = b.speed;
      const ticks = b.runUntil(300, frame(1, 0, Button.Crouch), () => b.p.mode !== "slide");
      expect(ticks > 0, "slide never ended");
      near(start, 8.5, 0.2, "slide start speed");
      return `start ${f2(start)} m/s, ended after ${(ticks * SIM_DT).toFixed(2)} s`;
    },
  },
  {
    name: "Sliding down the 30 degree mesa ramp accelerates",
    run: (b) => {
      // Mesa top, just west of the ramp's top edge (x = -56), facing +X down the ramp.
      b.place(-58, PLAYGROUND.mesaHeight + 0.05, -40, FACE_PLUS_X);
      b.run(30, frame(1, FACE_PLUS_X, Button.Sprint));
      b.tick(frame(1, FACE_PLUS_X, Button.Crouch));
      let top = 0;
      for (let i = 0; i < 240 && b.p.mode === "slide"; i++) {
        b.tick(frame(1, FACE_PLUS_X, Button.Crouch));
        top = Math.max(top, b.speed);
      }
      expect(top > 15, `top speed only ${f2(top)} m/s`);
      expect(top <= 20.001, `speed cap exceeded: ${f2(top)}`);
      return `top speed ${f2(top)} m/s (cap 20)`;
    },
  },
  {
    name: "Slide jump keeps the slide speed x1.15",
    run: (b) => {
      b.place(OPEN.x, 0.05, OPEN.z);
      b.run(60, frame(1, 0, Button.Sprint));
      b.tick(frame(1, 0, Button.Crouch));
      b.run(10, frame(1, 0, Button.Crouch));
      const before = b.speed;
      b.tick(frame(1, 0, Button.Crouch | Button.Jump));
      const jump = b.events("jump").at(-1);
      expect(jump !== undefined && jump.slide, "no slide jump");
      near(b.speed / before, 1.15, 0.03, "speed ratio");
      return `${f2(before)} -> ${f2(b.speed)} m/s`;
    },
  },
  {
    name: "Boosted jump: jumping out of a downhill slide adds lift",
    run: (b) => {
      b.place(-58, PLAYGROUND.mesaHeight + 0.05, -40, FACE_PLUS_X);
      b.run(30, frame(1, FACE_PLUS_X, Button.Sprint));
      b.tick(frame(1, FACE_PLUS_X, Button.Crouch));
      b.run(60, frame(1, FACE_PLUS_X, Button.Crouch));
      expect(b.p.mode === "slide", `left the slide early: ${b.p.mode}`);
      b.tick(frame(1, FACE_PLUS_X, Button.Crouch | Button.Jump));
      const jump = b.events("jump").at(-1);
      expect(jump !== undefined && jump.boosted, "jump not boosted");
      const normal = jumpVelocity(b.sim.movement, SIM_DT);
      expect(b.p.vy + 25 * SIM_DT > normal + 1, `take-off ${f2(b.p.vy)} m/s vs normal ${f2(normal)}`);
      return `take-off ${f2(b.p.vy + 25 * SIM_DT)} m/s (normal ${f2(normal)})`;
    },
  },
  {
    name: "Slide into sprint keeps the momentum",
    run: (b) => {
      b.place(-58, PLAYGROUND.mesaHeight + 0.05, -40, FACE_PLUS_X);
      b.run(30, frame(1, FACE_PLUS_X, Button.Sprint));
      b.tick(frame(1, FACE_PLUS_X, Button.Crouch));
      // Slide down to the flat ground east of the ramp.
      const ticks = b.runUntil(400, frame(1, FACE_PLUS_X, Button.Crouch), () => b.p.y < 0.2 && b.p.x > -12);
      expect(ticks > 0, "never reached the bottom");
      const bottom = b.speed;
      b.tick(frame(1, FACE_PLUS_X, Button.Sprint));
      expect(b.p.mode === "walk" && b.p.sprinting, `mode ${b.p.mode}, sprinting ${b.p.sprinting}`);
      b.run(18, frame(1, FACE_PLUS_X, Button.Sprint));
      expect(b.speed > 10, `speed dropped to ${f2(b.speed)} m/s`);
      return `bottom ${f2(bottom)} m/s, 0.3 s into sprint ${f2(b.speed)} m/s`;
    },
  },
  {
    name: "Mantle walls: 1.5 m and 2.3 m climb, 2.7 m does not",
    run: (b) => {
      const out: string[] = [];
      for (const height of [1.5, 2.3, 2.7]) {
        const wall = findBlock(b.sim.blocks, `mantle ${height} m`);
        b.place(wall.center.x, 0.05, wall.center.z - wall.half.z - 0.6, FACE_PLUS_Z);
        b.clearLog();
        b.tick(frame(1, FACE_PLUS_Z, Button.Jump));
        b.run(60, frame(1, FACE_PLUS_Z));
        const mantled = b.events("traverse").some((e) => e.kind === "mantle");
        if (height <= 2.3) {
          expect(mantled, `no mantle onto ${height} m`);
          near(b.p.y, height, 0.05, `feet on ${height} m wall`);
          expect(b.p.mode === "walk" && b.p.grounded, `not standing after mantle (${b.p.mode})`);
        } else {
          expect(!mantled, "mantled a 2.7 m wall");
          expect(b.p.y < 1.5, "ended up on the 2.7 m wall");
        }
        out.push(`${height} m ${mantled ? "climbed" : "refused"}`);
      }
      return out.join(", ");
    },
  },
  {
    name: "Mantle duration grows with height (0.3-0.75 s) and blocks items 0.35 s after",
    run: (b) => {
      const durations: string[] = [];
      for (const height of [0.5, 2.3]) {
        const wall = findBlock(b.sim.blocks, `mantle ${height} m`);
        b.place(wall.center.x, 0.05, wall.center.z - wall.half.z - 0.6, FACE_PLUS_Z);
        b.tick(frame(1, FACE_PLUS_Z, Button.Jump));
        expect(b.p.mode === "mantle", `no mantle at ${height} m (${b.p.mode})`);
        const expected = b.p.travelDuration;
        const ticks = b.runUntil(120, frame(0, FACE_PLUS_Z), () => b.p.mode !== "mantle");
        near((ticks + 1) * SIM_DT, expected, 2 * SIM_DT, `mantle time at ${height} m`);
        durations.push(`${height} m: ${expected.toFixed(2)} s`);
      }
      near(b.p.travelDuration, 0.75, 1e-9, "2.3 m duration");
      expect(!b.sim.player.canUseItem, "item usable right after the mantle");
      b.run(20, frame());
      expect(!b.sim.player.canUseItem, "item usable before 0.35 s");
      b.run(2, frame());
      expect(b.sim.player.canUseItem, "item still lowered after 0.37 s");
      return durations.join(", ");
    },
  },
  {
    name: "Falling past a ledge grabs it with no fall damage",
    run: (b) => {
      const wall = findBlock(b.sim.blocks, "mantle 2.3 m");
      const top = wall.center.y + wall.half.y;
      b.sim.player.teleport(wall.center.x, 12, wall.center.z - wall.half.z - 0.42);
      b.clearLog();
      // Fall straight down past the face, then push into the wall near the top.
      b.runUntil(120, frame(0, FACE_PLUS_Z), () => b.p.y < top + 0.8);
      b.runUntil(60, frame(1, FACE_PLUS_Z), () => b.events("traverse").length > 0);
      b.runUntil(60, frame(0, FACE_PLUS_Z), () => b.p.mode === "walk");
      const grab = b.events("traverse")[0];
      expect(grab !== undefined && grab.airborne, "no airborne mantle");
      expect(b.p.vitals.health === 100, `took damage: health ${b.p.vitals.health}`);
      near(b.p.y, 2.3, 0.05, "feet on the ledge");
      return `grabbed at ${f2(grab?.height ?? 0)} m above the feet, health 100`;
    },
  },
  {
    name: "Hurdle a 0.9 m fence at sprint speed",
    run: (b) => {
      const fence = findBlock(b.sim.blocks, "fence 0.9 m");
      b.place(fence.center.x, 0.05, fence.center.z - 6, FACE_PLUS_Z);
      b.runUntil(120, frame(1, FACE_PLUS_Z, Button.Sprint), () => b.p.z > fence.center.z - 1.2);
      b.clearLog();
      b.tick(frame(1, FACE_PLUS_Z, Button.Sprint | Button.Jump));
      const hurdle = b.events("traverse")[0];
      expect(hurdle !== undefined && hurdle.kind === "hurdle", `no hurdle (${hurdle?.kind ?? "nothing"})`);
      b.runUntil(60, frame(1, FACE_PLUS_Z, Button.Sprint), () => b.p.mode === "walk");
      expect(b.p.z > fence.center.z + 0.4, `did not cross: z ${f2(b.p.z)}`);
      expect(b.speed >= 5.5, `slowed to ${f2(b.speed)} m/s`);
      return `crossed at ${f2(b.speed)} m/s`;
    },
  },
  {
    name: "A 1.4 m fence is mantled, not hurdled",
    run: (b) => {
      const fence = findBlock(b.sim.blocks, "fence 1.4 m");
      b.place(fence.center.x, 0.05, fence.center.z - 6, FACE_PLUS_Z);
      b.runUntil(120, frame(1, FACE_PLUS_Z, Button.Sprint), () => b.p.z > fence.center.z - 1.2);
      b.clearLog();
      b.tick(frame(1, FACE_PLUS_Z, Button.Sprint | Button.Jump));
      const move = b.events("traverse")[0];
      expect(move !== undefined && move.kind === "mantle", `got ${move?.kind ?? "nothing"}`);
      return "mantle";
    },
  },
  {
    name: "Sprinting into a closed door bashes it open (one door per sprint)",
    run: (b) => {
      // South hut door: hinge x 37.4, panel to x 38.6 at z = 24.
      b.place(38, 0.05, 18, FACE_PLUS_Z);
      b.runUntil(120, frame(1, FACE_PLUS_Z, Button.Sprint), () => b.p.z > 26);
      const bash = b.events("door").find((e) => e.action === "bash");
      expect(bash !== undefined && bash.door === 0, "door not bashed");
      expect(Math.abs(b.sim.doors.states[0]?.angle ?? 0) > 1.5, "door not swung open");
      expect(b.p.z > 26, `blocked by the door: z ${f2(b.p.z)}`);
      expect(b.p.bashUsed, "bash not recorded for this sprint");
      return `bashed, door at ${(((b.sim.doors.states[0]?.angle ?? 0) * 180) / Math.PI).toFixed(0)} deg`;
    },
  },
  {
    name: "Interact opens and closes a door",
    run: (b) => {
      b.place(38, 0.05, 22.9, FACE_PLUS_Z);
      b.tick(frame(0, FACE_PLUS_Z, Button.Interact));
      b.run(40, frame(0, FACE_PLUS_Z));
      expect(!b.sim.doors.isClosed(0), "door did not open");
      b.tick(frame(0, FACE_PLUS_Z, Button.Interact));
      b.run(60, frame(0, FACE_PLUS_Z));
      expect(b.sim.doors.isClosed(0), "door did not close");
      return b.events("door").map((e) => e.action).join(" -> ");
    },
  },
  {
    name: "Fall damage = (impact speed - 14) x 3.2, to health only",
    run: (b) => {
      const land = drop(b, 15);
      expect(land !== undefined, "never landed");
      const expected = fallDamage(b.sim.movement, land?.speed ?? 0);
      near(land?.damage ?? 0, expected, 1e-9, "damage");
      near(b.p.vitals.health, 100 - expected, 1e-9, "health");
      near(b.p.vitals.overshield, 50, 1e-9, "overshield untouched");
      return `15 m: ${f2(land?.speed ?? 0)} m/s -> ${f2(expected)} damage`;
    },
  },
  {
    name: "Roll landing halves fall damage and refunds stamina",
    run: (b) => {
      const plain = drop(b, 15);
      b.sim.player.resetVitals();
      b.p.stamina = 50;
      b.p.sinceDrain = -100;
      const rolled = drop(b, 15, 6);
      expect(rolled !== undefined && rolled.roll, "no roll");
      near(rolled?.damage ?? 0, (plain?.damage ?? 0) / 2, 0.5, "rolled damage");
      expect(b.p.mode === "roll", `mode ${b.p.mode}`);
      near(b.p.stamina, 60, 0.01, "stamina after refund");
      return `${f2(plain?.damage ?? 0)} -> ${f2(rolled?.damage ?? 0)} damage`;
    },
  },
  {
    name: "Modern rule: a lethal fall leaves 1 HP, strips shields and splats for 1.5 s",
    run: (b) => {
      b.p.vitals.shield = 60;
      const land = drop(b, 70);
      expect(land !== undefined && land.splat, "no splat");
      near(b.p.vitals.health, 1, 1e-9, "health");
      expect(b.p.vitals.shield === 0 && b.p.vitals.overshield === 0, "shields not stripped");
      expect(b.p.mode === "splat", `mode ${b.p.mode}`);
      const x = b.p.x;
      b.run(60, frame(1, 0, Button.Jump));
      near(b.p.x, x, 1e-6, "moved during splat");
      const ticks = b.runUntil(60, frame(1, 0), () => b.p.mode === "walk");
      near((60 + ticks) * SIM_DT, 1.5, 3 * SIM_DT, "splat time");
      return `impact ${f2(land?.speed ?? 0)} m/s -> 1 HP, splat 1.5 s`;
    },
  },
  {
    name: "Classic rule: a lethal fall eliminates",
    rules: { nonLethalFalls: false },
    run: (b) => {
      drop(b, 70);
      const eliminated = b.events("eliminated")[0];
      expect(eliminated !== undefined && eliminated.cause === "fall", "not eliminated");
      expect(b.events("respawn").some((e) => e.reason === "eliminated"), "no sandbox respawn");
      return "eliminated, respawned at the spawn";
    },
  },
  {
    name: "Launch pad -> skydive -> glider opens at 120 m above ground",
    run: (b) => {
      const pad = findBlock(b.sim.blocks, "launch pad");
      b.place(pad.center.x, pad.center.y + pad.half.y + 0.05, pad.center.z, 0, 2);
      b.runUntil(30, frame(), () => b.events("launch").length > 0);
      expect(b.events("launch").length === 1, "not launched");
      b.runUntil(600, frame(), () => b.p.mode === "skydive");
      expect(b.p.mode === "skydive", "no skydive at the apex");
      const apex = b.p.y;
      b.runUntil(900, frame(), () => b.p.mode === "glide");
      const open = b.events("gliderOpen")[0];
      expect(open !== undefined && !open.redeploy, "glider did not open");
      near(b.p.aboveGround, 120, 1.5, "deploy height");
      return `apex ${apex.toFixed(0)} m, glider at ${b.p.aboveGround.toFixed(1)} m`;
    },
  },
  {
    name: "Glider: 22 m/s forward and 7 m/s sink; W and S trade speed for sink",
    run: (b) => {
      b.sim.player.teleport(OPEN.x, 200, OPEN.z);
      b.sim.player.startSkydive();
      b.tick(frame(0, 0, Button.Jump));
      expect(b.p.mode === "glide", `mode ${b.p.mode}`);
      const measure = (moveZ: number): [number, number] => {
        b.run(120, frame(moveZ));
        return [b.speed, -b.p.vy];
      };
      const [base, baseSink] = measure(0);
      const [fast, fastSink] = measure(1);
      const [slow, slowSink] = measure(-1);
      near(base, 22, 0.05, "forward");
      near(baseSink, 7, 0.05, "sink");
      near(fast, 26, 0.05, "W forward");
      near(fastSink, 10, 0.05, "W sink");
      near(slow, 16, 0.05, "S forward");
      near(slowSink, 5, 0.05, "S sink");
      return `${f2(base)}/${f2(baseSink)}, W ${f2(fast)}/${f2(fastSink)}, S ${f2(slow)}/${f2(slowSink)}`;
    },
  },
  {
    name: "Glider heading follows the look; A/D bank it 35 degrees aside",
    run: (b) => {
      b.sim.player.teleport(OPEN.x, 200, OPEN.z);
      b.sim.player.startSkydive();
      b.tick(frame(0, 0, Button.Jump));
      b.run(120, frame(0, 0.8));
      near(b.p.glideHeading, 0.8, 1e-6, "heading after looking 0.8 rad left");
      b.run(120, frame(0, 0.8, 0, -1));
      near(b.p.glideHeading, 0.8 + (35 * Math.PI) / 180, 1e-6, "heading while holding A");
      expect(b.p.glideBank > 0.2, `no visual bank (${f2(b.p.glideBank)})`);
      b.run(120, frame(0, 0.8, 0, 1));
      near(b.p.glideHeading, 0.8 - (35 * Math.PI) / 180, 1e-6, "heading while holding D");
      return `look 0.80, A ${f2(0.8 + 0.61)}, D ${f2(0.8 - 0.61)} rad`;
    },
  },
  {
    name: "Glider cut, then redeploy only after falling 6 m at 12 m/s",
    run: (b) => {
      b.sim.player.teleport(OPEN.x, 200, OPEN.z);
      b.sim.player.startSkydive();
      b.tick(frame(0, 0, Button.Jump));
      b.run(30, frame());
      b.tick(frame(0, 0, Button.Jump));
      expect(b.events("gliderClose").some((e) => e.cut), "glider not cut");
      expect(b.p.mode === "walk", `mode ${b.p.mode}`);
      b.tick(frame());
      b.tick(frame(0, 0, Button.Jump));
      expect(b.p.mode === "walk", "redeployed too early");
      const ticks = b.runUntil(
        120,
        frame(),
        () => b.sim.player.fallDistance > 6 && -b.p.vy > 12 && b.p.gliderCooldown <= 0,
      );
      expect(ticks > 0, "never fell fast enough");
      b.tick(frame());
      b.tick(frame(0, 0, Button.Jump));
      const reopen = b.events("gliderOpen").at(-1);
      expect(b.p.mode === "glide" && reopen !== undefined && reopen.redeploy, "redeploy refused");
      return `redeployed after ${f2(b.sim.player.fallDistance)} m`;
    },
  },
  {
    name: "Glider landings take no fall damage",
    run: (b) => {
      b.sim.player.teleport(OPEN.x, 40, OPEN.z);
      b.sim.player.startSkydive();
      b.tick(frame(0, 0, Button.Jump));
      b.runUntil(600, frame(), () => b.events("land").length > 0);
      const land = b.events("land")[0];
      expect(land !== undefined && land.damage === 0, `landing damage ${land?.damage ?? "none"}`);
      expect(b.events("gliderClose").some((e) => !e.cut), "glider did not auto-close");
      return `landed at ${f2(land?.speed ?? 0)} m/s, no damage`;
    },
  },
  {
    name: "Run off the mesa and redeploy the glider",
    run: (b) => {
      b.place(-70, PLAYGROUND.mesaHeight + 0.05, -40, FACE_MINUS_X);
      b.runUntil(120, frame(1, FACE_MINUS_X, Button.Sprint), () => !b.p.grounded && b.sim.player.fallDistance > 7);
      b.tick(frame(1, FACE_MINUS_X));
      b.tick(frame(1, FACE_MINUS_X, Button.Jump));
      expect(b.p.mode === "glide", `mode ${b.p.mode}`);
      b.runUntil(600, frame(1, FACE_MINUS_X), () => b.events("land").length > 0);
      expect((b.events("land")[0]?.damage ?? -1) === 0, "landing hurt");
      return `opened after ${f2(PLAYGROUND.mesaHeight - b.p.y)} m drop`;
    },
  },
  {
    name: "Slide kick: 15 damage + knockback, once per 10 s per target",
    dummy: true,
    run: (b) => {
      const dummy = b.sim.dummy;
      expect(dummy !== null, "no dummy");
      if (dummy === null) return "";
      const d = dummy.state;
      // Start south of the dummy (it stands at z = 4) and slide north into it.
      b.place(d.x, 0.05, d.z + 9, 0);
      b.runUntil(60, frame(1, 0, Button.Sprint), () => b.p.z < d.z + 4);
      b.tick(frame(1, 0, Button.Crouch));
      b.runUntil(60, frame(1, 0, Button.Crouch), () => b.events("slideKick").length > 0);
      const kick = b.events("slideKick")[0];
      expect(kick !== undefined && kick.target === dummy.id, "no kick");
      near(d.vitals.overshield, 35, 1e-9, "dummy overshield");
      b.run(30, frame());
      expect(Math.hypot(d.x - 4, d.z - 4) > 1, "dummy not knocked back");
      b.place(d.x, 0.05, d.z + 9, 0);
      b.runUntil(60, frame(1, 0, Button.Sprint), () => b.p.z < d.z + 4);
      b.tick(frame(1, 0, Button.Crouch));
      b.run(40, frame(1, 0, Button.Crouch));
      expect(b.events("slideKick").length === 1, "kicked again inside the cooldown");
      return "15 damage, knockback, second kick refused";
    },
  },
];

/** Names of every case, in order. */
export function selfTestNames(): string[] {
  return CASES.map((c) => c.name);
}

/** Runs one case by index. initPhysics() must have resolved. */
export function runSelfTest(index: number): SelfTestResult {
  const testCase = CASES[index];
  if (testCase === undefined) throw new Error(`No self-test #${index}`);
  const bench = new Bench({ ...defaultRules(), ...testCase.rules }, testCase.dummy ?? false);
  try {
    return { name: testCase.name, passed: true, detail: testCase.run(bench) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { name: testCase.name, passed: false, detail };
  } finally {
    bench.dispose();
  }
}

/** Runs every case. */
export function runAllSelfTests(): SelfTestResult[] {
  return CASES.map((_, i) => runSelfTest(i));
}

/** The playground blocks used by the cases (for documentation and debug overlays). */
export function selfTestPlayground(): ReturnType<typeof buildPlayground> {
  return buildPlayground(1);
}
