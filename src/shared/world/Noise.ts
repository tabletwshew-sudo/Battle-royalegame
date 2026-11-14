import { mix32 } from "../sim/Rng";

/**
 * Deterministic 2D noise for world generation. Only integer hashing,
 * multiplication and addition: no Math.random and no transcendental
 * functions, so every JavaScript engine (browser and server) produces the
 * exact same terrain from a seed.
 */

/** Hash of an integer lattice point to [0, 1). */
export function lattice(ix: number, iz: number, seed: number): number {
  const h = mix32(Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1));
  return h / 4294967296;
}

/** Quintic fade curve 6t^5 - 15t^4 + 10t^3. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smooth value noise in [-1, 1]. */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = lattice(ix, iz, seed);
  const b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed);
  const d = lattice(ix + 1, iz + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return (top + (bottom - top) * fz) * 2 - 1;
}

/**
 * Fractal sum of value noise (fBm), normalized to roughly [-1, 1].
 * Each octave uses its own seed so octaves do not line up.
 */
export function fbm(x: number, z: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency, z * frequency, seed + i * 1013) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

/** Ridged fractal noise in [0, 1]: sharp crests where the base noise crosses zero. */
export function ridged(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * frequency, z * frequency, seed + i * 7919));
    sum += n * n * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

/** Hermite smoothstep. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
