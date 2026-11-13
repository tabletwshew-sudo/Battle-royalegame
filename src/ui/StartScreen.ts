import { FAN_NOTICE, GAME_TITLE } from "../shared/rules/Strings";

/** Brand palette (see docs/GAME_SPEC.md, UI section). */
const PALETTE = { teal: "#0F2A33", sand: "#F2E3C6", orange: "#FF7A3D", violet: "#8A4BFF" } as const;

/**
 * Renders the static title screen: game title, current milestone and the
 * unofficial-fan-project notice. It has no interactive controls yet.
 */
export function mountStartScreen(root: HTMLElement): void {
  document.body.style.margin = "0";
  document.body.style.background = PALETTE.teal;
  root.style.cssText = [
    "min-height:100vh",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:16px",
    `color:${PALETTE.sand}`,
    "font-family:system-ui,sans-serif",
    `background:radial-gradient(circle at 50% 35%, ${PALETTE.violet}55, ${PALETTE.teal} 70%)`,
  ].join(";");

  const title = document.createElement("h1");
  title.textContent = GAME_TITLE;
  title.style.cssText = `margin:0;font-size:clamp(48px,10vw,120px);letter-spacing:0.08em;color:${PALETTE.sand};text-shadow:4px 4px 0 ${PALETTE.orange}`;

  const status = document.createElement("p");
  status.textContent = "Milestone M0: research and specification complete. The playable engine arrives in M1.";
  status.style.cssText = "margin:0;font-size:18px;opacity:0.85;text-align:center;padding:0 16px";

  const notice = document.createElement("p");
  notice.textContent = FAN_NOTICE;
  notice.style.cssText = "position:fixed;bottom:12px;margin:0;font-size:12px;opacity:0.7";

  root.replaceChildren(title, status, notice);
}
