import type { FillId, ModeId } from "./Strings";

/**
 * Match-level rule flags. Systems read their behaviour switches from here;
 * numeric tuning lives in each system's own config (see MECHANICS_NOTES.md).
 */
export interface RulesConfig {
  /** R1: this game has no building. The field exists so code can assert it. */
  readonly zeroBuild: true;
  mode: ModeId;
  /** Players + bots per match. */
  matchSize: number;
  fill: FillId;
  /** Seconds the queue waits for humans before bots fill the match. */
  botFillWaitS: number;
  friendlyFire: boolean;
  /** Modern rule: a would-be-lethal fall leaves 1 HP instead of killing. */
  nonLethalFalls: boolean;
  /** Modern rule: sprinting with the Pickaxe out costs no stamina. */
  pickaxeInfiniteSprint: boolean;
  gliderRedeploy: boolean;
  /** Players may close the glider early and free-fall. */
  gliderCut: boolean;
  /** Everyone drops with Pistol + Small Shield Potion + a Pocket Item. */
  startingLoadout: boolean;
  elimRefillsOvershield: boolean;
  selfPocketDamageResetsRegen: boolean;
  slideKick: boolean;
  /** Downed-but-not-out. Off by default. */
  dbno: boolean;
  stormBypassesShield: boolean;
  /** Multiplies every storm wait/shrink time (smaller = faster match). */
  stormTimeScale: number;
}

export const MODE_TEAM_SIZE: Readonly<Record<ModeId, number>> = { solo: 1, duos: 2, trios: 3, squads: 4 };

export const MATCH_SIZE_LIMITS = { min: 2, max: 100, default: 48 } as const;

export function defaultRules(): RulesConfig {
  return {
    zeroBuild: true,
    mode: "solo",
    matchSize: MATCH_SIZE_LIMITS.default,
    fill: "bots",
    botFillWaitS: 20,
    friendlyFire: false,
    nonLethalFalls: true,
    pickaxeInfiniteSprint: true,
    gliderRedeploy: true,
    gliderCut: true,
    startingLoadout: true,
    elimRefillsOvershield: true,
    selfPocketDamageResetsRegen: false,
    slideKick: true,
    dbno: false,
    stormBypassesShield: true,
    stormTimeScale: 1,
  };
}

/** Quick-match preset for testing: short queue wait and a storm four times faster. */
export function fastRules(): RulesConfig {
  return { ...defaultRules(), botFillWaitS: 3, stormTimeScale: 0.25 };
}

/** Clamps numeric fields into their legal ranges. Returns a new object. */
export function validateRules(rules: RulesConfig): RulesConfig {
  const size = Math.round(rules.matchSize);
  const scale = Number.isFinite(rules.stormTimeScale) ? rules.stormTimeScale : 1;
  const wait = Number.isFinite(rules.botFillWaitS) ? rules.botFillWaitS : 20;
  return {
    ...rules,
    matchSize: Math.min(MATCH_SIZE_LIMITS.max, Math.max(MATCH_SIZE_LIMITS.min, Number.isFinite(size) ? size : MATCH_SIZE_LIMITS.default)),
    stormTimeScale: Math.min(10, Math.max(0.02, scale)),
    botFillWaitS: Math.min(120, Math.max(0, wait)),
  };
}
