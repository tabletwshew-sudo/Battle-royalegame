import { ALL_BUTTONS, Button, type InputFrame, MAX_PITCH } from "./InputFrame";
import { clamp, wrapAngle } from "./MathUtil";
import { Rng } from "./Rng";
import type { Simulation } from "./Simulation";

/**
 * Determinism harness. Generates a reproducible stream of "fuzzed" inputs,
 * runs any Simulation with it and records state hashes, so two runs (or a
 * run and a snapshot-restored run) can be compared tick by tick.
 */

/** Builds a seeded input script that wanders, looks around and taps buttons. */
export function makeInputScript(seed: number, ticks: number): InputFrame[] {
  const rng = new Rng(seed).fork("input-script");
  const frames: InputFrame[] = [];
  let moveX = 0;
  let moveZ = 0;
  let yaw = 0;
  let pitch = 0;
  let buttons = 0;
  for (let t = 0; t < ticks; t++) {
    // Change movement and held buttons a few times per second, like a person would.
    if (rng.chance(0.06)) {
      moveX = rng.int(-1, 2);
      moveZ = rng.int(-1, 2);
    }
    if (rng.chance(0.05)) buttons = rng.nextU32() & ALL_BUTTONS & ~Button.Fire & ~Button.Reload;
    yaw = wrapAngle(yaw + rng.range(-0.05, 0.05));
    pitch = clamp(pitch + rng.range(-0.03, 0.03), -MAX_PITCH, MAX_PITCH);
    let frameButtons = buttons;
    if (rng.chance(0.04)) frameButtons |= Button.Fire;
    if (rng.chance(0.004)) frameButtons |= Button.Reload;
    frames.push({ moveX, moveZ, yaw, pitch, buttons: frameButtons });
  }
  return frames;
}

/** Runs a sim through a script and returns the state hash after every tick. */
export function runAndHash(sim: Simulation, script: readonly InputFrame[], from = 0): number[] {
  const hashes: number[] = [];
  for (let t = from; t < script.length; t++) {
    sim.step(script[t] as InputFrame);
    sim.drainEvents();
    hashes.push(sim.hash());
  }
  return hashes;
}

/** Index of the first differing hash, or -1 when both runs match completely. */
export function firstDivergence(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

export interface DeterminismReport {
  ticks: number;
  /** First tick where two fresh runs differ (-1 = identical). */
  rerunDivergence: number;
  /** First tick where a snapshot-restored run differs from the original (-1 = identical). */
  restoreDivergence: number;
  finalHash: number;
}

/**
 * Full check for one seed: two fresh runs must match, and a run restored from
 * a mid-way snapshot must match the remainder of the original run.
 */
export function checkDeterminism<S>(
  create: () => Simulation<S>,
  seed: number,
  ticks: number,
  script: readonly InputFrame[] = makeInputScript(seed, ticks),
): DeterminismReport {
  ticks = script.length;
  const half = Math.floor(ticks / 2);

  const first = create();
  const firstHashes = runAndHash(first, script.slice(0, half));
  const midSnapshot = first.snapshot();
  firstHashes.push(...runAndHash(first, script, half));
  first.dispose();

  const second = create();
  const secondHashes = runAndHash(second, script);

  // Reuse the second sim: rewind it to the first sim's mid-run snapshot and replay.
  second.restore(midSnapshot);
  const restoredHashes = runAndHash(second, script, half);
  second.dispose();

  const restoreIndex = firstDivergence(firstHashes.slice(half), restoredHashes);
  return {
    ticks,
    rerunDivergence: firstDivergence(firstHashes, secondHashes),
    restoreDivergence: restoreIndex === -1 ? -1 : restoreIndex + half,
    finalHash: firstHashes[firstHashes.length - 1] ?? 0,
  };
}
