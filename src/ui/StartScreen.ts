import { FAN_NOTICE, GAME_TITLE } from "../shared/rules/Strings";

/** Brand palette (see docs/GAME_SPEC.md, UI section). */
const PALETTE = { teal: "#0F2A33", sand: "#F2E3C6", orange: "#FF7A3D", violet: "#8A4BFF" } as const;

export interface StartScreenOptions {
  /** One line describing the active URL flags, or an empty string. */
  flagSummary: string;
  /** Called when the player presses the start button. */
  onStart(): void;
}

/**
 * Title screen: game title, a button that enters the engine sandbox, the
 * active debug flags and the unofficial-fan-project notice.
 */
export class StartScreen {
  private readonly element: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;
  private static readonly BUTTON_LABEL = "Enter engine sandbox";

  constructor(parent: HTMLElement, options: StartScreenOptions) {
    document.body.style.margin = "0";
    document.body.style.background = PALETTE.teal;
    document.body.style.overflow = "hidden";

    this.element = document.createElement("div");
    this.element.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:800",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:center",
      "gap:18px",
      `color:${PALETTE.sand}`,
      "font-family:system-ui,sans-serif",
      `background:radial-gradient(circle at 50% 35%, ${PALETTE.violet}55, ${PALETTE.teal} 70%)`,
    ].join(";");

    const title = document.createElement("h1");
    title.textContent = GAME_TITLE;
    title.style.cssText = `margin:0;font-size:clamp(48px,10vw,120px);letter-spacing:0.08em;color:${PALETTE.sand};text-shadow:4px 4px 0 ${PALETTE.orange}`;

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.textContent = StartScreen.BUTTON_LABEL;
    this.button.style.cssText = [
      "padding:14px 34px",
      "border:0",
      "border-radius:14px",
      `background:${PALETTE.orange}`,
      `color:${PALETTE.teal}`,
      "font:800 22px system-ui,sans-serif",
      "letter-spacing:0.04em",
      "cursor:pointer",
      `box-shadow:0 5px 0 ${PALETTE.violet}`,
    ].join(";");
    this.button.addEventListener("click", () => options.onStart());

    this.status = document.createElement("p");
    this.status.style.cssText = "margin:0;min-height:22px;font-size:16px;opacity:0.85;text-align:center;padding:0 16px";
    this.status.textContent = "Milestone M1: core engine. Fly around a physics yard to check the renderer, loop and input.";

    const flags = document.createElement("p");
    flags.textContent = options.flagSummary;
    flags.style.cssText = "margin:0;font:13px ui-monospace,Menlo,Consolas,monospace;opacity:0.7";

    const notice = document.createElement("p");
    notice.textContent = FAN_NOTICE;
    notice.style.cssText = "position:absolute;bottom:12px;margin:0;font-size:12px;opacity:0.7";

    this.element.append(title, this.button, this.status, flags, notice);
    parent.append(this.element);
  }

  /** Disables the button and shows a loading message while the engine boots. */
  setLoading(): void {
    this.button.disabled = true;
    this.button.textContent = "Loading...";
    this.button.style.opacity = "0.6";
    this.button.style.cursor = "default";
  }

  /** Re-enables the button after a failed start so the player can retry. */
  setReady(message: string): void {
    this.button.disabled = false;
    this.button.textContent = StartScreen.BUTTON_LABEL;
    this.button.style.opacity = "1";
    this.button.style.cursor = "pointer";
    this.status.textContent = message;
  }

  hide(): void {
    this.element.style.display = "none";
  }
}
