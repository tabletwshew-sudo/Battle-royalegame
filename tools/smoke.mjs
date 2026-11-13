/**
 * Browser smoke check: serves the production build, opens it in headless
 * Chromium, enters the sandbox and verifies that the sim ticks, events flow,
 * the F3 overlay works and no error panel appeared.
 *
 *   npm run build && npm run smoke -- --flags "renderer=webgl&seed=7" --shot out.png
 *   npm run smoke -- --webgpu            (asks Chromium for a software WebGPU adapter)
 *
 * Needs a Playwright + Chromium install on the machine (not a project dependency).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

/** Reads "--name value" from argv. */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const flags = arg("flags", "seed=7");
const shot = arg("shot", "");
const wantWebGPU = process.argv.includes("--webgpu");
const port = Number(arg("port", "4173"));
const url = `http://localhost:${port}/?${flags}`;

const server = spawn("npx", ["--no-install", "vite", "preview", "--port", String(port), "--strictPort"], {
  stdio: "ignore",
});

/** Polls the preview server until it answers. */
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error("preview server did not start");
}

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
};

let browser;
try {
  await waitForServer();
  const gpuArgs = wantWebGPU
    ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-webgpu-adapter=swiftshader", "--use-angle=swiftshader"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  browser = await chromium.launch({ args: gpuArgs });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(url);
  check((await page.textContent("h1")) === "DRIFTGLASS", "title screen shows the game title");
  check((await page.textContent("body")).includes("not affiliated with Epic Games"), "fan notice is visible");

  await page.click("button");
  await page.waitForFunction(() => window.__DRIFTGLASS__ !== undefined, null, { timeout: 30000 });
  const backend = await page.evaluate(() => window.__DRIFTGLASS__.backend);
  console.log(`INFO  backend: ${backend}`);
  if (wantWebGPU) check(backend === "webgpu", "WebGPU backend initialized");
  if (flags.includes("renderer=webgl")) check(backend === "webgl2", "WebGL2 backend forced by ?renderer=webgl");

  // Headless Chromium on machines without a GPU can initialize WebGPU but not present
  // frames; the browser then drops the device. The game must recover on WebGL2 by itself.
  let fellBack = false;
  if (wantWebGPU) {
    await sleep(3500);
    await page.waitForFunction(() => window.__DRIFTGLASS__ !== undefined, null, { timeout: 30000 });
    fellBack = (await page.evaluate(() => window.__DRIFTGLASS__.backend)) === "webgl2";
    if (fellBack) {
      console.log("INFO  this browser dropped the WebGPU device; checking the automatic WebGL2 fallback");
      check(new URL(page.url()).searchParams.get("renderer") === "webgl", "device loss reloads into ?renderer=webgl");
      consoleErrors.length = 0;
    }
  }

  const tickA = await page.evaluate(() => window.__DRIFTGLASS__.tick());
  await sleep(2000);
  const tickB = await page.evaluate(() => window.__DRIFTGLASS__.tick());
  console.log(`INFO  ticks in 2 s: ${tickB - tickA}, fps ${(await page.evaluate(() => window.__DRIFTGLASS__.fps())).toFixed(0)}`);
  check(tickB - tickA > 20, "simulation is ticking");
  check((await page.evaluate(() => window.__DRIFTGLASS__.drawCalls())) > 0, "renderer issues draw calls");

  await page.keyboard.press("F3");
  await sleep(600);
  const overlay = await page.evaluate(() => document.querySelector("pre")?.textContent ?? "");
  check(overlay.includes("state hash") && overlay.includes("backend"), "F3 overlay shows stats");

  const hashBefore = await page.evaluate(() => window.__DRIFTGLASS__.hash());
  await page.keyboard.down("KeyW");
  await sleep(500);
  await page.keyboard.up("KeyW");
  await page.keyboard.press("KeyR");
  await sleep(300);
  const hashAfter = await page.evaluate(() => window.__DRIFTGLASS__.hash());
  check(hashBefore !== hashAfter, "keyboard input changes the sim state");
  check((await page.evaluate(() => window.__DRIFTGLASS__.simEvents())) >= 1, "sim events reach the client (respawn)");

  // Mouse path: the first click captures the pointer, movement turns the view, a second click kicks.
  await page.mouse.click(640, 360);
  await sleep(300);
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  if (locked) {
    const eventsBefore = await page.evaluate(() => window.__DRIFTGLASS__.simEvents());
    const overlayText = () => page.evaluate(() => document.querySelector("pre")?.textContent ?? "");
    const yawOf = (text) => Number(/yaw (-?\d+)/.exec(text)?.[1] ?? NaN);
    const yawBefore = yawOf(await overlayText());
    await page.mouse.move(840, 360, { steps: 5 });
    await page.mouse.down();
    await sleep(200);
    await page.mouse.up();
    await sleep(700);
    check(yawOf(await overlayText()) !== yawBefore, "mouse movement turns the view while captured");
    check((await page.evaluate(() => window.__DRIFTGLASS__.simEvents())) > eventsBefore, "left click produces a kick event");
    check((await overlayText()).includes("mouse captured"), "overlay reports the captured mouse");
  } else {
    console.log("INFO  pointer lock is unavailable in this browser; mouse checks skipped");
  }

  await sleep(1500);
  if (shot) await page.screenshot({ path: shot });
  const alert = await page.evaluate(() => {
    const panel = document.querySelector('[role="alert"]');
    return panel && getComputedStyle(panel).display !== "none" ? panel.textContent : "";
  });
  check(alert === "", `no error panel${alert ? `: ${alert}` : ""}`);
  check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.slice(0, 3).join(" | ")}` : ""}`);
} catch (error) {
  check(false, `smoke run crashed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser?.close();
  server.kill();
}
process.exit(failures.length === 0 ? 0 : 1);
