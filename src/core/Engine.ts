import { REVISION } from "three/webgpu";
import { initPhysics, physicsVersion } from "../shared/physics/PhysicsWorld";
import type { UrlFlags } from "../shared/rules/UrlFlags";
import type { SimEvent } from "../shared/sim/Events";
import { hashToHex } from "../shared/sim/Hash";
import { Button, type ButtonName, type InputFrame, neutralInput } from "../shared/sim/InputFrame";
import { clamp } from "../shared/sim/MathUtil";
import { SANDBOX_DEFAULTS, SandboxSim } from "../shared/sim/SandboxSim";
import { PLAYGROUND } from "../shared/world/Playground";
import { interpolatePlayer, makePlayerFrame, PlayerView } from "../player/PlayerView";
import { ThirdPersonCamera } from "../player/ThirdPersonCamera";
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

/**
 * Debug handle exposed on `window.__DRIFTGLASS__` for automated checks.
 * Everything is read-only except `look()`, which exists because headless
 * browsers cannot produce real pointer-lock mouse movement.
 */
export interface DebugHandle {
  backend: BackendName;
  seed: number;
  tick(): number;
  hash(): string;
  fps(): number;
  drawCalls(): number;
  simEvents(): number;
  /** Player feet position, velocity and flags after the latest tick. */
  player(): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    speed: number;
    grounded: boolean;
    crouched: boolean;
    adsBlend: number;
  };
  /** Current camera arm length in metres. */
  cameraArm(): number;
  /** Sets the view angles as if the mouse had moved there (radians). */
  look(yaw: number, pitch: number): void;
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
  private readonly playerView: PlayerView;
  private readonly tpCamera: ThirdPersonCamera;
  private readonly playerFrame = makePlayerFrame();
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

    this.sim = new SandboxSim({ seed: this.seed, crateCount: SANDBOX_DEFAULTS.crateCount });
    this.view = new SandboxView(this.sim);
    this.playerView = new PlayerView();
    this.view.scene.add(this.playerView.object);
    this.tpCamera = new ThirdPersonCamera(this.view.camera, this.sim.camera);
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
    this.input.state.pitchLimit = (this.sim.movement.maxPitchDeg * Math.PI) / 180;
    this.input.state.setLook(PLAYGROUND.spawnYaw, -0.12);
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
      player: () => {
        const p = this.sim.player.state;
        return {
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: p.yaw,
          pitch: p.pitch,
          speed: this.sim.player.horizontalSpeed,
          grounded: p.grounded,
          crouched: p.crouched,
          adsBlend: p.adsBlend,
        };
      },
      cameraArm: () => this.tpCamera.armLength,
      look: (yaw, pitch) => this.input.state.setLook(yaw, pitch),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.loop.dispose();
    this.input.dispose();
    for (const cleanup of this.cleanups) cleanup();
    this.hud.dispose();
    this.overlay.dispose();
    this.playerView.dispose();
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
    const frame = interpolatePlayer(this.sim.previousPlayer, this.sim.player.state, alpha, this.playerFrame);
    // The view uses the newest mouse angles (not the last tick's) so looking never lags a frame.
    const look = this.input.state;
    frame.yaw = look.yaw;
    frame.pitch = clamp(look.pitch, -look.pitchLimit, look.pitchLimit);
    this.playerView.update(frame, frame.yaw, frame.pitch, frameSeconds);
    this.tpCamera.update(frame, this.sim.world, this.sim.player.collider, this.options.settings.value.fov, frameSeconds);
    const cam = this.view.camera.position;
    const headY = frame.y + this.sim.camera.pivotHeight - 0.5 * frame.crouchBlend;
    this.playerView.setCameraDistance(Math.hypot(cam.x - frame.x, cam.y - headY, cam.z - frame.z));
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
      case "land":
        this.tpCamera.land(event.speed);
        this.playerView.land(event.speed);
        break;
      case "respawn":
        this.hud.showToast("Fell out of the world: back to spawn");
        break;
      case "jump":
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
    o.addLine(() => `DRIFTGLASS  M2 movement playground   seed ${this.seed}`);
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
      const p = this.sim.player.state;
      return (
        `player ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}   speed ${this.sim.player.horizontalSpeed.toFixed(2)} m/s   ` +
        `vy ${p.vy.toFixed(2)}   ${p.grounded ? "grounded" : `air ${p.airTime.toFixed(2)} s`}`
      );
    });
    o.addLine(() => {
      const p = this.sim.player.state;
      const deg = (r: number): string => ((r * 180) / Math.PI).toFixed(0);
      const slope = deg(Math.acos(Math.min(1, p.groundNy)));
      return (
        `${p.crouched ? "crouched" : "standing"}   ads ${p.adsBlend.toFixed(2)}   shoulder ${p.shoulder > 0 ? "right" : "left"}   ` +
        `look ${deg(p.yaw)}/${deg(p.pitch)}   body ${deg(p.bodyYaw)}   slope ${slope} deg   arm ${this.tpCamera.armLength.toFixed(2)} m`
      );
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
