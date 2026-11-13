/**
 * HUD for the movement playground (the full HUD arrives in M11): crosshair,
 * vitals (overshield / shield / health) with the energy bar that shows only
 * while sprinting or recovering, held slot, mode and altitude readout,
 * context prompts, splat banner, toasts and the control hints. DOM writes
 * only happen when a displayed value changes, keeping the HUD well under
 * 1 ms per frame.
 */

export interface HudModel {
  health: number;
  maxHealth: number;
  shield: number;
  maxShield: number;
  overshield: number;
  maxOvershield: number;
  stamina: number;
  staminaMax: number;
  sprinting: boolean;
  /** Short state label, e.g. "SPRINT", "SLIDE", "GLIDE". */
  modeLabel: string;
  /** Height above ground in metres, or null when not shown. */
  altitude: number | null;
  /** Context prompt ("SPACE  Deploy glider"), or empty. */
  prompt: string;
  /** "PICKAXE" or "SLOT n". */
  slotLabel: string;
  itemReady: boolean;
  splat: boolean;
}

const COLORS = {
  teal: "#0F2A33",
  sand: "#F2E3C6",
  orange: "#FF7A3D",
  health: "#4CCB4A",
  shield: "#3FA7FF",
  overshield: "#FFB52E",
  energy: "#F7E26B",
} as const;

interface Bar {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  label: HTMLSpanElement;
}

function makeBar(color: string, height: number): Bar {
  const root = document.createElement("div");
  root.style.cssText = `position:relative;width:260px;height:${height}px;background:#0f2a33b3;border-radius:${height / 2}px;overflow:hidden;box-shadow:0 0 0 2px #0f2a33aa`;
  const fill = document.createElement("div");
  fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:100%;background:${color};transition:width 0.12s linear`;
  const label = document.createElement("span");
  label.style.cssText = `position:absolute;right:8px;top:50%;transform:translateY(-50%);font:800 ${Math.max(10, height - 6)}px system-ui,sans-serif;color:${COLORS.teal};text-shadow:0 0 2px #fff8`;
  root.append(fill, label);
  return { root, fill, label };
}

