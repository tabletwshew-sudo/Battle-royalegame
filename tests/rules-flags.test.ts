import { describe, expect, it } from "vitest";
import { defaultRules, fastRules, MODE_TEAM_SIZE, validateRules } from "../src/shared/rules/RulesConfig";
import { defaultFlags, parseQuery, parseUrlFlags, rulesFromFlags } from "../src/shared/rules/UrlFlags";

describe("RulesConfig", () => {
  it("defaults to the modern Zero Build rule set", () => {
    const rules = defaultRules();
    expect(rules.zeroBuild).toBe(true);
    expect(rules.friendlyFire).toBe(false);
    expect(rules.nonLethalFalls).toBe(true);
    expect(rules.dbno).toBe(false);
    expect(rules.matchSize).toBe(48);
    expect(MODE_TEAM_SIZE.squads).toBe(4);
  });

  it("fast preset speeds the storm up", () => {
    expect(fastRules().stormTimeScale).toBeLessThan(defaultRules().stormTimeScale);
  });

  it("clamps out-of-range numbers", () => {
    const rules = validateRules({ ...defaultRules(), matchSize: 5000, stormTimeScale: -3, botFillWaitS: NaN });
    expect(rules.matchSize).toBe(100);
    expect(rules.stormTimeScale).toBe(0.02);
    expect(rules.botFillWaitS).toBe(20);
  });
});

describe("UrlFlags", () => {
  it("returns defaults for an empty query", () => {
    expect(parseUrlFlags("")).toEqual(defaultFlags());
    expect(parseUrlFlags("?")).toEqual(defaultFlags());
  });

  it("parses every documented flag", () => {
    const flags = parseUrlFlags(
      "?seed=1234&bots=20&offline=1&renderer=webgl&quality=High&fast=1&stormscale=0.5&skipbus=1&god=1&team=duos&lag=120&demo=1&party=ab12cd",
    );
    expect(flags).toEqual({
      seed: 1234,
      bots: 20,
      offline: true,
      renderer: "webgl",
      quality: "high",
      fast: true,
      stormScale: 0.5,
      skipBus: true,
      god: true,
      team: "duos",
      lagMs: 120,
      demo: true,
      party: "AB12CD",
    });
  });

  it("treats bare flags as on and 0/false as off", () => {
    expect(parseUrlFlags("?offline&god=0&demo=false").offline).toBe(true);
    expect(parseUrlFlags("?offline&god=0&demo=false").god).toBe(false);
    expect(parseUrlFlags("?offline&god=0&demo=false").demo).toBe(false);
  });

  it("rejects or clamps bad values", () => {
    const flags = parseUrlFlags("?seed=abc&bots=500&team=octos&lag=-5&party=!!&renderer=vulkan&stormscale=99");
    expect(flags.seed).toBeNull();
    expect(flags.bots).toBe(99);
    expect(flags.team).toBeNull();
    expect(flags.lagMs).toBe(0);
    expect(flags.party).toBeNull();
    expect(flags.renderer).toBe("auto");
    expect(flags.stormScale).toBe(10);
  });

  it("decodes keys and values and survives malformed escapes", () => {
    const map = parseQuery("?A%20b=c+d&bad=%E0%A4%A&x");
    expect(map.get("a b")).toBe("c d");
    expect(map.get("bad")).toBe("%E0%A4%A");
    expect(map.get("x")).toBe("");
  });

  it("derives rules from flags", () => {
    const rules = rulesFromFlags(parseUrlFlags("?fast=1&team=trios&bots=9"));
    expect(rules.mode).toBe("trios");
    expect(rules.matchSize).toBe(10);
    expect(rules.stormTimeScale).toBe(0.25);
    expect(rulesFromFlags(parseUrlFlags("?stormscale=0.1")).stormTimeScale).toBe(0.1);
  });
});
