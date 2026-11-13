import { REVISION } from "three/webgpu";
import { initPhysics, physicsVersion } from "../shared/physics/PhysicsWorld";
import type { UrlFlags } from "../shared/rules/UrlFlags";
import type { SimEvent } from "../shared/sim/Events";
import { hashToHex } from "../shared/sim/Hash";
import { Button, type ButtonName, type InputFrame, neutralInput } from "../shared/sim/InputFrame";
import { SANDBOX_DEFAULTS, SandboxSim } from "../shared/sim/SandboxSim";
import { SandboxView } from "../render/SandboxView";
import { SandboxHud } from "../ui/SandboxHud";
import { DebugOverlay } from "./DebugOverlay";
import { EventBus } from "./EventBus";
import { GameLoop } from "./GameLoop";
import { Input } from "./Input";
import { effectivePixelRatio, type QualityPreset, resolveQuality } from "./Quality";
import { type BackendName, createRenderer, type RendererHandle } from "./RendererFactory";
import type { SettingsStore } from "./Settings";

/** Events that client systems exchange through the engine's bus. */
export interface ClientEvents {
  /** A simulation event, forwarded in the tick it happened. */
  sim: SimEvent;
  resize: { width: number; height: number };
  pointerLock: { locked: boolean };
}

/** Why rendering stopped for good (GPU reset, driver crash, browser reclaiming the device). */
export interface DeviceLoss {
  backend: BackendName;
  seed: number;
  message: string;
}

export interface EngineOptions {
  /** Element that receives the canvas and HUD layers. */
  root: HTMLElement;
  flags: UrlFlags;
  settings: SettingsStore;
  /** Called once if the graphics device is lost; the loop has already been stopped. */
  onDeviceLost(loss: DeviceLoss): void;
}

/** Read-only handle exposed on `window.__DRIFTGLASS__` for automated checks. */
export interface DebugHandle {
  backend: BackendName;
  seed: number;
  tick(): number;
  hash(): string;
  fps(): number;
  drawCalls(): number;
  simEvents(): number;
}

/** Picks a fresh seed when the URL gives none. Client-only, so the wall clock is fine here. */
function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
}

/**
 * Owns the renderer, the fixed-tick loop, input and the active simulation,
 * and connects them: input -> sim.step -> events -> view/HUD -> render.
 */
export class Engine {
  readonly bus = new EventBus<ClientEvents>();
  readonly seed: number;
  readonly quality: QualityPreset;

  private readonly canvas: HTMLCanvasElement;
  private readonly sim: SandboxSim;
  private readonly view: SandboxView;
  private readonly hud: SandboxHud;
  private readonly overlay: DebugOverlay;
  private readonly input: Input;
  private readonly loop: GameLoop;
  private readonly cleanups: Array<() => void> = [];
  private lastInput: InputFrame = neutralInput();
  private simEventCount = 0;
  private deviceLost = false;
  private disposed = false;