export class MovementHud {
  private readonly root: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly splat: HTMLDivElement;
  private readonly slot: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly energy: Bar;
  private readonly overshield: Bar;
  private readonly shield: Bar;
  private readonly health: Bar;
  private toastSeconds = 0;
  /** Last written text/width per element, to skip unchanged DOM writes. */
  private readonly written = new Map<HTMLElement, string>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:500;font-family:system-ui,sans-serif;color:${COLORS.sand}`;

    this.crosshair = document.createElement("div");
    this.crosshair.style.cssText =
      "position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#f2e3c6;box-shadow:0 0 0 2px #0f2a33aa;transition:opacity 0.1s";

    const hints = document.createElement("div");
    hints.textContent =
      "WASD move · Shift sprint · Space jump/mantle/glider · C slide/crouch · RMB aim · Q pickaxe · 1-5 slots · E door · X shoulder · LMB kick · R crates · F3 stats · F4 tuning/probes · F9 self-test";
    hints.style.cssText =
      "position:absolute;left:50%;bottom:8px;transform:translateX(-50%);padding:4px 12px;border-radius:999px;background:#0f2a33cc;font-size:12px;white-space:nowrap;max-width:96vw;overflow:hidden;text-overflow:ellipsis";

    this.banner = document.createElement("div");
    this.banner.textContent = "Click to capture the mouse";
    this.banner.style.cssText = `position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);padding:12px 22px;border-radius:12px;background:${COLORS.orange};color:${COLORS.teal};font-size:20px;font-weight:800`;

    this.toast = document.createElement("div");
    this.toast.style.cssText =
      "position:absolute;left:50%;top:60%;transform:translateX(-50%);padding:6px 14px;border-radius:8px;background:#0f2a33cc;font-size:15px;font-weight:700;opacity:0;transition:opacity 0.15s";

    this.status = document.createElement("div");
    this.status.style.cssText =
      "position:absolute;left:50%;top:14px;transform:translateX(-50%);padding:4px 14px;border-radius:999px;background:#0f2a33b3;font:800 14px system-ui,sans-serif;letter-spacing:0.08em";

    this.prompt = document.createElement("div");
    this.prompt.style.cssText = `position:absolute;left:50%;bottom:44px;transform:translateX(-50%);padding:5px 12px;border-radius:8px;background:#0f2a33d9;border:2px solid ${COLORS.orange};font:800 14px system-ui,sans-serif;display:none`;

    this.splat = document.createElement("div");
    this.splat.textContent = "SPLAT!";
    this.splat.style.cssText = `position:absolute;left:50%;top:30%;transform:translate(-50%,-50%) rotate(-6deg);font:900 64px system-ui,sans-serif;color:${COLORS.orange};text-shadow:4px 4px 0 ${COLORS.teal};display:none`;

    // Bottom-left vitals stack: energy above overshield above shield above health.
    const vitals = document.createElement("div");
    vitals.style.cssText = "position:absolute;left:18px;bottom:44px;display:flex;flex-direction:column;gap:5px";
    this.energy = makeBar(COLORS.energy, 8);
    this.overshield = makeBar(COLORS.overshield, 14);
    this.shield = makeBar(COLORS.shield, 16);
    this.health = makeBar(COLORS.health, 20);
    this.energy.label.style.display = "none";
    vitals.append(this.energy.root, this.overshield.root, this.shield.root, this.health.root);

    this.slot = document.createElement("div");
    this.slot.style.cssText = `position:absolute;right:18px;bottom:44px;min-width:120px;padding:10px 14px;border-radius:12px;background:#0f2a33cc;border:3px solid ${COLORS.sand}55;font:800 15px system-ui,sans-serif;text-align:center`;

    this.root.append(this.crosshair, hints, this.banner, this.toast, this.status, this.prompt, this.splat, vitals, this.slot);
    parent.append(this.root);
  }

  /** Shows or hides the "click to capture" banner. */
  setPointerLocked(locked: boolean): void {
    this.banner.style.display = locked ? "none" : "block";
  }

  /** Displays a short message for about a second and a half. */
  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = "1";
    this.toastSeconds = 1.5;
  }

  update(model: HudModel, frameSeconds: number): void {
    if (this.toastSeconds > 0) {
      this.toastSeconds -= frameSeconds;
      if (this.toastSeconds <= 0) this.toast.style.opacity = "0";
    }
    this.setBar(this.health, model.health, model.maxHealth, true);
    this.setBar(this.shield, model.shield, model.maxShield, true);
    this.setBar(this.overshield, model.overshield, model.maxOvershield, true);
    this.setBar(this.energy, model.stamina, model.staminaMax, false);
    // Energy only shows while sprinting or recovering.
    this.setStyle(this.energy.root, "visibility", model.sprinting || model.stamina < model.staminaMax - 0.01 ? "visible" : "hidden");

    const altitude = model.altitude === null ? "" : `   ALT ${Math.round(model.altitude)} m`;
    const statusText = `${model.modeLabel}${altitude}`.trim();
    this.setText(this.status, statusText);
    this.setStyle(this.status, "display", statusText === "" ? "none" : "block");
    this.setText(this.prompt, model.prompt);
    this.setStyle(this.prompt, "display", model.prompt === "" ? "none" : "block");
    this.setStyle(this.splat, "display", model.splat ? "block" : "none");
    this.setText(this.slot, `${model.slotLabel}${model.itemReady ? "" : "  ·  lowered"}`);
    this.setStyle(this.slot, "opacity", model.itemReady ? "1" : "0.55");
    this.setStyle(this.crosshair, "opacity", model.itemReady ? "1" : "0.35");
  }

  dispose(): void {
    this.root.remove();
  }

  private setBar(bar: Bar, value: number, max: number, showLabel: boolean): void {
    const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    this.setStyle(bar.fill, "width", `${percent.toFixed(1)}%`);
    if (showLabel) this.setText(bar.label, String(Math.ceil(value)));
  }

  private setText(element: HTMLElement, text: string): void {
    if (this.written.get(element) === text) return;
    this.written.set(element, text);
    element.textContent = text;
  }

  private setStyle(element: HTMLElement, property: "width" | "display" | "visibility" | "opacity", value: string): void {
    const key = `${property}:${value}`;
    const cacheKey = element.dataset[property] ?? "";
    if (cacheKey === key) return;
    element.dataset[property] = key;
    element.style[property] = value;
  }
}
