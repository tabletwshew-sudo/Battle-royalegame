import { describe, expect, it } from "vitest";
import { SIM_DT, SIM_HZ } from "../src/shared/sim/Constants";
import { EventQueue } from "../src/shared/sim/Events";
import { FixedStepper } from "../src/shared/sim/FixedStep";
import { hashToHex, StateHasher } from "../src/shared/sim/Hash";
import {
  ALL_BUTTONS,
  Button,
  MAX_PITCH,
  neutralInput,
  sanitizeInput,
  wasPressed,
  wasReleased,
} from "../src/shared/sim/InputFrame";
import { lerpAngle, lookDirection, wrapAngle } from "../src/shared/sim/MathUtil";

describe("FixedStepper", () => {
  it("runs at 60 Hz", () => {
    expect(SIM_HZ).toBe(60);
    expect(SIM_DT).toBeCloseTo(1 / 60, 12);
  });

  it("produces one step per 1/60 s on average at any frame rate", () => {
    for (const fps of [30, 60, 75, 144, 240]) {
      const stepper = new FixedStepper(SIM_DT);
      let steps = 0;
      for (let i = 0; i < fps * 10; i++) steps += stepper.advance(1 / fps);
      expect(Math.abs(steps - 600)).toBeLessThanOrEqual(1);
      expect(stepper.droppedSeconds).toBe(0);
    }
  });

  it("exposes an interpolation alpha between 0 and 1", () => {
    const stepper = new FixedStepper(SIM_DT);
    expect(stepper.advance(SIM_DT * 1.5)).toBe(1);
    expect(stepper.alpha).toBeCloseTo(0.5, 6);
    expect(stepper.advance(SIM_DT * 0.25)).toBe(0);
    expect(stepper.alpha).toBeCloseTo(0.75, 6);
  });

  it("caps steps after a long stall and records the dropped time", () => {
    const stepper = new FixedStepper(SIM_DT, 5);
    expect(stepper.advance(2)).toBe(5);
    expect(stepper.droppedSeconds).toBeGreaterThan(1.8);
    expect(stepper.alpha).toBeLessThanOrEqual(1);
    expect(stepper.advance(SIM_DT)).toBe(1);
  });

  it("ignores bad frame times and validates its arguments", () => {
    const stepper = new FixedStepper(SIM_DT);
    expect(stepper.advance(NaN)).toBe(0);
    expect(stepper.advance(-1)).toBe(0);
    expect(() => new FixedStepper(0)).toThrow();
    expect(() => new FixedStepper(SIM_DT, 0)).toThrow();
  });
});

describe("InputFrame", () => {
  it("detects press and release edges", () => {
    expect(wasPressed(Button.Fire, 0, Button.Fire)).toBe(true);
    expect(wasPressed(Button.Fire, Button.Fire, Button.Fire)).toBe(false);
    expect(wasReleased(0, Button.Jump, Button.Jump)).toBe(true);
    expect(wasReleased(Button.Jump, Button.Jump, Button.Jump)).toBe(false);
  });

  it("has unique single-bit buttons", () => {
    const bits = Object.values(Button);
    expect(new Set(bits).size).toBe(bits.length);
    for (const bit of bits) expect(bit & (bit - 1)).toBe(0);
  });

  it("sanitizes hostile input", () => {
    const clean = sanitizeInput({ moveX: 5, moveZ: -9, yaw: 100, pitch: 9, buttons: -1 });
    expect(Math.hypot(clean.moveX, clean.moveZ)).toBeCloseTo(1, 9);
    expect(Math.abs(clean.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(clean.pitch).toBe(MAX_PITCH);
    expect(clean.buttons).toBe(ALL_BUTTONS);

    const junk = sanitizeInput({ moveX: NaN, moveZ: Infinity, yaw: NaN, pitch: -Infinity, buttons: NaN });
    expect(junk).toEqual({ ...neutralInput(), moveZ: 0 });
  });
});

describe("EventQueue", () => {
  it("returns events in order with their tick and empties on drain", () => {
    const queue = new EventQueue();
    queue.push("sandboxKick", 3, { x: 1, y: 2, z: 3, bodies: 4 });
    queue.push("sandboxRespawn", 5, { generation: 1, crates: 10 });
    expect(queue.length).toBe(2);
    const events = queue.drain();
    expect(events).toEqual([
      { type: "sandboxKick", tick: 3, x: 1, y: 2, z: 3, bodies: 4 },
      { type: "sandboxRespawn", tick: 5, generation: 1, crates: 10 },
    ]);
    expect(queue.length).toBe(0);
    expect(queue.drain()).toEqual([]);
  });
});

describe("StateHasher", () => {
  it("is order-sensitive, stable and treats -0 like 0", () => {
    const a = new StateHasher().addNumber(1.5).addNumber(2).addInt(7).digest();
    const b = new StateHasher().addNumber(1.5).addNumber(2).addInt(7).digest();
    const c = new StateHasher().addNumber(2).addNumber(1.5).addInt(7).digest();
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(new StateHasher().addNumber(-0).digest()).toBe(new StateHasher().addNumber(0).digest());
    expect(new StateHasher().addNumber(1).digest()).not.toBe(new StateHasher().addNumber(1 + Number.EPSILON).digest());
    expect(hashToHex(255)).toBe("000000ff");
  });
});

describe("MathUtil", () => {
  it("wraps and interpolates angles along the short way", () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2, 9);
    const mid = lerpAngle(3.1, -3.1, 0.5);
    expect(Math.abs(wrapAngle(mid))).toBeGreaterThan(3.1);
  });

  it("uses the documented look convention", () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(lookDirection(0, 0, out)).toMatchObject({ x: -0, y: 0, z: -1 });
    lookDirection(Math.PI / 2, 0, out);
    expect(out.x).toBeCloseTo(-1, 9);
    expect(out.z).toBeCloseTo(0, 9);
    lookDirection(0, Math.PI / 2, out);
    expect(out.y).toBeCloseTo(1, 9);
  });
});
