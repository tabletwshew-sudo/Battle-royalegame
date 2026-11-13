# Architecture

## Pinned versions (exact; `.npmrc` has `save-exact=true`)
| Package | Version | Role |
|---|---|---|
| three / @types/three | 0.187.0 / 0.187.0 | Rendering (`three/webgpu`, `three/tsl`) |
| @dimforge/rapier3d-compat | 0.21.0 | Physics (WASM inlined; browser + Node) |
| @colyseus/core | 0.18.23 | Server rooms (M12+) |
| @colyseus/ws-transport | 0.18.4 | Server WebSocket transport |
| @colyseus/schema | 5.0.42 | State sync schema |
| @colyseus/sdk | 0.18.6 | Client SDK |
| typescript | 7.0.2 | Type checking (native compiler) |
| vite | 8.3.5 | Dev server + build |
| vitest | 5.0.5 | Tests |
| tsx | 4.23.15 | Running TS tools/server in Node |
| lil-gui | 0.21.0 | Dev-only debug panels |
| @types/node | 24.19.2 | Node types |

Versions were chosen to be at least ~2 weeks old on 2026-11-13, except where the next-older line was much older. Colyseus 0.18 patch releases ship almost daily, so re-verify the APIs when bumping.

## Folder map
```
src/shared/        PURE deterministic sim (ES2022 lib only; imported unchanged by server)
  sim/ physics/ world/ combat/ inventory/ match/ party/ team/ ai/ rules/ data/
src/core           Engine, RendererFactory, GameLoop, Input, EventBus, Settings, DebugOverlay, Quality
src/player src/world src/render src/shaders src/vfx src/combat src/loot
src/audio src/match src/team src/ui src/net      client-only rendering/input/presentation
server/            Colyseus: PartyRoom, QueueRoom, MatchRoom, schema, security, bots
tools/             balance-report, marker check, load test
tests/             vitest suites (tests/**/*.test.ts)
docs/              spec, mechanics notes, references
```

## Modules present (after M1)

### Shared (pure)
| File | What it provides |
|---|---|
| `shared/sim/Constants.ts` | `SIM_HZ = 60`, `SIM_DT = 1/60` |
| `shared/sim/Rng.ts` | `Rng` (sfc32): `float/range/int/chance/sign/normal/pick/weightedIndex/shuffle`, `fork(name, id)`, `getState/fromState`; `shotRng(matchSeed, entityId, shotIndex)`; `mix32`, `hashString` |
| `shared/sim/MathUtil.ts` | `Vec3`, `clamp`, `lerp`, `wrapAngle`, `lerpAngle`, `lookDirection(yaw, pitch)` |
| `shared/sim/InputFrame.ts` | `InputFrame {moveX, moveZ, yaw, pitch, buttons}`, `Button` bitmask (18 buttons), `wasPressed/wasReleased`, `sanitizeInput`, `MAX_PITCH` |
| `shared/sim/Events.ts` | `SimEventMap`, `SimEvent` union (every event carries `type` + `tick`), `EventQueue.push/drain` |
| `shared/sim/Hash.ts` | `StateHasher` (FNV-1a over exact float bits), `hashToHex` |
| `shared/sim/FixedStep.ts` | `FixedStepper(dt, maxSteps)`: `advance(frameSeconds) -> steps`, `alpha`, `droppedSeconds` |
| `shared/sim/Simulation.ts` | `Simulation<Snapshot>` interface: `tick`, `step(input)`, `drainEvents()`, `hash()`, `snapshot()`, `restore()`, `dispose()` |
| `shared/sim/SandboxSim.ts` | Engine test world: seeded static blocks + 120 dynamic crates + free-fly probe; Fire = radial kick, Reload = respawn crates |
| `shared/sim/Determinism.ts` | `makeInputScript(seed, ticks)`, `runAndHash`, `firstDivergence`, `checkDeterminism(create, seed, ticks)` |
| `shared/physics/PhysicsWorld.ts` | `initPhysics()`, `PhysicsWorld`: `step`, `addStaticBox`, `addDynamicBox`, `raycast`, `takeSnapshot/restoreSnapshot`, `dispose`; exposes `world` (Rapier) |
| `shared/rules/RulesConfig.ts` | `RulesConfig` flags, `defaultRules()`, `fastRules()`, `validateRules()`, `MODE_TEAM_SIZE` |
| `shared/rules/UrlFlags.ts` | `parseUrlFlags(query)`, `rulesFromFlags(flags)` (pure string parsing) |
| `shared/rules/Strings.ts`, `shared/data/names.ts` | All labels (R2) |

