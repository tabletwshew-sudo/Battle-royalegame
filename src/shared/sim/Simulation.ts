import type { SimEvent } from "./Events";
import type { InputFrame } from "./InputFrame";

/**
 * Contract every runnable simulation fulfils. The engine, the determinism
 * harness and (later) the server drive sims only through this interface.
 */
export interface Simulation<Snapshot = unknown> {
  /** Number of completed ticks. */
  readonly tick: number;
  /** Advances exactly one fixed tick using the local player's input. */
  step(input: InputFrame): void;
  /** Returns and clears the events produced since the last call. */
  drainEvents(): SimEvent[];
  /** Digest of all gameplay-relevant state. */
  hash(): number;
  /** Captures the complete state. */
  snapshot(): Snapshot;
  /** Restores a state captured by snapshot(). */
  restore(snapshot: Snapshot): void;
  /** Releases native (WASM) resources. */
  dispose(): void;
}
