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

## Modules present (after M2)

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
| `shared/sim/MovementConfig.ts` | `MovementConfig` tunables + `defaultMovementConfig()`, `jumpVelocity(config, dt)` (integrator-corrected), `capsuleHalfHeight` |
| `shared/sim/PlayerSim.ts` | `PlayerController`: one character on Rapier's `KinematicCharacterController`; `PlayerState` (plain data); `step(input, tick, events)`, `teleport`, `hashInto`, `saveState/loadState`, `horizontalSpeed` |
| `shared/sim/CameraRig.ts` | `CameraConfig`, `computeCameraPose(subject, config, physics, exclude, out)`: shoulder offset, ADS blend, two sphere sweeps for collision. Shared because aiming traces from the camera |
| `shared/world/Playground.ts` | `buildPlayground(seed)`: movement course (ramps 20/35/48/55 deg, step flights 0.3/0.45/0.6 m, ledges, crouch tunnel, camera walls, platform) + seeded scenery; `PLAYGROUND`, `CRATE_AREA`, `findBlock` |
| `shared/sim/SandboxSim.ts` | The playground + 80 crates + one `PlayerController`; Fire = kick at the camera-aimed point, Reload = respawn crates |
| `shared/sim/Determinism.ts` | `makeInputScript(seed, ticks)`, `runAndHash`, `firstDivergence`, `checkDeterminism(create, seed, ticks)` |
| `shared/physics/PhysicsWorld.ts` | `initPhysics()`, `PhysicsWorld`: `step`, `addStaticBox(center, half, opts, rotation)`, `addDynamicBox`, `addCharacterCapsule`, `createCharacterController`, `raycast`, `sphereCast`, `capsuleOverlaps`, `takeSnapshot/restoreSnapshot`; collision `Layer`s (World/Character/Prop) and query groups `QUERY_WORLD_ONLY`, `QUERY_WORLD_AND_PROPS`; `axisQuat` |
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
| `render/SandboxView.ts` | TSL grid ground, all playground blocks in one instanced draw (colour per kind), instanced crates (interpolated), kick markers |
| `player/CharacterRig.ts` | Procedural low-poly humanoid: 18 bones, 24 primitive parts merged into ONE `SkinnedMesh` (rigid one-bone skinning, vertex colours, flat shading) = 1 draw call; `setOpacity` |
| `player/CharacterAnimator.ts` | Procedural animation: stride-locked walk/run with forward/back/strafe blend, crouch, air tuck, ADS arms, look pitch/twist, landing squash |
| `player/PlayerView.ts` | `interpolatePlayer(prev, curr, alpha)`, `PlayerView` (rig + animator), camera-proximity fade |
| `player/ThirdPersonCamera.ts` | Client camera over `computeCameraPose`: arm snaps in / eases out (7 m/s), landing-dip spring, ADS FOV |
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

### Player tick (M2)
```
look (yaw, clamped pitch) -> shoulder swap / ADS blend -> crouch (stand-up needs a capsule overlap test)
-> wish velocity from moveX/moveZ relative to yaw -> ground accel/decel or air steering (no air braking)
-> jump (buffer 0.12 s, coyote 0.10 s) -> gravity -> move():
     grounded: lay the step onto the ground plane (keeps surface speed on slopes)
     Rapier computeColliderMovement (autostep, snap-to-ground only when walking, max slope 50 deg)
     contacts: walkable -> ground normal; ceiling -> vy = 0;
               wall / too steep -> cancel the horizontal velocity into it, only if the move was blocked
               and the contact is above step height (autostep needs the full per-tick move)
-> body yaw follows the look while moving / aiming / turning in place -> kill plane respawn
```
The player is moved BEFORE `PhysicsWorld.step()` of the same tick; the capsule is a parentless collider moved with `setTranslation`.

### Conventions
- Yaw 0 faces -Z, positive yaw turns left; positive pitch looks up; pitch is limited to +/-89 degrees.
- `moveX` +1 = right, `moveZ` +1 = forward. Diagonals are normalized.
- Edge detection (pressed/released) happens in the sim from the previous frame's `buttons`; inputs only carry held state. A key tapped entirely between two samples is latched for one frame so low frame rates do not lose taps.

