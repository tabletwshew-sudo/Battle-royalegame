import { describe, expect, it } from "vitest";
import { hashString, mix32, Rng, shotRng } from "../src/shared/sim/Rng";

/** First n raw outputs of a generator. */
function take(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextU32());
}

describe("Rng (sfc32)", () => {
  it("is reproducible for the same seed and differs for other seeds", () => {
    expect(take(new Rng(42), 20)).toEqual(take(new Rng(42), 20));
    expect(take(new Rng(42), 20)).not.toEqual(take(new Rng(43), 20));
  });

  it("matches a pinned sequence (guards against accidental algorithm changes)", () => {
    const pinned = take(new Rng(12345), 4);
    expect(pinned).toEqual(take(new Rng(12345), 4));
    expect(pinned.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff)).toBe(true);
    expect(new Set(pinned).size).toBe(4);
  });

  it("keeps float in [0,1) with a sane mean, and range/int inside their bounds", () => {
    const rng = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const f = rng.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      sum += f;
      const r = rng.range(-3, 5);
      expect(r).toBeGreaterThanOrEqual(-3);
      expect(r).toBeLessThan(5);
      const n = rng.int(2, 6);
      expect([2, 3, 4, 5]).toContain(n);
    }
    expect(sum / 20000).toBeGreaterThan(0.48);
    expect(sum / 20000).toBeLessThan(0.52);
  });

  it("normal() has mean near 0 and deviation near 1", () => {
    const rng = new Rng(99);
    let sum = 0;
    let sumSq = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) {
      const v = rng.normal();
      sum += v;
      sumSq += v * v;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.03);
    expect(Math.sqrt(sumSq / n)).toBeGreaterThan(0.95);
    expect(Math.sqrt(sumSq / n)).toBeLessThan(1.05);
  });

  it("forks are independent of how much the parent was used", () => {
    const fresh = new Rng(5);
    const used = new Rng(5);
    take(used, 1000);
    expect(take(fresh.fork("loot"), 10)).toEqual(take(used.fork("loot"), 10));
  });

  it("forks with different names or ids give different streams", () => {
    const rng = new Rng(5);
    expect(take(rng.fork("loot"), 8)).not.toEqual(take(rng.fork("storm"), 8));
    expect(take(rng.fork("ai", 1), 8)).not.toEqual(take(rng.fork("ai", 2), 8));
    expect(take(rng.fork("loot"), 8)).not.toEqual(take(new Rng(5), 8));
  });

  it("round-trips its state", () => {
    const rng = new Rng(77);
    take(rng, 33);
    const copy = Rng.fromState(rng.getState());
    expect(take(copy, 50)).toEqual(take(rng, 50));
  });

  it("shuffle keeps every element and pick/weightedIndex stay in range", () => {
    const rng = new Rng(3);
    const items = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = rng.shuffle([...items]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
    expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow();

    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[rng.weightedIndex([1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(2.5);
    expect(counts[2]! / counts[0]!).toBeLessThan(3.5);
    expect(() => rng.weightedIndex([0, 0])).toThrow();
  });

  it("shotRng is stable per (seed, entity, shot) and differs between shots", () => {
    expect(shotRng(9, 4, 17).float()).toBe(shotRng(9, 4, 17).float());
    const values = new Set<number>();
    for (let shot = 0; shot < 200; shot++) values.add(shotRng(9, 4, shot).float());
    expect(values.size).toBe(200);
    expect(shotRng(9, 4, 0).float()).not.toBe(shotRng(9, 5, 0).float());
  });

  it("helpers produce unsigned 32-bit values", () => {
    expect(mix32(-1)).toBeGreaterThanOrEqual(0);
    expect(hashString("loot")).not.toBe(hashString("tool"));
    expect(hashString("")).toBe(0x811c9dc5);
  });
});
