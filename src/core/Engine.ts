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
import { DoorView } from "../render/DoorView";
import { ProbeView } from "../render/ProbeView";
import { SandboxView } from "../render/SandboxView";
import { defaultPalette } from "../player/CharacterRig";
import type { PlayerFrame } from "../player/PlayerView";
import { PICKAXE_SLOT } from "../shared/sim/PlayerSim";
import { type HudModel, MovementHud } from "../ui/MovementHud";
import { SelfTestPanel } from "../ui/SelfTestPanel";
import { TuningPanel } from "./TuningPanel";
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
 * Mostly read-only; `look()` exists because headless browsers cannot
 * produce pointer-lock mouse movement, `teleport()` / `skydive()` put the
 * player where a visual check needs it.
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
    mode: string;
    stamina: number;
    sprinting: boolean;
    health: number;
    shield: number;
    overshield: number;
    equipSlot: number;
  };
  /** Result of the last finished F9 self-test run, or null if none finished yet. */
  selfTest(): { passed: number; total: number; failures: string[] } | null;
  /** Current camera arm length in metres. */
  cameraArm(): number;
  /** Sets the view angles as if the mouse had moved there (radians). */
  look(yaw: number, pitch: number): void;
  /** Debug: moves the player (feet) to a point. */
  teleport(x: number, y: number, z: number): void;
  /** Debug: starts a skydive `height` metres above the current position. */
  skydive(height: number): void;
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
  private readonly dummyView: PlayerView | null;
  private readonly dummyFrame = makePlayerFrame();
  private readonly doorView: DoorView;
  private readonly probeView: ProbeView;
  private readonly selfTestPanel: SelfTestPanel;
  private readonly tuningPanel: TuningPanel;
  private readonly hud: MovementHud;
  private readonly hudModel: HudModel;
  /** Smoothed skydive/glide camera framing. */
  private armExtra = 0;
  private heightExtra = 0;
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
    this.dummyView = this.sim.dummy === null ? null : new PlayerView(defaultPalette(0x8a4bff));
    if (this.dummyView !== null) this.view.scene.add(this.dummyView.object);
    this.doorView = new DoorView(this.view.scene, this.sim.doors);
    this.probeView = new ProbeView(this.view.scene);
    this.selfTestPanel = new SelfTestPanel(root);
    this.tuningPanel = new TuningPanel({
      movement: this.sim.movement,
      camera: this.sim.camera,
      sprintMode: settings.value.sprintMode,
      onSprintMode: (sprintMode) => settings.update({ sprintMode }),
      onStructuralChange: () => {
        for (const character of this.sim.characters) character.applyConfigChanges();
      },
    });
    this.hud = new MovementHud(root);
    this.hudModel = {
      health: 100,
      maxHealth: 100,
      shield: 0,
      maxShield: 100,
      overshield: 50,
      maxOvershield: 50,
      stamina: 100,
      staminaMax: 100,
      sprinting: false,
      modeLabel: "",
      altitude: null,
      prompt: "",
      slotLabel: "",
      itemReady: true,
      splat: false,
    };
    this.overlay = new DebugOverlay(root);
    this.overlay.setVisible(settings.value.showStats);

    this.input = new Input(
      canvas,
      {
        onDebugKey: (code) => this.onDebugKey(code),
        onPointerLockChange: (locked) => this.bus.emit("pointerLock", { locked }),
      },
      undefined,
      ["F3", "F4", "F9"],
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
          mode: p.mode,
          stamina: p.stamina,
          sprinting: p.sprinting,
          health: p.vitals.health,
          shield: p.vitals.shield,
          overshield: p.vitals.overshield,
          equipSlot: p.equipSlot,
        };
      },
      selfTest: () => {
        const results = this.selfTestPanel.results;
        if (this.selfTestPanel.isRunning || results.length === 0) return null;
        return {
          passed: results.filter((r) => r.passed).length,
          total: results.length,
          failures: results.filter((r) => !r.passed).map((r) => `${r.name}: ${r.detail}`),
        };
      },
      cameraArm: () => this.tpCamera.armLength,
      look: (yaw, pitch) => this.input.state.setLook(yaw, pitch),
      teleport: (x, y, z) => this.sim.player.teleport(x, y, z),
      skydive: (height) => {
        const p = this.sim.player.state;
        this.sim.player.teleport(p.x, p.y + height, p.z);
        this.sim.player.startSkydive();
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.loop.dispose();
    this.input.dispose();
    for (const cleanup of this.cleanups) cleanup();
    this.hud.dispose();
    this.overlay.dispose();
    this.selfTestPanel.dispose();
    this.tuningPanel.dispose();
    this.probeView.dispose();
    this.doorView.dispose();
    this.dummyView?.dispose();
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
    const sim = this.sim;
    const p = sim.player.state;
    const frame = interpolatePlayer(sim.previousPlayer, p, alpha, sim.movement, this.playerFrame);
    // The view uses the newest mouse angles (not the last tick's) so looking never lags a frame.
    const look = this.input.state;
    frame.yaw = look.yaw;
    frame.pitch = clamp(look.pitch, -look.pitchLimit, look.pitchLimit);

    // Wider framing while skydiving and gliding, eased so the camera pulls back smoothly.
    const cam = sim.camera;
    const framing = 1 - Math.exp(-3 * frameSeconds);
    const targetArm = p.mode === "skydive" ? cam.skydiveArmExtra : p.mode === "glide" ? cam.glideArmExtra : 0;
    const targetHeight = p.mode === "skydive" ? cam.skydiveHeightExtra : p.mode === "glide" ? cam.glideHeightExtra : 0;
    this.armExtra += (targetArm - this.armExtra) * framing;
    this.heightExtra += (targetHeight - this.heightExtra) * framing;
    frame.armExtra = this.armExtra;
    frame.heightExtra = this.heightExtra;

    this.playerView.update(frame, frame.yaw, frame.pitch, frameSeconds);
    this.tpCamera.update(frame, sim.world, sim.player.collider, this.options.settings.value.fov, frameSeconds, this.cameraEffects(frame));
    const camPos = this.view.camera.position;
    const headY = frame.y + cam.pivotHeight - 0.5 * frame.crouchBlend;
    this.playerView.setCameraDistance(Math.hypot(camPos.x - frame.x, camPos.y - headY, camPos.z - frame.z));

    if (this.dummyView !== null && sim.dummy !== null && sim.previousDummy !== null) {
      const d = interpolatePlayer(sim.previousDummy, sim.dummy.state, alpha, sim.movement, this.dummyFrame);
      this.dummyView.update(d, d.yaw, d.pitch, frameSeconds);
    }
    this.doorView.update();
    this.probeView.update(sim.player, sim.world);
    this.view.update(alpha, frameSeconds);
    this.hud.update(this.buildHudModel(), frameSeconds);
    this.handle.renderer.render(this.view.scene, this.view.camera);
    this.overlay.update(frameSeconds);
  }

  /** Sprint FOV kick and a slight roll into slide turns. */
  private cameraEffects(frame: PlayerFrame): { fovScale: number; roll: number } {
    const speed = Math.hypot(frame.vx, frame.vz);
    let fovScale = 1;
    if (frame.sprinting && frame.grounded) fovScale = this.sim.camera.sprintFovScale;
    else if (frame.mode === "slide") fovScale = 1 + (this.sim.camera.sprintFovScale - 1) * Math.min(1, speed / 12);
    let roll = 0;
    if (frame.mode === "slide" && speed > 0.5) {
      // Sideways component of the slide relative to the view tilts the horizon a little.
      const lateral = (frame.vx * Math.cos(frame.yaw) - frame.vz * Math.sin(frame.yaw)) / speed;
      roll = -lateral * 0.07;
    }
    return { fovScale, roll };
  }

  private buildHudModel(): HudModel {
    const player = this.sim.player;
    const p = player.state;
    const m = this.hudModel;
    const v = p.vitals;
    const c = this.sim.movement;
    m.health = v.health;
    m.shield = v.shield;
    m.overshield = v.overshield;
    m.stamina = p.stamina;
    m.staminaMax = c.staminaMax;
    m.sprinting = p.sprinting;
    m.splat = p.mode === "splat";
    m.itemReady = player.canUseItem;
    m.slotLabel = p.equipSlot === PICKAXE_SLOT ? "PICKAXE" : `SLOT ${p.equipSlot}  (empty)`;
    const label: Record<string, string> = {
      walk: p.grounded ? (p.sprinting ? "SPRINT" : p.crouched ? "CROUCH" : "") : "AIR",
      slide: "SLIDE",
      mantle: "MANTLE",
      hurdle: "HURDLE",
      roll: "ROLL",
      skydive: "SKYDIVE",
      glide: "GLIDE",
      splat: "SPLAT",
    };
    m.modeLabel = label[p.mode] ?? "";
    m.altitude = p.mode === "skydive" || p.mode === "glide" || (!p.grounded && p.aboveGround > 15) ? p.aboveGround : null;
    let prompt = "";
    if (p.mode === "skydive") prompt = "SPACE  Deploy glider";
    else if (p.mode === "glide" && this.sim.rules.gliderCut) prompt = "SPACE  Close glider";
    else if (player.canRedeployNow) prompt = "SPACE  Redeploy glider";
    else if (p.mode === "walk" && p.grounded && this.sim.doors.nearestDoor(p.x, p.z, 2.2) >= 0) prompt = "E  Open / close door";
    m.prompt = prompt;
    return m;
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
        if (event.id !== this.sim.player.id) break;
        this.tpCamera.land(event.speed);
        this.playerView.land(event.speed);
        if (event.splat) this.hud.showToast(`SPLAT  -${Math.round(event.damage)}  (1 HP, shields gone)`);
        else if (event.roll) this.hud.showToast(`Roll landing  -${Math.round(event.damage)}`);
        else if (event.damage > 0) this.hud.showToast(`Fall damage  -${Math.round(event.damage)}`);
        break;
      case "respawn":
        if (event.id === this.sim.player.id) {
          this.hud.showToast(event.reason === "killPlane" ? "Fell out of the world: back to spawn" : "Eliminated: back to spawn");
        }
        break;
      case "door":
        if (event.action === "bash") this.hud.showToast("Shoulder bash!");
        break;
      case "slideKick":
        this.hud.showToast(event.attacker === this.sim.player.id ? `Slide kick!  ${event.damage}` : `Kicked  -${event.damage}`);
        break;
      case "gliderOpen":
        if (event.redeploy && event.id === this.sim.player.id) this.hud.showToast("Glider redeployed");
        break;
      case "staminaEmpty":
        if (event.id === this.sim.player.id) this.hud.showToast("Out of energy");
        break;
      case "launch":
        if (event.id === this.sim.player.id) this.hud.showToast("Launch pad!");
        break;
      case "jump":
      case "eliminated":
      case "sprintStart":
      case "sprintEnd":
      case "slideStart":
      case "slideEnd":
      case "traverse":
      case "skydiveStart":
      case "gliderClose":
      case "equip":
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
    else if (code === "F4") {
      this.probeView.setEnabled(!this.probeView.isEnabled);
      this.tuningPanel.toggle().catch((error: unknown) => console.error("[DRIFTGLASS] Tuning panel failed to load:", error));
    } else if (code === "F9") this.selfTestPanel.toggle();
  }

  private applySettings(): void {
    const s = this.options.settings.value;
    this.input.state.sensitivity = s.mouseSensitivity;
    this.input.state.invertY = s.invertY;
    this.input.state.sprintMode = s.sprintMode;
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
    o.addLine(() => `DRIFTGLASS  M3 movement playground   seed ${this.seed}`);
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
    o.addLine(() => {
      const p = this.sim.player.state;
      const v = p.vitals;
      return (
        `mode ${p.mode} (${p.modeTime.toFixed(2)} s)   stamina ${p.stamina.toFixed(1)}${p.sprinting ? " sprinting" : ""}   ` +
        `hp ${v.health.toFixed(0)} sh ${v.shield.toFixed(0)} os ${v.overshield.toFixed(0)}   slot ${p.equipSlot}${p.holstered ? " (lowered)" : ""}`
      );
    });
    o.addLine(() => {
      const p = this.sim.player.state;
      return `fall ${this.sim.player.fallDistance.toFixed(1)} m   above ground ${p.aboveGround.toFixed(1)} m   F4 probe: ${this.probeView.summary}`;
    });
    o.addLine(() => `three r${REVISION}   rapier ${physicsVersion()}`);
  }
}
