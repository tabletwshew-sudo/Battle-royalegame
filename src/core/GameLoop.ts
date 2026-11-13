import { Timer, type WebGPURenderer } from "three/webgpu";
import { SIM_DT } from "../shared/sim/Constants";
import { FixedStepper } from "../shared/sim/FixedStep";

export interface LoopCallbacks {
  /** Runs one fixed simulation tick. */
  step(): void;
  /**
   * Draws a frame.
   * @param alpha     0..1 blend between the previous and the current sim state
   * @param frameSeconds real time since the previous frame
   */
  render(alpha: number, frameSeconds: number): void;
}

/** Rolling timing numbers for the debug overlay. */
export interface LoopStats {
  fps: number;
  frameMs: number;
  worstFrameMs: number;
  /** Average cost of one sim tick. */
  simMsPerStep: number;
  renderMs: number;
  stepsLastFrame: number;
  droppedSeconds: number;
}

/**
 * Fixed-tick game loop (R7): the simulation always advances in 1/60 s steps
 * and rendering runs once per display frame with an interpolation factor.
 */
export class GameLoop {
  readonly stats: LoopStats = {
    fps: 0,
    frameMs: 0,
    worstFrameMs: 0,
    simMsPerStep: 0,
    renderMs: 0,
    stepsLastFrame: 0,
    droppedSeconds: 0,
  };

  private readonly timer = new Timer();
  private readonly stepper = new FixedStepper(SIM_DT, 5);
  private running = false;
  // Accumulators for the once-per-half-second stats window.
  private windowSeconds = 0;
  private windowFrames = 0;
  private windowWorstMs = 0;
  private windowSimMs = 0;
  private windowSteps = 0;
  private windowRenderMs = 0;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly callbacks: LoopCallbacks,
  ) {
    // Lets the timer ignore the time a tab spent hidden instead of reporting one huge frame.
    this.timer.connect(document);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    this.stepper.reset();
    void this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    void this.renderer.setAnimationLoop(null);
  }

  get isRunning(): boolean {
    return this.running;
  }

  dispose(): void {
    this.stop();
    this.timer.dispose();
  }

  private frame(time: number): void {
    this.timer.update(time);
    const frameSeconds = this.timer.getDelta();

    const steps = this.stepper.advance(frameSeconds);
    const simStart = performance.now();
    for (let i = 0; i < steps; i++) this.callbacks.step();
    const simMs = performance.now() - simStart;

    const renderStart = performance.now();
    this.callbacks.render(this.stepper.alpha, frameSeconds);
    const renderMs = performance.now() - renderStart;

    this.record(frameSeconds, steps, simMs, renderMs);
  }

  private record(frameSeconds: number, steps: number, simMs: number, renderMs: number): void {
    this.stats.stepsLastFrame = steps;
    this.stats.droppedSeconds = this.stepper.droppedSeconds;
    this.windowSeconds += frameSeconds;
    this.windowFrames++;
    this.windowWorstMs = Math.max(this.windowWorstMs, frameSeconds * 1000);
    this.windowSimMs += simMs;
    this.windowSteps += steps;
    this.windowRenderMs += renderMs;
    if (this.windowSeconds < 0.5) return;
    this.stats.fps = this.windowFrames / this.windowSeconds;
    this.stats.frameMs = (this.windowSeconds * 1000) / this.windowFrames;
    this.stats.worstFrameMs = this.windowWorstMs;
    this.stats.simMsPerStep = this.windowSteps > 0 ? this.windowSimMs / this.windowSteps : 0;
    this.stats.renderMs = this.windowRenderMs / this.windowFrames;
    this.windowSeconds = 0;
    this.windowFrames = 0;
    this.windowWorstMs = 0;
    this.windowSimMs = 0;
    this.windowSteps = 0;
    this.windowRenderMs = 0;
  }
}
