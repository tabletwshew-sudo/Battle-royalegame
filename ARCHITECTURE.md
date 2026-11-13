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

## Modules present (after M3)

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
| `shared/sim/PlayerSim.ts` | `PlayerController`: one character on Rapier's `KinematicCharacterController`, a `MoveMode` state machine (walk, slide, mantle, hurdle, roll, skydive, glide, splat); `PlayerState` (plain data incl. stamina, held slot, traversal path, vitals, kick cooldowns); `step(input, tick, events)`, `teleport`, `startSkydive`, `applyKnockback`, `takeDamage`, `resetVitals`, `canUseItem`, `canRedeployNow`, `applyConfigChanges`, `hashInto` (hashes every state field), `saveState/loadState` (deep copies); `MovementWorld` = physics + rules + vitals config + doors + launch pads |
| `shared/sim/LedgeProbe.ts` | `probeTraversal(physics, config, feet, dir, {airborne, speed, exclude})` -> `TraversalPlan` (mantle or hurdle, end point, top, faces, crouched end) or null |
| `shared/sim/SlideKick.ts` | `resolveSlideKicks(characters, sameTeam, tick, events)`: damage + knockback + per-target cooldown |
| `shared/sim/SelfTest.ts` | 29 scripted movement cases on the playground (`selfTestNames`, `runSelfTest(i)`, `runAllSelfTests`), run by vitest AND the F9 panel |
| `shared/combat/Vitals.ts` | `Vitals` (health / shield / overshield), `applyDamage` (layered with overflow), `applyHealthDamage` (falls, storm), `tickVitals` (overshield regen 5 s / 10 per s) |
| `shared/world/Doors.ts` | `DoorSystem`: kinematic hinged doors; `operate(index, actorX, actorZ, bash)` swings away from the actor; `nearestDoor`, `doorOfCollider`, `step`, snapshot helpers |
| `shared/sim/CameraRig.ts` | `CameraConfig`, `computeCameraPose(subject, config, physics, exclude, out)`: shoulder offset, ADS blend, two sphere sweeps for collision. Shared because aiming traces from the camera |
| `shared/world/Playground.ts` | `buildPlayground(seed)`: movement course (ramps 20/35/48/55 deg, step flights 0.3/0.45/0.6 m, ledges, crouch tunnel, camera walls, platform, 25 m mesa with a 50 m 30 deg slide ramp, mantle walls 0.5-2.7 m, fences 0.9/1.1/1.4 m, launch pad, hut with 2 doors) + seeded scenery; `playgroundDoors()`, `playgroundLaunchPads()`, `PLAYGROUND`, `CRATE_AREA`, `findBlock` |
| `shared/sim/SandboxSim.ts` | The playground + 80 crates + the player + a training dummy + doors; slide kicks resolved after movement; Fire = kick at the camera-aimed point (only when `canUseItem`), Reload = respawn crates |
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
| `player/CharacterAnimator.ts` | Pose per mode (locomotion incl. sprint, slide, mantle, hurdle, roll, skydive, glide, splat) blended by eased per-mode weights; the roll snaps (it is a full flip) |
| `player/Gear.ts` | Procedural glider (delta canopy, keel, struts, bar) and pickaxe, one merged vertex-coloured mesh each |
| `player/PlayerView.ts` | `interpolatePlayer(prev, curr, alpha, config)` (adds mode, progress, sprint, bank, slot), `PlayerView` (rig + animator + glider + pickaxe in hand / on back), camera-proximity fade |
| `player/ThirdPersonCamera.ts` | Client camera over `computeCameraPose`: arm snaps in / eases out (7 m/s), landing-dip spring, ADS FOV, sprint FOV kick and slide roll (eased) |
| `render/DoorView.ts`, `render/ProbeView.ts` | Door panels on hinge pivots; F4 ledge-probe line + target marker |
| `ui/StartScreen.ts`, `ui/MovementHud.ts` | Title screen; playground HUD (vitals stack with energy bar, slot, mode/altitude, prompts, splat banner, toasts), DOM writes only on change |
| `ui/SelfTestPanel.ts`, `core/TuningPanel.ts` | F9 self-test runner (one case per task); F4 lil-gui live tuning of MovementConfig / CameraConfig + sprint mode |
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