### Client
| File | What it provides |
|---|---|
| `core/RendererFactory.ts` | `createRenderer({canvas, forceWebGL, antialias})` -> `{renderer, backend, watchDeviceLoss}`; `await renderer.init()`; ACES tone mapping, sRGB output |
| `core/GameLoop.ts` | `renderer.setAnimationLoop` + three `Timer` + `FixedStepper`; callbacks `step()` and `render(alpha, frameSeconds)`; rolling `stats` |
| `core/Input.ts` | `InputState` (DOM-free: bindings, look angles, tap latching, `sample()`), `Input` (keyboard, mouse, pointer lock, debug keys) |
| `core/EventBus.ts` | Typed `on/off/emit` hub; the engine forwards every `SimEvent` on channel `sim` |
| `core/Settings.ts` | `SettingsStore` over injected storage, `migrateSettings` (versioned), key `driftglass.settings` |
| `core/Quality.ts` | Presets low/medium/high/ultra (`renderScale`, `maxPixelRatio`, `antialias`), `resolveQuality`, `effectivePixelRatio` |
| `core/DebugOverlay.ts` | F3 overlay; line providers, text rebuilt 4x per second |
| `core/ErrorPanel.ts` | Loud on-screen errors; global `error` / `unhandledrejection` handlers |
| `core/Engine.ts` | Wires renderer, loop, input, sim, view, HUD, overlay; `debugHandle()` |
| `render/SandboxView.ts` | TSL grid ground, instanced blocks and crates (interpolated), kick markers |
| `ui/StartScreen.ts`, `ui/SandboxHud.ts` | Title screen with start button and fan notice; sandbox crosshair, hints, toasts |
| `main.ts` | Flags, settings, error panel, lazy engine import, device-loss recovery |

### Tools
| Script | Purpose |
|---|---|
| `npm run sim:determinism -- --seed N --ticks N --runs N` | Headless determinism harness (rerun + snapshot/restore) |
| `npm run smoke -- --flags "renderer=webgl&seed=7" [--shot file.png] [--webgpu]` | Serves `dist/`, drives headless Chromium through the sandbox, checks ticks, input, events, overlay, errors |
| `npm run lint:markers` | R4 unfinished-work marker check |

## Data flow (target design)
```
Input (DOM) ──► InputFrame{tick, buttons, look, move} ──► shared Sim.step(dt=1/60)
                                                           │  (PlayerSim, WeaponSim, Combat, Loot, Storm, Match, Team, AI)
                                                           ▼
                                                 SimState + SimEvent[]
                     ┌──────────────────────────────────────┴────────────────────────┐
           client render (interpolated between ticks)                     server (Colyseus MatchRoom)
           HUD store ◄─ events; audio/vfx ◄─ events                       schema + StateView interest
```
- Offline: the client runs `Sim` locally with bots.
- Online: the server runs the same `Sim`. The client predicts its own player with the same code and reconciles. Remote players are interpolated. Hits are validated server-side with rewound analytic hitboxes.
- Determinism: `Rng` (sfc32) with named forks (`world`, `loot`, `storm`, `bus`, `ai:<id>`, `shot`). Forks derive from the parent's **seed** and the name, not its current state, so the order in which systems draw numbers does not matter. Per-shot seed = `matchSeed ^ entityId ^ shotIndex` (ids pre-mixed).

### Frame anatomy (M1, implemented)
```
setAnimationLoop(time)
  Timer.update -> frameSeconds
  FixedStepper.advance -> n steps (max 5; extra time is dropped and counted)
  n x { Input.sample() -> InputFrame ; sim.step(frame) ; drainEvents -> bus "sim" }
  view.update(alpha) -> lerp/slerp between previous and current tick
  renderer.render ; overlay.update
```
The sim keeps the previous tick's transforms next to the current ones, so rendering never reads half-updated state and needs no copies.

### Conventions
- Yaw 0 faces -Z, positive yaw turns left; positive pitch looks up; pitch is limited to +/-89 degrees.
- `moveX` +1 = right, `moveZ` +1 = forward. Diagonals are normalized.
- Edge detection (pressed/released) happens in the sim from the previous frame's `buttons`; inputs only carry held state. A key tapped entirely between two samples is latched for one frame so low frame rates do not lose taps.

### Determinism findings (M1)
- Rapier 0.21 is bit-reproducible run to run in this setup, and `takeSnapshot` / `restoreSnapshot` resumes bit-identically (verified by `checkDeterminism` on several seeds). Body handles stay valid across a restore. This is what M13 prediction will rely on.
- `Math.sin/cos` are used for view directions. They are deterministic within one JS engine but not guaranteed identical across engines, so client and server may differ in the last bits. The server is authoritative and prediction reconciles; `Rng.normal()` avoids transcendentals for that reason.

## Purity enforcement (R6)
1. `tsconfig.shared.json` compiles only `src/shared` with `lib: ["ES2022"]` and `types: []`, so DOM and Node globals are type errors (`npm run typecheck:shared`).
2. `tests/m0.scaffold.test.ts` scans `src/shared` for `Math.random(`, `Date.now(`, `performance.now(`, `window.`, `document.`, and `three` / `node:` imports.

