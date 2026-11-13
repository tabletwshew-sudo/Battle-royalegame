import { runSelfTest, type SelfTestResult, selfTestNames } from "../shared/sim/SelfTest";

/**
 * F9 movement self-test panel. Runs every scripted movement case in fresh
 * headless sims (the same code `npm test` runs) one case per frame, and
 * lists pass/fail with the measured values.
 */
export class SelfTestPanel {
  private readonly element: HTMLDivElement;
  private readonly list: HTMLOListElement;
  private readonly summary: HTMLDivElement;
  private running = false;
  private timer = 0;
  private visible = false;
  /** Results of the last finished run (also read by automated checks). */
  results: SelfTestResult[] = [];

  constructor(parent: HTMLElement) {
    this.element = document.createElement("div");
    this.element.style.cssText = [
      "position:fixed",
      "right:12px",
      "top:12px",
      "width:min(560px,92vw)",
      "max-height:80vh",
      "overflow:auto",
      "z-index:950",
      "display:none",
      "background:#0f2a33f2",
      "color:#f2e3c6",
      "border:2px solid #8a4bff",
      "border-radius:10px",
      "padding:10px 14px",
      "font:12px/1.45 ui-monospace,Menlo,Consolas,monospace",
    ].join(";");
    const title = document.createElement("div");
    title.textContent = "F9  MOVEMENT SELF-TEST";
    title.style.cssText = "font-weight:800;letter-spacing:0.08em;color:#ff7a3d;margin-bottom:4px";
    this.summary = document.createElement("div");
    this.summary.style.cssText = "margin-bottom:6px";
    this.list = document.createElement("ol");
    this.list.style.cssText = "margin:0;padding-left:22px";
    this.element.append(title, this.summary, this.list);
    parent.append(this.element);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** F9: shows the panel and starts a run, or hides it when it is idle and shown. */
  toggle(): void {
    if (this.visible && !this.running) {
      this.visible = false;
      this.element.style.display = "none";
      return;
    }
    this.visible = true;
    this.element.style.display = "block";
    if (!this.running) this.start();
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.element.remove();
  }

  private start(): void {
    this.running = true;
    this.results = [];
    this.list.replaceChildren();
    const names = selfTestNames();
    this.summary.textContent = `Running ${names.length} cases...`;
    const runNext = (index: number): void => {
      if (index >= names.length) {
        this.running = false;
        const passed = this.results.filter((r) => r.passed).length;
        this.summary.textContent = `${passed}/${names.length} passed. Press F9 to close.`;
        this.summary.style.color = passed === names.length ? "#4ccb4a" : "#ff5a3d";
        return;
      }
      const result = runSelfTest(index);
      this.results.push(result);
      const item = document.createElement("li");
      item.textContent = `${result.passed ? "PASS" : "FAIL"}  ${result.name}: ${result.detail}`;
      item.style.color = result.passed ? "#cfe9d0" : "#ff8a70";
      this.list.append(item);
      this.summary.textContent = `Running ${index + 1}/${names.length}...`;
      // One case per task keeps the game responsive while the suite runs.
      this.timer = window.setTimeout(() => runNext(index + 1), 0);
    };
    runNext(0);
  }
}
