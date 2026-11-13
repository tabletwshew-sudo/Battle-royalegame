import type { DebugHandle, DeviceLoss } from "./core/Engine";
import { ErrorPanel } from "./core/ErrorPanel";
import { browserStorage, SettingsStore } from "./core/Settings";
import { defaultFlags, parseUrlFlags, type UrlFlags } from "./shared/rules/UrlFlags";
import { StartScreen } from "./ui/StartScreen";

declare global {
  interface Window {
    /** Read-only debug handle, set once the engine is running. */
    __DRIFTGLASS__?: DebugHandle;
  }
}

/** Lists the flags that differ from their defaults, for display on the start screen. */
function describeFlags(flags: UrlFlags): string {
  const defaults = defaultFlags();
  const parts: string[] = [];
  for (const key of Object.keys(flags) as Array<keyof UrlFlags>) {
    if (flags[key] !== defaults[key]) parts.push(`${key}=${String(flags[key])}`);
  }
  return parts.length > 0 ? `flags: ${parts.join("  ")}` : "";
}

/** sessionStorage key: set before the automatic WebGL2 reload so the sandbox restarts by itself. */
const AUTOSTART_KEY = "driftglass.autostart";

/** Reads and clears the autostart marker. Returns false where sessionStorage is blocked. */
function consumeAutostart(): boolean {
  try {
    const marked = sessionStorage.getItem(AUTOSTART_KEY) === "1";
    sessionStorage.removeItem(AUTOSTART_KEY);
    return marked;
  } catch {
    return false;
  }
}

/**
 * Recovery when the graphics device is lost. A lost WebGPU device is replaced
 * by reloading into the WebGL2 renderer with the same seed; a lost WebGL2
 * context has no further fallback, so the player is told to reload.
 */
function handleDeviceLost(loss: DeviceLoss): void {
  if (loss.backend !== "webgpu") {
    errors.show("Graphics device lost", `${loss.message}. Reload the page to continue.`);
    return;
  }
  errors.show("WebGPU device lost", `${loss.message}. Switching to the WebGL2 renderer...`);
  const url = new URL(window.location.href);
  url.searchParams.set("renderer", "webgl");
  url.searchParams.set("seed", String(loss.seed));
  try {
    sessionStorage.setItem(AUTOSTART_KEY, "1");
  } catch {
    // Without sessionStorage the title screen simply shows again after the reload.
  }
  window.setTimeout(() => window.location.replace(url.toString()), 1200);
}

/** Returns the element the game mounts into, or throws a readable error. */
function findRoot(): HTMLElement {
  const element = document.getElementById("app");
  if (element === null) throw new Error("DRIFTGLASS: #app root element missing from index.html");
  return element;
}

const root = findRoot();
const errors = new ErrorPanel(document.body);
errors.installGlobalHandlers();

const flags = parseUrlFlags(window.location.search);
const settings = new SettingsStore(browserStorage());

/** Loads and starts the engine, reporting failures on screen. */
function startEngine(): void {
  startScreen.setLoading();
  // The engine (three + Rapier, several MB) is loaded on demand so the title screen appears instantly.
  import("./core/Engine")
    .then(({ Engine }) => Engine.create({ root, flags, settings, onDeviceLost: handleDeviceLost }))
    .then((engine) => {
      startScreen.hide();
      window.__DRIFTGLASS__ = engine.debugHandle();
      engine.start();
    })
    .catch((error: unknown) => {
      errors.show("Engine start", error);
      startScreen.setReady("The engine could not start. See the error above, then try again.");
    });
}

const startScreen = new StartScreen(root, { flagSummary: describeFlags(flags), onStart: startEngine });

// Coming back from an automatic WebGPU -> WebGL2 switch: continue without another click.
if (consumeAutostart()) startEngine();