  /** Loads physics, creates the renderer and builds the scene. Rejects with a readable error on failure. */
  static async create(options: EngineOptions): Promise<Engine> {
    const quality = resolveQuality(options.flags.quality, options.settings.value.quality);
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;outline:none";
    options.root.append(canvas);
    try {
      const [handle] = await Promise.all([
        createRenderer({ canvas, forceWebGL: options.flags.renderer === "webgl", antialias: quality.antialias }),
        initPhysics(),
      ]);
      return new Engine(options, canvas, handle, quality);
    } catch (error) {
      canvas.remove();
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not start the renderer or physics (WebGPU or WebGL2 is required). ${reason}`);
    }
  }

  private constructor(
    private readonly options: EngineOptions,
    canvas: HTMLCanvasElement,
    private readonly handle: RendererHandle,
    quality: QualityPreset,
  ) {
    const { root, flags, settings } = options;
    this.canvas = canvas;
    this.quality = quality;
    this.seed = flags.seed ?? randomSeed();

    this.sim = new SandboxSim({
      seed: this.seed,
      crateCount: SANDBOX_DEFAULTS.crateCount,
      obstacleCount: SANDBOX_DEFAULTS.obstacleCount,
    });
    this.view = new SandboxView(this.sim, settings.value.fov);
    this.hud = new SandboxHud(root);
    this.overlay = new DebugOverlay(root);
    this.overlay.setVisible(settings.value.showStats);

    this.input = new Input(
      canvas,
      {
        onDebugKey: (code) => this.onDebugKey(code),
        onPointerLockChange: (locked) => this.bus.emit("pointerLock", { locked }),
      },
      undefined,
      ["F3"],
    );
    this.input.state.setLook(this.sim.probe.yaw, this.sim.probe.pitch);
    this.applySettings();
    this.cleanups.push(settings.subscribe(() => this.applySettings()));

    this.bus.on("sim", (event) => this.onSimEvent(event));
    this.bus.on("pointerLock", ({ locked }) => this.hud.setPointerLocked(locked));
    this.hud.setPointerLocked(false);

    const onResize = (): void => this.resize();
    window.addEventListener("resize", onResize);
    this.cleanups.push(() => window.removeEventListener("resize", onResize));
    this.resize();

    handle.watchDeviceLoss((message) => this.onDeviceLost(message));

    this.registerOverlayLines();
    this.loop = new GameLoop(handle.renderer, {
      step: () => this.step(),
      render: (alpha, frameSeconds) => this.render(alpha, frameSeconds),
    });
  }

  get backend(): BackendName {
    return this.handle.backend;
  }

  start(): void {
    this.loop.start();
  }

  /** Small read-only API for automated smoke checks. */
  debugHandle(): DebugHandle {
    return {
      backend: this.handle.backend,
      seed: this.seed,
      tick: () => this.sim.tick,
      hash: () => hashToHex(this.sim.hash()),
      fps: () => this.loop.stats.fps,
      drawCalls: () => this.handle.renderer.info.render.drawCalls,
      simEvents: () => this.simEventCount,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.loop.dispose();
    this.input.dispose();
    for (const cleanup of this.cleanups) cleanup();
    this.hud.dispose();
    this.overlay.dispose();
    this.view.dispose();
    this.sim.dispose();
    this.handle.renderer.dispose();
    this.canvas.remove();
  }

  /** One fixed sim tick: sample input, advance the sim, forward its events. */
  private step(): void {
    this.lastInput = this.input.state.sample();
    this.sim.step(this.lastInput);
    for (const event of this.sim.drainEvents()) this.bus.emit("sim", event);
  }

  private render(alpha: number, frameSeconds: number): void {
    this.view.update(alpha, frameSeconds);
    this.hud.update(frameSeconds);
    this.handle.renderer.render(this.view.scene, this.view.camera);
    this.overlay.update(frameSeconds);
  }

  private onSimEvent(event: SimEvent): void {
    this.simEventCount++;
    switch (event.type) {
      case "sandboxKick":
        this.view.showKick(event.x, event.y, event.z);
        this.hud.showToast(event.bodies === 0 ? "Kick: nothing in range" : `Kick: ${event.bodies} crate${event.bodies === 1 ? "" : "s"}`);
        break;
      case "sandboxRespawn":
        this.hud.showToast(`Crates respawned (drop #${event.generation + 1})`);
        break;
    }
  }

  /** Stops rendering (a lost device cannot draw) and hands recovery to the host page. */
  private onDeviceLost(message: string): void {
    // Ignore repeats, and the "loss" caused by our own renderer.dispose().
    if (this.deviceLost || this.disposed) return;
    this.deviceLost = true;
    this.loop.stop();
    this.options.onDeviceLost({ backend: this.handle.backend, seed: this.seed, message });
  }

  private onDebugKey(code: string): void {
    if (code === "F3") this.options.settings.update({ showStats: this.overlay.toggle() });
  }

  private applySettings(): void {
    const s = this.options.settings.value;
    this.input.state.sensitivity = s.mouseSensitivity;
    this.input.state.invertY = s.invertY;
    this.view.setFov(s.fov);
  }

  private resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.handle.renderer.setPixelRatio(effectivePixelRatio(this.quality, window.devicePixelRatio));
    this.handle.renderer.setSize(width, height, false);
    this.view.setAspect(width / height);
    this.bus.emit("resize", { width, height });
  }

  private registerOverlayLines(): void {
    const stats = (): GameLoop["stats"] => this.loop.stats;
    const info = this.handle.renderer.info;
    const o = this.overlay;
    o.addLine(() => `DRIFTGLASS  M1 engine sandbox   seed ${this.seed}`);
    o.addLine(
      () =>
        `fps ${stats().fps.toFixed(0)}   frame ${stats().frameMs.toFixed(1)} ms (worst ${stats().worstFrameMs.toFixed(1)})   ` +
        `sim ${stats().simMsPerStep.toFixed(2)} ms/tick x${stats().stepsLastFrame}   render ${stats().renderMs.toFixed(2)} ms`,
    );
    o.addLine(
      () =>
        `backend ${this.handle.backend === "webgpu" ? "WebGPU" : "WebGL2"}   quality ${this.quality.name}   ` +
        `${this.canvas.width}x${this.canvas.height} (pixel ratio ${effectivePixelRatio(this.quality, window.devicePixelRatio).toFixed(2)})`,
    );
    o.addLine(() => `draw calls ${info.render.drawCalls}   triangles ${info.render.triangles}`);
    o.addLine(
      () =>
        `tick ${this.sim.tick}   state hash ${hashToHex(this.sim.hash())}   dropped ${stats().droppedSeconds.toFixed(2)} s`,
    );
    o.addLine(
      () => `bodies ${this.sim.bodyCount} (crates awake ${this.sim.awakeCount}/${this.sim.crateCount})   sim events ${this.simEventCount}`,
    );
    o.addLine(() => {
      const p = this.sim.probe;
      const deg = (r: number): string => ((r * 180) / Math.PI).toFixed(0);
      return `probe ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}   yaw ${deg(p.yaw)}  pitch ${deg(p.pitch)}`;
    });
    o.addLine(() => {
      const held = (Object.keys(Button) as ButtonName[]).filter((name) => (this.lastInput.buttons & Button[name]) !== 0);
      return (
        `input move ${this.lastInput.moveX.toFixed(2)} ${this.lastInput.moveZ.toFixed(2)}   ` +
        `buttons ${held.length > 0 ? held.join(" ") : "-"}   mouse ${this.input.isLocked ? "captured" : "free"}`
      );
    });
    o.addLine(() => `three r${REVISION}   rapier ${physicsVersion()}`);
  }
}
