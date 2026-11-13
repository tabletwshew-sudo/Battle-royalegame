/**
 * Loud on-screen error display. Anything that goes wrong (boot failure,
 * uncaught exception, rejected promise) is shown here, never only in the console.
 */
export class ErrorPanel {
  private readonly element: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private count = 0;
  private static readonly MAX_ENTRIES = 6;

  constructor(parent: HTMLElement) {
    this.element = document.createElement("div");
    this.element.setAttribute("role", "alert");
    this.element.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:16px",
      "transform:translateX(-50%)",
      "max-width:min(900px,92vw)",
      "z-index:10000",
      "display:none",
      "background:#3b0d0d",
      "color:#ffe9e0",
      "border:3px solid #ff5a3d",
      "border-radius:10px",
      "padding:12px 16px",
      "font:14px/1.4 ui-monospace,Menlo,Consolas,monospace",
      "box-shadow:0 8px 30px #000a",
      "white-space:pre-wrap",
      "word-break:break-word",
      "user-select:text",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "DRIFTGLASS ERROR";
    title.style.cssText = "font-weight:800;letter-spacing:0.1em;color:#ff7a3d;margin-bottom:6px";
    this.list = document.createElement("div");
    this.element.append(title, this.list);
    parent.append(this.element);
  }

  /** Shows an error. `context` says where it came from (for example "Engine start"). */
  show(context: string, error: unknown): void {
    this.count++;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const line = document.createElement("div");
    line.textContent = `[${this.count}] ${context}: ${message}`;
    this.list.append(line);
    while (this.list.childElementCount > ErrorPanel.MAX_ENTRIES) this.list.firstElementChild?.remove();
    this.element.style.display = "block";
    console.error(`[DRIFTGLASS] ${context}:`, error);
  }

  /** Routes uncaught errors and unhandled promise rejections into the panel. */
  installGlobalHandlers(): void {
    window.addEventListener("error", (event) => this.show("Uncaught error", event.error ?? event.message));
    window.addEventListener("unhandledrejection", (event) => this.show("Unhandled promise rejection", event.reason));
  }

  get errorCount(): number {
    return this.count;
  }
}
