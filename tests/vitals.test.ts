import { describe, expect, it } from "vitest";
import { applyDamage, applyHealthDamage, defaultVitalsConfig, freshVitals, tickVitals } from "../src/shared/combat/Vitals";
import { defaultMovementConfig, fallDamage } from "../src/shared/sim/MovementConfig";

const config = defaultVitalsConfig();

describe("Vitals layers", () => {
  it("spawns with full health and overshield, no shield", () => {
    expect(freshVitals(config)).toMatchObject({ health: 100, shield: 0, overshield: 50 });
  });

  it("takes damage overshield -> shield -> health with overflow in one hit", () => {
    const v = freshVitals(config);
    v.shield = 30;
    const result = applyDamage(v, 100);
    expect(result).toMatchObject({ overshield: 50, shield: 30, health: 20, brokeOvershield: true, brokeShield: true, lethal: false });
    expect(v).toMatchObject({ health: 80, shield: 0, overshield: 0 });
    expect(applyDamage(v, 500).lethal).toBe(true);
    expect(v.health).toBe(0);
  });

  it("health-only damage skips the shield layers", () => {
    const v = freshVitals(config);
    v.shield = 50;
    applyHealthDamage(v, 30);
    expect(v).toMatchObject({ health: 70, shield: 50, overshield: 50 });
  });

  it("regenerates the overshield 5 s after damage at 10/s, and damage resets the delay", () => {
    const v = freshVitals(config);
    applyDamage(v, 40);
    expect(v.overshield).toBe(10);
    for (let i = 0; i < 299; i++) tickVitals(v, config, 1 / 60);
    expect(v.overshield).toBe(10);
    for (let i = 0; i < 61; i++) tickVitals(v, config, 1 / 60);
    expect(v.overshield).toBeCloseTo(20, 0);
    applyDamage(v, 1);
    tickVitals(v, config, 1 / 60);
    expect(v.overshield).toBeCloseTo(19, 0);
    for (let i = 0; i < 2000; i++) tickVitals(v, config, 1 / 60);
    expect(v.overshield).toBe(50);
  });

  it("damage that must not reset regen keeps the timer running", () => {
    const v = freshVitals(config);
    applyDamage(v, 20);
    for (let i = 0; i < 240; i++) tickVitals(v, config, 1 / 60);
    applyDamage(v, 5, false);
    for (let i = 0; i < 62; i++) tickVitals(v, config, 1 / 60);
    expect(v.overshield).toBeGreaterThan(25);
  });
});

describe("Fall damage formula", () => {
  it("is clamp((v - 14) * 3.2, 0, 100)", () => {
    const m = defaultMovementConfig();
    expect(fallDamage(m, 10)).toBe(0);
    expect(fallDamage(m, 14)).toBe(0);
    expect(fallDamage(m, 24)).toBeCloseTo(32, 9);
    expect(fallDamage(m, 60)).toBe(100);
  });
});
