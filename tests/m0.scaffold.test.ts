import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FAN_NOTICE, GAME_TITLE, QUICK_COMMS } from "../src/shared/rules/Strings";
import { BOT_NAME_PREFIXES, BOT_NAME_SUFFIXES, POIS } from "../src/shared/data/names";

/** Recursively lists .ts files below a folder. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("M0 labels", () => {
  it("has a title and the fan notice", () => {
    expect(GAME_TITLE).toBe("DRIFTGLASS");
    expect(FAN_NOTICE).toMatch(/not affiliated with Epic Games/);
  });

  it("has 8-12 POIs with unique ids/names inside the unit square", () => {
    expect(POIS.length).toBeGreaterThanOrEqual(8);
    expect(POIS.length).toBeLessThanOrEqual(12);
    expect(new Set(POIS.map((p) => p.id)).size).toBe(POIS.length);
    expect(new Set(POIS.map((p) => p.name)).size).toBe(POIS.length);
    for (const p of POIS) {
      expect(p.u).toBeGreaterThan(0);
      expect(p.u).toBeLessThan(1);
      expect(p.v).toBeGreaterThan(0);
      expect(p.v).toBeLessThan(1);
    }
  });

  it("can form at least 200 unique bot names", () => {
    const names = new Set<string>();
    for (const a of BOT_NAME_PREFIXES) for (const b of BOT_NAME_SUFFIXES) names.add(`${a} ${b}`);
    expect(names.size).toBeGreaterThanOrEqual(200);
  });

  it("has the six quick-comms entries", () => {
    expect(Object.keys(QUICK_COMMS)).toHaveLength(6);
  });
});

describe("R6 purity guard for src/shared", () => {
  const banned: [RegExp, string][] = [
    [/Math\.random\s*\(/, "Math.random"],
    [/Date\.now\s*\(/, "Date.now"],
    [/performance\.now\s*\(/, "performance.now"],
    [/\bwindow\./, "window"],
    [/\bdocument\./, "document"],
    [/from\s+["']three/, "three import"],
    [/from\s+["']node:/, "node import"],
  ];

  it("contains no nondeterministic or platform APIs", () => {
    const offenders: string[] = [];
    for (const file of tsFiles("src/shared")) {
      const text = readFileSync(file, "utf8");
      for (const [re, label] of banned) if (re.test(text)) offenders.push(`${file}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });
});