### Movement modes (M3)
```
walk ──Crouch press at >= 5.5 m/s──> slide ──Jump──> walk (air, x1.15, boosted lift if downhill)
  │                                    ├─Sprint──> walk + sprint (momentum kept: overspeed decel 9 m/s^2)
  │                                    └─speed < 3 / ground lost──> walk
  ├─Jump near a 0.5-2.3 m ledge (moving into it) ──> mantle ──> walk (+0.35 s item raise, 0.15 s input lock)
  ├─Jump at a <= 1.1 m obstacle with ground behind, running ──> hurdle (keeps speed) ──> walk
  ├─airborne, moving into a ledge 0.25-1.1 m above the feet ──> mantle (no fall damage)
  ├─airborne, fell > 6 m at > 12 m/s, Jump ──> glide (redeploy)
  ├─launch pad ──> walk (up at 95 m/s) ──apex──> skydive ──Jump or 120 m AGL──> glide ──Jump (cut)──> walk
  │                                                                              └─2 m AGL──> walk (soft landing)
  └─landing: Jump within 0.2 s before a damaging impact ──> roll (half damage, +10 stamina)
             would-be lethal + nonLethalFalls ──> splat (1 HP, shields 0, 1.5 s)
             would-be lethal + classic ──> eliminated
```
Sprint is part of `walk`: allowed on the ground with forward input, not crouched, not aiming, stamina >= 15 to start (> 0 to continue), drains 10/s, regen 14/s after 0.8 s, 0.5 s lockout at empty; Pickaxe + rule = no drain. The held item is "holstered" while sprinting / traversing / skydiving / gliding / rolling / splatting and needs `sprintRaiseTime` after.

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

### Movement findings (M3, measured)
- Moving along the ground plane (the M2 slope fix) means Rapier usually reports NO ground contact, so the ground normal is now sampled with a short downward ray whenever no walkable contact was reported. Without it slides never saw the slope.
- The ledge probe's top ray must start just past the wall face (0.08 m): at 0.2 m it fell off the far side of 0.2 m fences.
- The probe reach grows with speed (0.06 s of travel) so a sprint does not cross the trigger range between two ticks.
- Feet can sit ~1 cm below the floor (controller skin), so ledge heights get a 0.05 m tolerance (2.3 m walls measured 2.314 m).
- Mid-air A/D turning that adds to the look-follow turn cancels out at steady state; A/D now offset the glider's target heading instead.

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
| Slide speed "equals run speed on flat" | Slides start at max(current speed, 6 m/s) and decay at 4 m/s^2 | Sliding from a sprint keeps the sprint speed; a slide is never a speed loss at entry |
| Launch pads deploy the glider | Launch pad -> skydive at the apex -> glider at 120 m AGL | Exercises the full skydive -> glider flow without the Battle Bus (M8) |
| Fall damage | Health only (bypasses shields), roll halves it | [BG] reference behaviour; the spec only gives the formula |
| Overshield | Implemented in M3 (Vitals) instead of M5 | Fall damage and slide kicks needed the layers; M5 adds weapons on top |
| Mantle "input lock 0.15 s" | Jump/crouch/sprint presses ignored for 0.15 s after a mantle (the mantle itself cannot be cancelled) | Prevents an accidental jump right after climbing |
| Glider steering | Heading follows the look yaw at 60 deg/s; A/D offset it by up to 35 deg and turn 50% faster; bank is visual | "Banking turns" without fighting the camera |
| — | Interact (E) opens / closes the nearest door | Doors otherwise could only be bashed open |
| Classic lethal fall in the sandbox | Emits `eliminated` and respawns the player | No match flow until M8 |
| F-keys | F3 stats, F4 probes + tuning, F9 self-test are bound; F5/F8/F10/F11 arrive with their tools | No dead keys |
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
| Movement | `MovementConfig.ts` | run 6, crouch 3, ADS 3.5 m/s; ground accel 70 / decel 55, overspeed decel 9, air accel 10 m/s^2; gravity 25; jump 1.2 m (v0 = 7.957 m/s at 60 Hz); terminal 55 m/s; coyote 0.10 s; buffer 0.12 s; capsule r 0.35, h 1.8 / 1.1; autostep 0.45 m (min width 0.2); max slope 50 deg; snap 0.35 m; skin 0.02 m; ADS 0.2 s; shoulder swap 0.18 s; body turn 720 deg/s, idle turn after 70 deg; pitch limit 80 deg; kill plane y -50; push mass 80 kg |
| Sprint | `MovementConfig.ts` | 8.5 m/s; stamina 100, drain 10/s, regen 14/s after 0.8 s, start >= 15, empty lockout 0.5 s; forward input >= 0.3; sprint jump x1.15 height + 1.5 m/s forward; item raise 0.25 s |
| Slide | `MovementConfig.ts` | entry >= 5.5 m/s, start >= 6 m/s; flat decel 4; uphill decel 4 + 1.6 x g x sin; downhill +g x sin x 1.0; cap 20; ends < 3 m/s; steer 70 deg/s; slide jump x1.15; boosted lift up to +3 m/s; kick 15 dmg, 6 m/s push (+4 up), 10 s per target, 0.85 m reach, >= 5 m/s |
| Mantle / hurdle | `MovementConfig.ts` | mantle 0.5-2.3 m (air reach 0.25-1.1 m above feet), probe reach 0.95 m + 0.06 s x speed, 0.3-0.75 s by height, input lock 0.15 s, item raise 0.35 s; hurdle <= 1.1 m, <= 1.0 m deep, keeps >= 5.5 m/s; door bash reach 0.6 m |
| Landing | `MovementConfig.ts` | damage (v - 14) x 3.2 (max 100), roll window 0.2 s, roll x0.5 damage + 10 stamina, roll 0.45 s, splat 1.5 s |
| Skydive / glider | `MovementConfig.ts` | skydive 55 m/s (dive 75), steer 18 m/s; glider at 120 m AGL, 22 m/s / 7 sink, W +4 / +3, S -6 / -2, turn 60 deg/s, A/D offset 35 deg, closes at 2 m AGL; redeploy after > 6 m at > 12 m/s, 1 s cooldown; launch pad 95 m/s (apex ~180 m) |
| Vitals | `Vitals.ts` | health 100, shield 0 (max 100), overshield 50, regen after 5 s at 10/s |
| Camera | `CameraRig.ts` | hip: side 0.55, height 1.6 (crouch 1.08), distance 3.2; ADS: side 0.75, height 1.58, distance 1.9, FOV x0.75; probe radius 0.2; min arm 0.3; skydive +3.2 m arm / +0.9 m height; glide +2.4 / +1.3; sprint FOV x1.08 |
| Camera presentation | `ThirdPersonCamera.ts`, `PlayerView.ts` | arm return 7 m/s; landing dip spring k 90 (critically damped), kick (speed - 4) x 0.12; model fade 0.85-1.05 m |