## Library APIs verified in M0 (installed sources, R5)
- three 0.187.0: `three/webgpu` exports `WebGPURenderer` and `RenderPipeline`. `PostProcessing` is still exported as a legacy alias; **use `RenderPipeline`**. `Timer` is in core. `Clock` warns as deprecated since r183. `CSMShadowNode` lives at `three/examples/jsm/csm/CSMShadowNode.js`.
- Rapier 0.21.0: `world.createCharacterController(offset)` returns a controller with `computeColliderMovement`, `enableAutostep(maxHeight, minWidth, includeDynamic)`, `enableSnapToGround(dist)`, `setMaxSlopeClimbAngle(rad)`.
- three 0.187.0 (M1): `new WebGPURenderer({ forceWebGL })` selects the WebGL2 backend; `renderer.backend.isWebGPUBackend` tells which one initialized; `renderer.info.render.drawCalls/triangles`; `renderer.onDeviceLost(info)` exists, but the WebGPU backend skips losses with reason `"destroyed"`.
- three TSL (M1): `positionWorld`, `cameraPosition`, `fract`, `fwidth`, `abs`, `min`, `mix`, `smoothstep`, `length`, `color`, `float` from `three/tsl`; `MeshStandardNodeMaterial.colorNode`. Works on both backends.
- Rapier 0.21.0 (M1): `RAPIER.init()`, `World.takeSnapshot()`, `World.restoreSnapshot()`, `world.castRayAndGetNormal(ray, maxToi, solid)` -> `{timeOfImpact, normal, collider}`, `body.applyImpulse`, `body.isSleeping()`.
- @colyseus/core 0.18.23: `Room.defineInput(InputSchema, opts?)`, `Room.setFixedTimestep(cb, { subSteps })` with a per-step context, `Room.allowRewindState({ maxRewindMs })` returning `Rewind` (`lastSeenBy`, render-time resolution). Client-side `Predict` is to be verified in `@colyseus/sdk` during M13.

## Deviations from the brief
| Brief | Actual | Why |
|---|---|---|
| Fetch the reference links | All failed (DNS blocked by the session network policy) | Notes use `[SPEC]` and `[BG]` values with provenance tags; see docs/REFERENCES.md |
| `UI_REFERENCE_NOTES.md` | Not created | There is no `reference/` folder (the brief makes it conditional) |
| Placeholder grep in R4 | Wrapped as `npm run lint:markers` (`tools/check-markers.mjs`) | Same patterns; the script builds them from fragments so it does not match itself |
| — | `.npmrc legacy-peer-deps=true` | npm 10.9.9 crashes (`edgesOut` null) resolving vitest 5's optional peers |
| "Automatic WebGL2 fallback" | Also covers runtime loss: if the WebGPU device is lost, the page reloads itself with `?renderer=webgl&seed=<same>` and restarts | A lost device otherwise leaves a blank canvas. `RendererFactory` watches `device.lost` directly because three ignores reason `"destroyed"` |
| Verify both renderers | WebGL2 verified by screenshot. WebGPU verified up to init + pipeline creation only | The container's headless Chromium cannot create a WebGPU swap-chain image and drops the device at first present. Needs a check on a real GPU |
| F4/F5/F8-F11 debug keys | Only F3 is bound in M1 | Each key is added with the tool it opens, so no key is dead |
| — | The engine sandbox is the default scene | M1 has no player yet; the sandbox exercises the full input -> sim -> render path and stays as an engine test scene |
| — | Engine code is lazy-loaded (`import("./core/Engine")`) and split into `three` / `rapier` chunks | Rapier's inlined WASM is about 4.3 MB; the title screen should not wait for it |
| — | TypeScript 7.0.2 | Stable native compiler; the config avoids options removed in 7.x (no `baseUrl`, no `node10` resolution) |

## Tuned values
| Value | Where | Default |
|---|---|---|
| Sim rate | `Constants.ts` | 60 Hz |
| Max sim steps per frame | `GameLoop.ts` | 5 (then time is dropped) |
| Gravity | `PhysicsWorld.ts` `DEFAULT_GRAVITY` | 25 m/s^2 |
| Mouse look | `Input.ts` `LOOK_RADIANS_PER_PIXEL` | 0.0022 rad/px at sensitivity 1 |
| FOV | `Settings.ts` | 80 degrees (60-110) |
| Quality presets | `Quality.ts` | low 0.6x, medium 0.8x, high 1.0x (ratio cap 1.5), ultra 1.0x (cap 2) |
| Overlay refresh | `DebugOverlay.ts` | 0.25 s |
| Sandbox | `SandboxSim.ts` `SANDBOX_DEFAULTS` | 120 crates, 14 blocks, probe 10 / 30 m/s, kick radius 5 m |

Gameplay defaults are in docs/MECHANICS_NOTES.md and become config modules from M2.

## Events
Implemented (`shared/sim/Events.ts`):
| Event | Payload | Emitted when |
|---|---|---|
| `sandboxKick` | `x, y, z, bodies` | Fire pressed in the sandbox |
| `sandboxRespawn` | `generation, crates` | Reload pressed in the sandbox |

The planned gameplay contract is in docs/GAME_SPEC.md §12; payloads are added to `SimEventMap` as each milestone implements them.

## Debug handle
`window.__DRIFTGLASS__` (set once the engine runs): `backend`, `seed`, `tick()`, `hash()`, `fps()`, `drawCalls()`, `simEvents()`. Read-only; used by `tools/smoke.mjs`.
