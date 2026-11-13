import type { CameraConfig } from "../shared/sim/CameraRig";
import type { MovementConfig } from "../shared/sim/MovementConfig";
import type { SprintMode } from "./Input";

/**
 * F4 live tuning panel (lil-gui, loaded on first use). Edits the shared
 * MovementConfig / CameraConfig objects in place, so changes take effect on
 * the next tick. `onStructuralChange` runs after values the physics
 * controller caches (slope, step height) change.
 */
export interface TuningTargets {
  movement: MovementConfig;
  camera: CameraConfig;
  sprintMode: SprintMode;
  onSprintMode(mode: SprintMode): void;
  onStructuralChange(): void;
}

type Range = [number, number, number];

const MOVEMENT_RANGES: Partial<Record<keyof MovementConfig, Range>> = {
  runSpeed: [1, 15, 0.1],
  sprintSpeed: [1, 20, 0.1],
  crouchSpeed: [0.5, 8, 0.1],
  jumpHeight: [0.2, 3, 0.05],
  gravity: [5, 60, 0.5],
  staminaDrain: [0, 50, 0.5],
  staminaRegen: [0, 50, 0.5],
  slideFlatDecel: [0, 20, 0.1],
  slideDownhillBoost: [0, 3, 0.05],
  slideMaxSpeed: [5, 40, 0.5],
  slideSteerRate: [0, 360, 5],
  slideJumpBoost: [1, 2, 0.01],
  mantleMaxHeight: [0.5, 4, 0.05],
  hurdleMaxHeight: [0.3, 2, 0.05],
  autostepHeight: [0, 1, 0.01],
  maxSlopeDeg: [10, 80, 1],
  gliderForwardSpeed: [5, 50, 0.5],
  gliderSinkSpeed: [1, 20, 0.5],
  gliderAutoDeployHeight: [20, 300, 5],
  fallDamageMinSpeed: [0, 40, 0.5],
  fallDamagePerSpeed: [0, 10, 0.1],
};

const CAMERA_RANGES: Partial<Record<keyof CameraConfig, Range>> = {
  shoulderOffset: [0, 1.5, 0.01],
  pivotHeight: [0.8, 2.5, 0.01],
  distance: [1, 8, 0.05],
  adsDistance: [0.5, 5, 0.05],
  adsFovScale: [0.3, 1, 0.01],
  sprintFovScale: [1, 1.3, 0.01],
};

/** Fields whose change requires rebuilding the character controller. */
const STRUCTURAL: ReadonlySet<string> = new Set(["autostepHeight", "maxSlopeDeg"]);

export class TuningPanel {
  private gui: { destroy(): void; show(show?: boolean): unknown; _hidden: boolean } | null = null;
  private loading = false;

  constructor(private readonly targets: TuningTargets) {}

  /** Shows or hides the panel (loads lil-gui the first time). */
  async toggle(): Promise<void> {
    if (this.gui !== null) {
      this.gui.show(this.gui._hidden);
      return;
    }
    if (this.loading) return;
    this.loading = true;
    try {
      const { default: GUI } = await import("lil-gui");
      const gui = new GUI({ title: "F4 Movement tuning" });
      gui.domElement.style.zIndex = "960";
      const t = this.targets;
      const settings = { sprintMode: t.sprintMode };
      gui.add(settings, "sprintMode", ["hold", "toggle", "auto"]).name("sprint mode").onChange((mode: SprintMode) => t.onSprintMode(mode));
      const movement = gui.addFolder("Movement");
      for (const [key, range] of Object.entries(MOVEMENT_RANGES) as [keyof MovementConfig, Range][]) {
        const controller = movement.add(t.movement, key, range[0], range[1], range[2]);
        if (STRUCTURAL.has(key)) controller.onFinishChange(() => t.onStructuralChange());
      }
      const camera = gui.addFolder("Camera");
      for (const [key, range] of Object.entries(CAMERA_RANGES) as [keyof CameraConfig, Range][]) {
        camera.add(t.camera, key, range[0], range[1], range[2]);
      }
      camera.close();
      this.gui = gui as unknown as typeof this.gui;
    } finally {
      this.loading = false;
    }
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
