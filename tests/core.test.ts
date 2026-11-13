import { describe, expect, it } from "vitest";
import { EventBus } from "../src/core/EventBus";
import { InputState, LOOK_RADIANS_PER_PIXEL } from "../src/core/Input";
import { effectivePixelRatio, QUALITY_PRESETS, resolveQuality } from "../src/core/Quality";
import {
  defaultSettings,
  migrateSettings,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  SettingsStore,
  type StorageLike,
} from "../src/core/Settings";
import { Button, MAX_PITCH } from "../src/shared/sim/InputFrame";

/** In-memory stand-in for localStorage. */
class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("EventBus", () => {
  it("delivers to subscribers and stops after unsubscribe", () => {
    const bus = new EventBus<{ ping: number; other: string }>();
    const seen: number[] = [];
    const off = bus.on("ping", (n) => seen.push(n));
    bus.emit("ping", 1);
    bus.emit("other", "ignored");
    expect(bus.count("ping")).toBe(1);
    off();
    bus.emit("ping", 2);
    expect(seen).toEqual([1]);
    expect(bus.count("ping")).toBe(0);
  });
});

describe("InputState", () => {
  it("maps bound keys to move axes and buttons", () => {
    const input = new InputState();
    input.setCode("KeyW", true);
    input.setCode("Space", true);
    input.setCode("Mouse0", true);
    let frame = input.sample();
    expect(frame.moveZ).toBe(1);
    expect(frame.moveX).toBe(0);
    expect(frame.buttons).toBe(Button.Jump | Button.Fire);

    input.setCode("KeyW", false);
    input.setCode("KeyS", true);
    input.setCode("ControlLeft", true);
    frame = input.sample();
    expect(frame.moveZ).toBe(-1);
    expect(frame.buttons & Button.Crouch).toBe(Button.Crouch);
  });

  it("normalizes diagonal movement and cancels opposite keys", () => {
    const input = new InputState();
    input.setCode("KeyW", true);
    input.setCode("KeyD", true);
    const frame = input.sample();
    expect(Math.hypot(frame.moveX, frame.moveZ)).toBeCloseTo(1, 9);
    input.setCode("KeyA", true);
    expect(input.sample().moveX).toBe(0);
  });

  it("turns mouse movement into yaw and pitch with sensitivity, invert and clamping", () => {
    const input = new InputState();
    input.addLook(100, 0);
    expect(input.yaw).toBeCloseTo(-100 * LOOK_RADIANS_PER_PIXEL, 9);
    input.addLook(0, -50);
    expect(input.pitch).toBeCloseTo(50 * LOOK_RADIANS_PER_PIXEL, 9);
    input.invertY = true;
    input.sensitivity = 2;
    input.addLook(0, -50);
    expect(input.pitch).toBeCloseTo(-50 * LOOK_RADIANS_PER_PIXEL, 9);
    input.invertY = false;
    for (let i = 0; i < 100; i++) input.addLook(0, -300);
    expect(input.pitch).toBe(MAX_PITCH);
    for (let i = 0; i < 100; i++) input.addLook(300, 0);
    expect(Math.abs(input.yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it("registers a tap that starts and ends between two samples exactly once", () => {
    const input = new InputState();
    input.setCode("KeyR", true);
    input.setCode("KeyR", false);
    expect(input.sample().buttons).toBe(Button.Reload);
    expect(input.sample().buttons).toBe(0);
    expect(input.isCodeDown("KeyR")).toBe(false);
  });

  it("ignores the mouse spike some browsers send right after pointer lock", () => {
    const input = new InputState();
    input.addLook(900, -700);
    expect(input.yaw).toBe(0);
    expect(input.pitch).toBe(0);
    input.addLook(40, 0);
    expect(input.yaw).toBeCloseTo(-40 * LOOK_RADIANS_PER_PIXEL, 9);
  });

  it("respects a custom pitch limit", () => {
    const input = new InputState();
    input.pitchLimit = 1;
    input.addLook(0, -300);
    input.addLook(0, -300);
    expect(input.pitch).toBe(1);
    input.setLook(0, -5);
    expect(input.pitch).toBe(-1);
  });

  it("releases everything at once and honours rebinding", () => {
    const input = new InputState();
    input.setCode("KeyW", true);
    input.releaseAll();
    expect(input.sample().moveZ).toBe(0);
    input.bindings.buttons.Jump = ["KeyJ"];
    input.setCode("Space", true);
    expect(input.sample().buttons).toBe(0);
    input.setCode("KeyJ", true);
    expect(input.sample().buttons).toBe(Button.Jump);
  });
});

describe("Quality", () => {
  it("prefers the URL flag, then the saved value, then medium", () => {
    expect(resolveQuality("ultra", "low").name).toBe("ultra");
    expect(resolveQuality(null, "low").name).toBe("low");
    expect(resolveQuality("potato", "nonsense").name).toBe("medium");
  });

  it("computes the pixel ratio from device ratio, cap and render scale", () => {
    expect(effectivePixelRatio(QUALITY_PRESETS.low, 2)).toBeCloseTo(0.6, 9);
    expect(effectivePixelRatio(QUALITY_PRESETS.ultra, 3)).toBeCloseTo(2, 9);
    expect(effectivePixelRatio(QUALITY_PRESETS.high, 1)).toBeCloseTo(1, 9);
  });
});

describe("Settings", () => {
  it("falls back to defaults for missing or broken data", () => {
    expect(migrateSettings(null)).toEqual(defaultSettings());
    expect(migrateSettings("junk")).toEqual(defaultSettings());
    expect(migrateSettings({ version: SETTINGS_VERSION + 5, fov: 100 })).toEqual(defaultSettings());
  });

  it("migrates version 0 saves and clamps values", () => {
    const migrated = migrateSettings({ sensitivity: 2.5, fov: 500, quality: "high", invertY: true });
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.mouseSensitivity).toBe(2.5);
    expect(migrated.fov).toBe(110);
    expect(migrated.quality).toBe("high");
    expect(migrated.invertY).toBe(true);
  });

  it("persists updates and notifies subscribers", () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage);
    let notified = 0;
    store.subscribe(() => notified++);
    store.update({ fov: 95, showStats: true });
    expect(notified).toBe(1);
    expect(JSON.parse(storage.data.get(SETTINGS_KEY) ?? "{}")).toMatchObject({ fov: 95, showStats: true, version: SETTINGS_VERSION });
    expect(new SettingsStore(storage).value.fov).toBe(95);
  });

  it("works without storage and with corrupt stored text", () => {
    const store = new SettingsStore(null);
    store.update({ fov: 70 });
    expect(store.value.fov).toBe(70);
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, "{not json");
    expect(new SettingsStore(storage).value).toEqual(defaultSettings());
  });
});
