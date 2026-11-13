/**
 * Fixed-timestep accumulator (R7). Feed it variable frame times; it tells you
 * how many fixed sim steps to run and the interpolation factor for rendering.
 */
export class FixedStepper {
  private accumulator = 0;
  /** Total seconds discarded because frames were too slow to catch up. */
  droppedSeconds = 0;

  /**
   * @param dt        fixed step length in seconds
   * @param maxSteps  most steps allowed per frame; extra time is dropped so a
   *                  slow frame cannot snowball into ever more sim work
   */
  constructor(
    readonly dt: number,
    readonly maxSteps = 5,
  ) {
    if (!(dt > 0)) throw new Error("FixedStepper: dt must be positive");
    if (maxSteps < 1) throw new Error("FixedStepper: maxSteps must be at least 1");
  }

  /** Adds frame time and returns the number of fixed steps to run now. */
  advance(frameSeconds: number): number {
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) return 0;
    this.accumulator += frameSeconds;
    // Small epsilon so that e.g. 3 x (1/180) reliably yields one 1/60 step.
    let steps = Math.floor(this.accumulator / this.dt + 1e-9);
    if (steps > this.maxSteps) {
      this.droppedSeconds += (steps - this.maxSteps) * this.dt;
      this.accumulator -= (steps - this.maxSteps) * this.dt;
      steps = this.maxSteps;
    }
    this.accumulator = Math.max(0, this.accumulator - steps * this.dt);
    return steps;
  }

  /** Fraction (0..1) of the way from the previous sim state to the current one. */
  get alpha(): number {
    return Math.min(1, this.accumulator / this.dt);
  }

  reset(): void {
    this.accumulator = 0;
  }
}