Gameplay defaults are in docs/MECHANICS_NOTES.md and become config modules from M2.

## Events
Implemented (`shared/sim/Events.ts`):
| Event | Payload | Emitted when |
|---|---|---|
| `sandboxKick` | `x, y, z, bodies` | Fire pressed in the sandbox |
| `sandboxRespawn` | `generation, crates` | Reload pressed in the sandbox |
| `jump` | `id, x, y, z, sprint, slide, boosted` | A character jumped (take-off point; sprint / slide jump; boosted downhill jump) |
| `land` | `id, speed, x, y, z, damage, roll, splat` | Touch-down: impact speed (m/s), fall damage taken, roll landing, modern splat |
| `respawn` | `id, x, y, z, reason` | Put back at spawn (`killPlane` or `eliminated` in the sandbox) |
| `eliminated` | `id, cause, by` | Health reached 0 (`fall` or `slideKick`) |
| `sprintStart` / `sprintEnd` / `staminaEmpty` | `id` | Sprint state changes |
| `slideStart` / `slideEnd` | `id, speed` | Slide begins / ends |
| `traverse` | `id, kind, height, airborne` | A mantle or hurdle started |
| `door` | `door, by, action` | Door bashed / opened / closed |
| `launch` | `id, x, y, z` | Launch pad fired |
| `skydiveStart` | `id` | Skydive began |
| `gliderOpen` / `gliderClose` | `id, redeploy` / `id, cut` | Glider opened (redeploy = mid-fall) / closed (cut = by the player) |
| `slideKick` | `attacker, target, damage` | Slide kick landed |
| `equip` | `id, slot` | Held slot changed (0 = Pickaxe) |

The planned gameplay contract is in docs/GAME_SPEC.md §12; payloads are added to `SimEventMap` as each milestone implements them.

## Debug handle
`window.__DRIFTGLASS__` (set once the engine runs): `backend`, `seed`, `tick()`, `hash()`, `fps()`, `drawCalls()`, `simEvents()`, `player()` (position, look, speed, mode, stamina, sprint, vitals, slot), `cameraArm()`, `selfTest()` (last F9 result), and three controls: `look(yaw, pitch)` (headless browsers cannot generate pointer-lock mouse movement), `teleport(x, y, z)` and `skydive(height)` for visual checks. Used by `tools/smoke.mjs`.
