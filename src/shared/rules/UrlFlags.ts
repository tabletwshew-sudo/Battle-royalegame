import { defaultRules, fastRules, type RulesConfig, validateRules } from "./RulesConfig";
import { MODE_LABELS, type ModeId } from "./Strings";

/**
 * Parsed testing/debug URL flags (GAME_SPEC §11). Parsing is pure string work
 * so the same code runs in the browser, in tests and on the server.
 */
export interface UrlFlags {
  /** Match seed; null means "pick one". */
  seed: number | null;
  /** Bot count override. */
  bots: number | null;
  offline: boolean;
  /** "webgl" forces the WebGL2 backend. */
  renderer: "auto" | "webgl";
  /** Raw quality preset name (validated by the client's Quality module). */
  quality: string | null;
  fast: boolean;
  stormScale: number | null;
  skipBus: boolean;
  god: boolean;
  team: ModeId | null;
  /** Simulated one-way latency in milliseconds. */
  lagMs: number | null;
  demo: boolean;
  /** Party code to join. */
  party: string | null;
}

export function defaultFlags(): UrlFlags {
  return {
    seed: null,
    bots: null,
    offline: false,
    renderer: "auto",
    quality: null,
    fast: false,
    stormScale: null,
    skipBus: false,
    god: false,
    team: null,
    lagMs: null,
    demo: false,
    party: null,
  };
}

/** Splits "?a=1&b" into a key -> value map (last occurrence wins, keys lower-cased). */
export function parseQuery(query: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = query.startsWith("?") ? query.slice(1) : query;
  for (const part of body.split("&")) {
    if (part.length === 0) continue;
    const eq = part.indexOf("=");
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    out.set(safeDecode(rawKey).toLowerCase(), safeDecode(rawValue));
  }
  return out;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

/** A flag counts as on when present without a value or with 1/true/yes/on. */
function readBool(map: Map<string, string>, key: string): boolean {
  const value = map.get(key);
  if (value === undefined) return false;
  return value === "" || /^(1|true|yes|on)$/i.test(value);
}

function readNumber(map: Map<string, string>, key: string, min: number, max: number): number | null {
  const value = map.get(key);
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function parseUrlFlags(query: string): UrlFlags {
  const map = parseQuery(query);
  const flags = defaultFlags();

  const seed = readNumber(map, "seed", 0, 0xffffffff);
  flags.seed = seed === null ? null : Math.floor(seed) >>> 0;
  const bots = readNumber(map, "bots", 0, 99);
  flags.bots = bots === null ? null : Math.floor(bots);
  flags.offline = readBool(map, "offline");
  flags.renderer = map.get("renderer")?.toLowerCase() === "webgl" ? "webgl" : "auto";
  const quality = map.get("quality")?.trim().toLowerCase();
  flags.quality = quality !== undefined && quality !== "" ? quality : null;
  flags.fast = readBool(map, "fast");
  flags.stormScale = readNumber(map, "stormscale", 0.02, 10);
  flags.skipBus = readBool(map, "skipbus");
  flags.god = readBool(map, "god");
  const team = map.get("team")?.toLowerCase();
  flags.team = team !== undefined && team in MODE_LABELS ? (team as ModeId) : null;
  const lag = readNumber(map, "lag", 0, 1000);
  flags.lagMs = lag === null ? null : Math.round(lag);
  flags.demo = readBool(map, "demo");
  const party = map.get("party")?.trim().toUpperCase();
  flags.party = party !== undefined && /^[A-Z0-9]{4,8}$/.test(party) ? party : null;
  return flags;
}

/** Builds the match rules implied by the flags (?fast, ?stormscale, ?team, ?bots). */
export function rulesFromFlags(flags: UrlFlags): RulesConfig {
  const rules = flags.fast ? fastRules() : defaultRules();
  if (flags.stormScale !== null) rules.stormTimeScale = flags.stormScale;
  if (flags.team !== null) rules.mode = flags.team;
  if (flags.bots !== null) rules.matchSize = flags.bots + 1;
  return validateRules(rules);
}
