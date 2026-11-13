/**
 * Minimal HUD for the engine sandbox: crosshair, control hints, a
 * "click to capture mouse" banner and short event toasts.
 */
export class SandboxHud {
  private readonly root: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private toastSeconds = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:500;font-family:system-ui,sans-serif;color:#f2e3c6";

    const crosshair = document.createElement("div");
    crosshair.style.cssText =
      "position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#f2e3c6;box-shadow:0 0 0 2px #0f2a33aa";

    const hints = document.createElement("div");
    hints.textContent =
      "WASD fly  ·  Mouse look  ·  Space / C up / down  ·  Shift fast  ·  Left click kick  ·  R respawn crates  ·  F3 stats  ·  Esc release mouse";
    hints.style.cssText =
      "position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:6px 14px;border-radius:999px;background:#0f2a33cc;font-size:13px;white-space:nowrap";

    this.banner = document.createElement("div");
    this.banner.textContent = "Click to capture the mouse";
    this.banner.style.cssText =
      "position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);padding:12px 22px;border-radius:12px;background:#ff7a3d;color:#0f2a33;font-size:20px;font-weight:800";

    this.toast = document.createElement("div");
    this.toast.style.cssText =
      "position:absolute;left:50%;top:58%;transform:translateX(-50%);padding:6px 14px;border-radius:8px;background:#0f2a33cc;font-size:15px;font-weight:600;opacity:0;transition:opacity 0.15s";

    this.root.append(crosshair, hints, this.banner, this.toast);
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

  update(frameSeconds: number): void {
    if (this.toastSeconds <= 0) return;
    this.toastSeconds -= frameSeconds;
    if (this.toastSeconds <= 0) this.toast.style.opacity = "0";
  }

  dispose(): void {
    this.root.remove();
  }
}
