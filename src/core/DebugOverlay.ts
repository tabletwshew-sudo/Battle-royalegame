/**
 * F3 stats overlay. Systems register line providers; the text is rebuilt a
 * few times per second (not every frame) to keep HUD cost negligible.
 */
export type OverlayLine = () => string;

export class DebugOverlay {
  private readonly element: HTMLPreElement;
  private readonly lines: OverlayLine[] = [];
  private visible = false;
  private sinceRefresh = Infinity;
  private static readonly REFRESH_SECONDS = 0.25;

  constructor(parent: HTMLElement) {
    this.element = document.createElement("pre");
    this.element.style.cssText = [
      "position:fixed",
      "left:10px",
      "top:10px",
      "margin:0",
      "padding:8px 10px",
      "z-index:900",
      "display:none",
      "pointer-events:none",
      "background:#0f2a33d9",
      "color:#f2e3c6",
      "border-left:4px solid #ff7a3d",
      "border-radius:6px",
      "font:12px/1.45 ui-monospace,Menlo,Consolas,monospace",
      "white-space:pre",
    ].join(";");
    parent.append(this.element);
  }

  /** Adds a line; the provider is called on each refresh while visible. */
  addLine(provider: OverlayLine): void {
    this.lines.push(provider);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.style.display = visible ? "block" : "none";
    this.sinceRefresh = Infinity;
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  /** Call once per rendered frame. */
  update(frameSeconds: number): void {
    if (!this.visible) return;
    this.sinceRefresh += frameSeconds;
    if (this.sinceRefresh < DebugOverlay.REFRESH_SECONDS) return;
    this.sinceRefresh = 0;
    let text = "";
    for (const line of this.lines) text += line() + "\n";
    this.element.textContent = text;
  }

  dispose(): void {
    this.element.remove();
  }
}
