/**
 * Seeded random number generator (sfc32) with named, order-independent forks.
 * This is the ONLY randomness source allowed in src/shared (R6).
 *
 * Forks are derived from the generator's original seed and the fork name, not
 * from its current state, so `rng.fork("loot")` yields the same stream no
 * matter how many numbers were drawn from `rng` before.
 */

/** 32-bit integer mixer (murmur3 finalizer). Spreads correlated seeds apart. */
export function mix32(x: number): number {
  let h = x | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a hash of a string to an unsigned 32-bit integer. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Serializable generator state (for snapshots and rollback). */
export interface RngState {
  readonly seed: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export class Rng {
  /** The seed this generator was created from (after coercion to uint32). */
  readonly seed: number;
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    // Expand one 32-bit seed into the three state words; d is the counter.
    this.a = mix32(this.seed ^ 0x9e3779b9);
    this.b = mix32(this.a + 0x7f4a7c15);
    this.c = mix32(this.b + 0x94d049bb);
    this.d = 1;
    // Warm up so that similar seeds do not produce similar first outputs.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** Next raw unsigned 32-bit integer. */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Uniform integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.float() * (maxExclusive - min));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Either -1 or +1. */
  sign(): number {
    return this.nextU32() & 1 ? 1 : -1;
  }

  /**
   * Approximately normal value with mean 0 and standard deviation 1.
   * Uses a sum of uniforms (no log/cos) so results are bit-identical on
   * every JavaScript engine.
   */
  normal(): number {
    const sum = this.float() + this.float() + this.float() + this.float();
    return (sum - 2) * 1.7320508075688772;
  }

  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty array");
    return items[this.int(0, items.length)] as T;
  }

  /** Index chosen with probability proportional to its weight. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (!(total > 0)) throw new Error("Rng.weightedIndex: weights must sum to a positive number");
    let roll = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i] as number;
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }

  /** In-place Fisher-Yates shuffle. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /** Independent child stream identified by name (and optional numeric id). */
  fork(name: string, id = 0): Rng {
    return new Rng(mix32(this.seed ^ hashString(name)) ^ mix32(id + 0x51ed270b));
  }

  /** Captures the full state. */
  getState(): RngState {
    return { seed: this.seed, a: this.a, b: this.b, c: this.c, d: this.d };
  }

  /** Rebuilds a generator from a captured state. */
  static fromState(state: RngState): Rng {
    const rng = new Rng(state.seed);
    rng.a = state.a;
    rng.b = state.b;
    rng.c = state.c;
    rng.d = state.d;
    return rng;
  }
}

/**
 * Generator for one weapon shot. The seed is matchSeed ^ entityId ^ shotIndex
 * (the ids are pre-mixed so neighbouring shots are uncorrelated). Client and
 * server derive the same spread without sending it over the network.
 */
export function shotRng(matchSeed: number, entityId: number, shotIndex: number): Rng {
  return new Rng((matchSeed ^ mix32(entityId + 0x1b873593) ^ mix32(shotIndex + 0xcc9e2d51)) >>> 0);
}