### Movement findings (M2, measured)
- Rapier projects a move onto a slope it climbs, so the horizontal part shrinks by about cos^2(slope). Feeding that back into the stored velocity compounded the loss each tick (35 deg ramps stalled). Fix: pre-project onto the ground plane and only cancel velocity against real obstructions.
- Rapier autostep fails when the per-tick move is small (about < 0.05 m), so zeroing velocity at a step face stalls it for good. Contacts below step height are therefore not cancelled.
- Rapier measures autostep height from the capsule bottom, which floats `controllerOffset` above the floor; the controller gets `autostepHeight + offset + 0.03` so 0.45 m steps climb and 0.6 m do not.
- The semi-implicit integrator undershoots `sqrt(2gh)` jumps by about v*dt/2 (1.14 m instead of 1.2 m); `jumpVelocity` corrects for it exactly.
- `CharacterCollision.normal1` points from the obstacle toward the character.
- Headless Chromium reports pointer-lock mouse movement as cancelling +/- jumps; mouse look cannot be driven headlessly, so the debug handle has `look(yaw, pitch)`.

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
- Rapier 0.21.0 (M2): `world.createCharacterController(offset)`; controller `setUp`, `enableAutostep(maxHeight, minWidth, includeDynamic)`, `setMaxSlopeClimbAngle`, `setMinSlopeSlideAngle`, `enableSnapToGround/disableSnapToGround`, `setSlideEnabled`, `setApplyImpulsesToDynamicBodies`, `setCharacterMass`, `computeColliderMovement(collider, delta)`, `computedMovement()`, `computedGrounded()`, `numComputedCollisions()`, `computedCollision(i, out)`; collider `setHalfHeight`, `setTranslation`, `setCollisionGroups`; `world.castShape(pos, rot, vel, shape, targetDistance, maxToi, stopAtPenetration, flags, groups, excludeCollider)` -> `time_of_impact`; `world.intersectionWithShape`. Interaction groups = `(memberships << 16) | filter`.
- three 0.187.0 (M2): `SkinnedMesh` + `Skeleton` + `Bone` with `MeshStandardNodeMaterial({ vertexColors, flatShading })` render on both backends; `mergeGeometries` from `three/examples/jsm/utils/BufferGeometryUtils.js`; `CapsuleGeometry(radius, height, capSegments, radialSegments)`.
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
| — | The movement playground (sandbox) is the default scene | No island until M4; the playground is a deterministic test course and stays as a test scene |
| Camera offset (0.55, 1.6, -3.2) | Used as given for hip fire; ADS defaults to offset 0.75 / height 1.58 / distance 1.9 / FOV x0.75 | The spec gives no ADS numbers; these keep the crosshair clear of the character. Weapons can override them from M5 |
| — | The camera ignores props and characters (world geometry only) | Small crates and other players would make the camera jitter; shots still trace against everything |
| — | The model fades out when the camera is within 0.85-1.05 m of the head | Wall right behind the player would otherwise put the view inside the character |
| — | Mouse deltas over 400 px in one event are ignored | Browser spike right after pointer lock |
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
| Sandbox | `SandboxSim.ts` `SANDBOX_DEFAULTS` | 80 crates, kick radius 4 m |
| Movement | `MovementConfig.ts` | run 6, crouch 3, ADS 3.5 m/s; ground accel 70 / decel 55, air accel 10 m/s^2; gravity 25; jump 1.2 m (v0 = 7.957 m/s at 60 Hz); terminal 55 m/s; coyote 0.10 s; buffer 0.12 s; capsule r 0.35, h 1.8 / 1.1; autostep 0.45 m (min width 0.2); max slope 50 deg; snap 0.35 m; skin 0.02 m; ADS 0.2 s; shoulder swap 0.18 s; body turn 720 deg/s, idle turn after 70 deg; pitch limit 80 deg; kill plane y -50; push mass 80 kg |
| Camera | `CameraRig.ts` | hip: side 0.55, height 1.6 (crouch 1.08), distance 3.2; ADS: side 0.75, height 1.58, distance 1.9, FOV x0.75; probe radius 0.2; min arm 0.3 |
| Camera presentation | `ThirdPersonCamera.ts`, `PlayerView.ts` | arm return 7 m/s; landing dip spring k 90 (critically damped), kick (speed - 4) x 0.12; model fade 0.85-1.05 m |

Gameplay defaults are in docs/MECHANICS_NOTES.md and become config modules from M2.

## Events
Implemented (`shared/sim/Events.ts`):
| Event | Payload | Emitted when |
|---|---|---|
| `sandboxKick` | `x, y, z, bodies` | Fire pressed in the sandbox |
| `sandboxRespawn` | `generation, crates` | Reload pressed in the sandbox |
| `jump` | `id, x, y, z` | A character jumped (take-off point) |
| `land` | `id, speed, x, y, z` | A character touched down; `speed` = downward impact speed (m/s) |
| `respawn` | `id, x, y, z` | A character fell below the kill plane and was put back at its spawn |

The planned gameplay contract is in docs/GAME_SPEC.md §12; payloads are added to `SimEventMap` as each milestone implements them.

## Debug handle
`window.__DRIFTGLASS__` (set once the engine runs): `backend`, `seed`, `tick()`, `hash()`, `fps()`, `drawCalls()`, `simEvents()`, `player()` (position, look, speed, flags), `cameraArm()`, and one control, `look(yaw, pitch)`, because headless browsers cannot generate pointer-lock mouse movement. Used by `tools/smoke.mjs`.
