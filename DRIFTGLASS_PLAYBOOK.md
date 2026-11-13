# DRIFTGLASS — Zero Build Battle Royale: Claude Code Prompt Playbook (v2, detailed)

A browser-based, high-graphics, Zero Build battle royale. Vite + TypeScript + Three.js (`WebGPURenderer` → automatic WebGL2 fallback) + Rapier3D (WASM) + Colyseus 0.18 (authoritative multiplayer).

Working title **Driftglass** · original island **Driftglass Atoll** · all names, characters, weapons and the map are original (see IP rules).

---

## 0. READ THIS FIRST

### 0.1 Three things the research changed (vs. your outline)

1. **Fable on the Pro plan is not covered by your plan allowance.** As of the sources checked (Oct–Nov 2026), Pro can use Fable models in Claude Code only through **pay-per-use usage credits** billed at API rates (Fable 5 was reported at about $10 / $50 per million input / output tokens; verify Fable 5.2 pricing in `/usage-credits` before you commit). If you have no credits enabled, Fable requests are declined, not silently billed. **Decision for you:**
   - *Path A (spend credits):* run Phases 1 and 8 on Fable 5.2 exactly as your outline says.
   - *Path B (no credits, recommended default):* run Phases 1 and 8 on **Opus 5.5 at High effort**. Every prompt below is written so Opus can execute it. Phase 1 is milestone-based so it survives a 5-hour window cut.
   Each phase below shows both commands.
2. **Three.js API names moved.** `PostProcessing` was renamed `RenderPipeline` in r183; the WebGL `EffectComposer` does not work with `WebGPURenderer`; shadows on WebGPU use `CSMShadowNode` (not the old `CSM`); `Clock` is deprecated for `Timer`; import from `three/webgpu` and `three/tsl`; use `renderer.setAnimationLoop` and `await renderer.init()`. Every prompt tells Claude Code to **read the installed package's types and examples instead of trusting memory**, and to pin the version.
3. **Colyseus 0.18 has built-in prediction + lag compensation** (`room.input()`, `Predict.reconciler` / `predict.sim`, `setFixedTimestep`, `allowRewindState`). Phase 8 uses those instead of hand-rolled netcode. That only works if the movement/combat simulation is **pure shared code from Phase 1**, so Phase 1 enforces a strict `src/shared/` (sim) vs. client (render) split. This is the single most important architectural decision in the playbook.

### 0.2 Deliberate deviations from your outline (so nothing surprises you)

| Your outline | What the playbook does | Why |
|---|---|---|
| "Victory Royale" screen | Screen says **"LAST ONE STANDING"** (one string in `src/shared/rules/Strings.ts`) | "Victory Royale" is Epic's trademarked phrase; your own IP-safety rule covers it. Change the string yourself if you accept the risk. |
| Phases are single prompts | Some phases have a **Part A (Opus)** and **Part B (Sonnet)** prompt | Your routing rules put audio, HUD, and JSON tuning on Sonnet; Phases 4 and 5 mix both kinds of work. |
| Healing item names | Original names: Patch Wrap, Field Kit, Spark Cell, Bulwark Cell | IP safety. Mechanics are identical (cast times, caps). |

### 0.3 One-time setup before Phase 1

1. Make an empty folder `driftglass/`, `cd` into it, run `git init`, then start `claude`.
2. Confirm Node 20+ and that `npm install` works on your machine.
3. Check what you can run: `/model` (picker), `/usage`, `/effort`. If you want Path A, run `/usage-credits` and enable credits with a monthly spend cap.
4. Browser for testing: current Chrome/Edge (WebGPU on by default). Firefox/Safari work via the WebGL2 fallback or WebGPU where supported. Test with `?renderer=webgl` to force the fallback.

### 0.4 Quota discipline (Pro, 5-hour rolling window + weekly cap)

- **`/clear` at the start of every phase.** All state lives in `CLAUDE.md`, `ARCHITECTURE.md`, `PROGRESS.md`; long conversations are the biggest quota burner, and `/compact` itself reads the whole conversation (costly). `/clear` is free.
- **Switch models only at phase boundaries, right after `/clear`.** Each model has its own prompt cache, so a mid-session switch throws away a warm cache. Claude Code warns you when a switch would; read that prompt as a price tag.
- **Set effort after switching model** (`/effort` is per model in current Claude Code): `/effort high`, `/effort medium`, `/effort low`. Avoid `max`; it burns quota for little gain on code that is mostly mechanical.
- **Every prompt is milestone-based** (M1, M2, …) and writes a checklist to `PROGRESS.md` after each milestone. If the window cuts you off, wait for reset (or switch to Sonnet for a smaller milestone) and paste the **Resume prompt** below.
- **Commit after each phase passes its checklist:** `git add -A && git commit -m "Phase N"`. The Debug/Recovery prompts assume you can `git diff` / `git stash`.
- Quota estimates below are **rough relative guesses, not measurements** (Anthropic publishes no fixed numbers). Check `/usage` after your first phase and recalibrate.

### 0.5 Universal Resume prompt (use any time a phase was interrupted)

````
Read CLAUDE.md, ARCHITECTURE.md and PROGRESS.md. Find the first unchecked milestone of the phase currently marked IN PROGRESS in PROGRESS.md. Run `npm run typecheck` and `npm test` to see the true state of the repo (do not trust the checklist alone; verify files exist and compile). Fix anything half-finished from the interrupted milestone first, then continue with the remaining milestones of that phase exactly as specified in the phase brief that PROGRESS.md links. Same rules: no placeholders, no TODOs, update ARCHITECTURE.md and PROGRESS.md after each milestone.
````

### 0.6 Quick-reference routing table

| Phase | Topic | Model (Path B → Path A) | Effort |
|---|---|---|---|
| 1 | Core engine, renderer, Rapier, camera, basic movement, **shared-sim foundation** | Opus 5.5 → Fable 5.2 | High |
| 2 | Advanced locomotion (sprint, stamina, slide, mantle, glider) | Opus 5.5 | High |
| 3 | Graphics pipeline, shaders, terrain, post-processing, particles | Opus 5.5 | Medium–High |
| 4A | Health/overshield, inventory, ballistics | Opus 5.5 | Medium–High |
| 4B | Weapon JSON tuning + balance report | Sonnet 5.5 | Low–Medium |
| 5A | Loot, chests, consumables, destructibles | Opus 5.5 | Medium–High |
| 5B | Procedural Web Audio SFX | Sonnet 5.5 | Medium |
| 6A | Match loop, bus, storm, bots | Opus 5.5 | High |
| 6B | Minimap, map overlay, kill feed, end screen | Sonnet 5.5 | Medium |
| 7 | HUD, crosshair, hitmarkers, damage numbers, settings | Sonnet 5.5 | Low–Medium |
| 8 | Colyseus server, prediction, lag comp, deploy prep | Opus 5.5 → Fable 5.2 | High |

---

## 1. Target architecture (every phase must conform)

````
driftglass/
  CLAUDE.md  ARCHITECTURE.md  PROGRESS.md
  index.html  vite.config.ts  tsconfig.json  package.json
  public/                       (no external art assets; everything is procedural)
  src/
    main.ts
    shared/                     PURE TS. No DOM, no three, no window. Runs in browser AND Node (server).
      sim/        PlayerSim.ts  InputFrame.ts  PlayerState.ts  MovementConfig.ts  LocomotionFSM.ts
                  StaminaSim.ts  SlideSim.ts  MantleSim.ts  GliderSim.ts
      physics/    PhysicsWorld.ts  Layers.ts  Heightfield.ts
      world/      Heightmap.ts  IslandSpec.ts  BiomeMap.ts  PropPlacement.ts  LootPlacement.ts
      combat/     DamageModel.ts  HealthSim.ts  WeaponSim.ts  Ballistics.ts  Hitboxes.ts  Recoil.ts  Spread.ts
      inventory/  InventorySim.ts  ItemDefs.ts
      match/      MatchSim.ts  StormModel.ts  BusPath.ts  Placement.ts
      ai/         BotBrain.ts  BotPerception.ts
      rules/      RulesConfig.ts  Strings.ts  Rng.ts  Events.ts
      data/       weapons.json  consumables.json  storm.json  loot_tables.json  island.json
    core/         Engine.ts  RendererFactory.ts  GameLoop.ts  Input.ts  EventBus.ts  DebugOverlay.ts  Quality.ts
    player/       PlayerView.ts  CharacterRig.ts  ThirdPersonCamera.ts  CameraEffects.ts  LocalPlayerController.ts
    world/        IslandView.ts  TerrainChunks.ts  FoliageView.ts  PropsView.ts  WaterView.ts  SkyView.ts
    render/       Lighting.ts  Shadows.ts  RenderPipelineFX.ts  QualityPresets.ts
    shaders/      (TSL) StylizedLit.ts  TriplanarTerrain.ts  WindFoliage.ts  SkyDome.ts  StormWall.ts  Water.ts  LootBeam.ts  Fresnel.ts
    vfx/          ParticleSystem.ts  presets/*.ts   MuzzleFlash  Tracer  ShieldBreak  StormLightning  HitSpark  Debris  Dust
    combat/       WeaponView.ts  ProjectileView.ts  HitFeedback.ts
    loot/         LootView.ts  ChestView.ts  BeamView.ts  DestructibleView.ts
    audio/        AudioEngine.ts  Synth.ts  SfxBank.ts  Ambience.ts
    match/        MatchController.ts  BusView.ts  StormView.ts  BotRunner.ts  Spectator.ts
    ui/           UIStore.ts  hud/*  menus/*  map/*  styles/*.css
    net/          NetClient.ts  RemoteAvatars.ts  PredictionBridge.ts            (Phase 8)
  server/                                                                       (Phase 8)
    package.json  tsconfig.json  Dockerfile
    src/index.ts  rooms/MatchRoom.ts  schema/*.ts  ServerSim.ts  Bots.ts
  tools/          balance-report.ts  loadtest.ts
  tests/          *.test.ts (vitest)
````

**Hard rules that make Phase 8 possible**
- Anything that changes game state (movement, damage, loot, storm, bots, match flow) lives in `src/shared/` as pure, deterministic code. Client modules only *render* it or feed it input.
- Randomness in `shared/` comes only from `rules/Rng.ts` (seeded, e.g. sfc32). `Math.random`, `Date.now`, `performance.now` are forbidden inside `shared/`.
- Fixed simulation tick: **60 Hz** (`dt = 1/60`). Rendering interpolates between the last two sim states.
- World is derived from one integer **match seed**: `Heightmap(seed)`, prop/loot placement, bus path, storm centers. Clients and server rebuild identical static worlds; only dynamic state is networked.
- Units: meters, seconds, Y-up, three.js right-handed coordinates.

**Baseline movement/combat numbers** (all tunables live in JSON/config, never hard-coded): run 6.0 m/s, crouch 3.0, sprint 8.5, gravity 25 m/s², jump apex ≈ 1.2 m, capsule radius 0.35 / height 1.8, over-the-shoulder camera offset (0.55, 1.6, −3.2).

---

## 2. IP safety (included in CLAUDE.md in Phase 1 and repeated in each prompt)

- Original characters (procedural low-poly humanoids, e.g. "Pip", "Moss", "Tally"), original weapons (see Phase 4 names), original POI names on Driftglass Atoll, original UI iconography, original text strings.
- Never use Fortnite or Epic names, skins, emotes, item names, map names, logos, music or textures. No downloaded assets: **all geometry, textures, and sound are generated procedurally in code.**
- Gameplay *mechanics* (sprint, slide, mantle, overshield, rarity tiers, storm circles) are generic genre mechanics and are fine to reproduce.

---

## 3. Research digest (what the prompts rely on)

**Zero Build mechanics being cloned** — no building; sprint with a stamina meter that holsters the weapon; slide (sprint + crouch) including momentum downhill; mantling over ledges; ADS including mid-air; a **recharging Overshield** as the first defensive layer; glider/bus drop; storm circles that wait, then shrink, with rising damage. Recent Epic revisions (v40.40, May 2026) added: eliminations refill Overshield, infinite sprint while holding the harvest tool, a pocket-item slot, glider redeploy at elevated points, and non-lethal fall damage (a fatal fall leaves you at 1 HP). The playbook implements these as **toggles in `RulesConfig`** (classic vs. modern) so you can feel both.

**Reference numbers used as tuning baselines** (original weapons mirror the *shape* of the genre's stat curves, not names): assault-rifle-class damage 30→36 across Common→Legendary, ~5.5 shots/s, 30-round mag, reload 2.7→2.2 s; pump-shotgun-class ~70→110 per shot, 0.7 shots/s, 5-round mag, reload ~5→4.2 s; SMG-class ~13→17, ~15 shots/s; bolt-sniper-class ~100→116 at 0.33 shots/s; launcher-class ~100+ splash. Heals: bandage-class 15 HP over 3 s (cap 75 HP), medkit-class 100 HP over 10 s, mini-shield-class 25 shield over 2 s (cap 50), big-shield-class 50 over 5 s (cap 100). Storm: ~9–10 circles, wait/shrink times shrinking over the match, damage ≈ 1 → 2 → 5 → 8 → 10 per second in later circles.

**Tech facts verified** — Three.js WebGPURenderer ships in the main package under `three/webgpu` with automatic WebGL2 fallback; TSL (`three/tsl`) compiles one shader description to WGSL or GLSL; post-processing = `RenderPipeline` + `pass()` + `bloom` / `ao` (GTAO) nodes from `three/addons/tsl/display/`; `CSMShadowNode` from `three/addons/csm/CSMShadowNode.js`; compute via `Fn(...).compute(count)` and `StorageInstancedBufferAttribute` (WebGPU). Rapier's `KinematicCharacterController` supports slide, autostep, snap-to-ground and `computedGrounded()`; use `@dimforge/rapier3d-compat` (base64 WASM, no bundler hassle). Colyseus 0.18: server `defineInput`, `inputs.get(sid)`, `setFixedTimestep(fn, hz, {subSteps})`, `allowRewindState({maxRewindMs})`, `rewind.lastSeenBy()`; client `room.input()`, `Predict.get`, `predict.reconciler` / `predict.sim`, `predict.tick()`, `allowRewind: d => d.fire`.

---

# PHASE 1 — Core Engine, Renderer, Rapier Physics, Third-Person Camera, Basic Movement (+ shared-sim foundation)

## 1. Scope
Project scaffold, strict sim/render split, `WebGPURenderer` with WebGL2 fallback, fixed-timestep loop, Rapier world with heightfield terrain, kinematic character controller, over-the-shoulder camera with spring-arm collision and ADS zoom, input system, fully procedural character, debug overlay, determinism tests, and the three docs that carry context to every later phase.

## 2. Model & Settings Command
````
/clear
/model claude-fable-5-2        # Path A (needs usage credits)  — or —
/model claude-opus-5-5         # Path B (default, no credits needed)
/effort high
````
**Quota impact:** HEAVY (the biggest single prompt: ~25–40 files). Budget one full 5-hour window; milestones M1–M7 let you stop and resume cleanly. Do not use `max` effort.

## 3. Pre-Flight Check
- Empty `driftglass/` folder with `git init` done, Node 20+, `claude` started inside it.
- No other files required. (This phase creates everything.)

## 4. The Real Copy-Paste Prompt

````
You are the principal engineer for "Driftglass", a browser-based Zero Build battle royale (original IP). This is PHASE 1 of 8. Build it in milestones M1..M7; after EACH milestone run `npm run typecheck && npm test` (once they exist), fix all errors, and tick the milestone in PROGRESS.md before moving on.

ABSOLUTE RULES
- Zero placeholders: no TODO, no stub functions, no "implement later", no `throw new Error("not implemented")`. Everything in this phase must run.
- No external assets. All geometry/textures are procedural. Original characters/names only; never use Fortnite/Epic names, skins, items or map names.
- Before using ANY API from three, @dimforge/rapier3d-compat, or vite, read the installed package's .d.ts / examples in node_modules. Do not rely on memory (WebGPU/TSL APIs changed recently: e.g. `PostProcessing` became `RenderPipeline` in r183, `Clock` -> `Timer`). Run `npm view three version`, then PIN the exact version (no ^ or ~) for three and @dimforge/rapier3d-compat.
- All game-state logic lives in `src/shared/` (pure TypeScript: no DOM, no three, no window, no Math.random, no Date.now/performance.now). Client code in other folders only renders it or feeds it input. This is mandatory because a Node server will import `src/shared` in Phase 8.

TECH SETUP (M1)
1. package.json (type: module) with scripts: dev, build, preview, typecheck (tsc --noEmit), test (vitest run). Dependencies: three, @dimforge/rapier3d-compat. Dev: vite, typescript (strict, noUncheckedIndexedAccess), vitest, @types/three (only if the pinned three version needs it), lil-gui.
2. tsconfig.json with path aliases `@shared/*` -> src/shared/*, `@core/*` etc. Configure vite.config.ts with the same aliases. Make sure `src/shared` compiles with `"lib": ["ES2022"]` only (no DOM) via a second tsconfig `tsconfig.shared.json` and a script `typecheck:shared`; wire it into `typecheck`. This enforces purity.
3. index.html with a full-window canvas, a hidden #hud root, and a click-to-play overlay that requests pointer lock.

CREATE CLAUDE.md (M1) containing: project summary; the ABSOLUTE RULES above verbatim; the folder map from the architecture below; units (meters, seconds, Y-up, right-handed); fixed sim tick 60 Hz; "world is derived from one integer match seed"; "every shader/material must work on WebGPU and the WebGL2 fallback; test with ?renderer=webgl"; performance budgets (60 fps target at 1080p Medium on a mid-range laptop iGPU, <300 draw calls typical); the doc-update protocol ("at the end of every turn update ARCHITECTURE.md and PROGRESS.md"); the verification commands; the IP-safety rules.

FOLDER MAP (create all directories; files appear as their phase needs them)
src/shared/{sim,physics,world,combat,inventory,match,ai,rules,data}  src/core  src/player  src/world  src/render  src/shaders  src/vfx  src/combat  src/loot  src/audio  src/match  src/ui  src/net  tools  tests

SHARED FOUNDATION (M2) — exact files
- src/shared/rules/Rng.ts: seeded sfc32 (`new Rng(seed)`; `next()`, `range(a,b)`, `int(a,b)`, `pick(arr)`, `fork(label)` for named sub-streams). Unit-tested for determinism.
- src/shared/rules/RulesConfig.ts: typed config object with a `mode: "classic" | "modern"` switch and flags (all default per mode): `eliminationRestoresOvershield`, `infiniteSprintWithHarvestTool`, `nonLethalFalls`, `pocketItemSlot`, `gliderRedeploy`. Export `getRules()`/`setRules()` (pure).
- src/shared/rules/Events.ts: typed event map (discriminated unions) used by sim -> view communication (e.g. `FootstepEvent`, `JumpEvent`, `LandEvent{impactSpeed}`, later `ShotFired`, `DamageDealt`...). `EventQueue` class with `push`, `drain()`.
- src/shared/rules/Strings.ts: all user-facing strings (title "DRIFTGLASS", end-screen title "LAST ONE STANDING").
- src/shared/sim/InputFrame.ts: `InputFrame { tick:number; moveX:-1|0|1; moveZ:-1|0|1; yaw:number; pitch:number; buttons:number }` + bit flags `JUMP, SPRINT, CROUCH, FIRE, ADS, RELOAD, INTERACT, MANTLE_OR_GLIDE, SLOT1..SLOT5, HARVEST` and helpers `has(buttons,flag)`, `pack/unpack` to a compact object. Analog stick support is NOT needed; keep ints for network cheapness.
- src/shared/sim/MovementConfig.ts: all tunables (run 6.0, crouch 3.0, sprint 8.5 m/s, accel/decel ground 45/60, air accel 12, air drag 0.02, gravity 25, jump speed sqrt(2*25*1.2), coyote time 0.10 s, jump buffer 0.12 s, capsule radius 0.35, height 1.8, crouch height 1.1, step height 0.45, max slope 50 deg, snap-to-ground 0.3). Export as a frozen default plus a `deepClone` for live tuning.
- src/shared/sim/PlayerState.ts: plain-data state: position, velocity, yaw, pitch, grounded, groundNormal, crouching, airTime, coyoteTimer, jumpBufferTimer, `fsm` (string enum: Idle, Walk, Run, Crouch, Jump, Fall), health fields reserved as plain numbers (hp=100) so later phases extend without refactors. Provide `cloneState` and `hashState` (stable numeric hash over rounded floats) for determinism tests.
- src/shared/physics/Layers.ts: Rapier collision-group constants (WORLD, PLAYER, PROJECTILE, PICKUP, SENSOR, DESTRUCTIBLE) and helper `groups(member, filter)`.
- src/shared/physics/PhysicsWorld.ts: wraps Rapier (`init()` awaits RAPIER.init once; works in browser and Node). API: `createStaticHeightfield(heights,nx,nz,scale)`, `addStaticBox/Capsule/Trimesh`, `removeCollider`, `raycast(origin,dir,maxToi,filterGroups)`, `shapeCastCapsule(...)`, `createCharacter(radius,halfHeight)` returning a handle with `move(desiredTranslation) -> {translation, grounded, groundNormal}` using Rapier's KinematicCharacterController (slide on, autostep per MovementConfig, snap-to-ground, max slope, `computedGrounded()`), `step(dt)`. The world must be stepped with a FIXED dt of 1/60 only.
- src/shared/physics/Heightfield.ts: converts a `Heightmap` function into a Float32Array grid + Rapier heightfield collider (`nx*nz` samples, configurable cell size 2 m). Include `sampleHeight(x,z)` bilinear and `sampleNormal(x,z)` helpers used by sim and later by visuals.
- src/shared/world/Heightmap.ts: `createHeightmap(seed)` returns `{ heightAt(x,z), size, seaLevel }`. For Phase 1 implement a real seeded multi-octave value/simplex-style fBm with rolling hills plus a flat 60x60 m training pad at the origin and a ramp/steps test area (a 3 m wide staircase of 0.3 m steps, a 25-degree slope, a 40-degree slope). Phase 3 will replace the island shape; keep the function signature stable.
- src/shared/sim/PlayerSim.ts: `stepPlayer(state, input, dt, world, events)` — pure and deterministic. Implements: camera-relative wish direction from yaw; ground accel/decel with friction; air control; gravity; jump with coyote time + jump buffer + variable jump height (releasing JUMP early cuts upward velocity by 50%); crouch with capsule height change (stand-up requires headroom via shape-cast); autostep and slope handling via the character controller; grounded/airTime tracking; emits Footstep events every 2.1 m of ground travel (event includes surface hint "terrain"), Jump, Land{impactSpeed}. Landing must never tunnel; clamp terminal velocity to 70 m/s.
- tests/determinism.test.ts: build the world from a seed, run a scripted 20-second input sequence (walk, jump, crouch, strafe, slope, steps) TWICE in separate PhysicsWorld instances, assert identical `hashState` every 10 ticks. Also assert grounded on flat pad, step-up over 0.3 m steps, blocked by the 40-degree slope, jump apex 1.1-1.3 m.
- tests/rng.test.ts.

CLIENT CORE (M3)
- src/core/RendererFactory.ts: `createRenderer(canvas)` imports `* as THREE from "three/webgpu"`, builds `WebGPURenderer({ canvas, antialias:true, forceWebGL: query ?renderer=webgl })`, `await renderer.init()`, sets pixel ratio cap (min(devicePixelRatio, 2)), `ACESFilmicToneMapping`, sRGB output, and exposes `backendName` ("WebGPU" | "WebGL2"). Handles `webglcontextlost`/device-lost by showing an overlay message. Never calls requestAnimationFrame; uses `renderer.setAnimationLoop`.
- src/core/GameLoop.ts: fixed-step accumulator (sim at 60 Hz, max 5 catch-up steps then drop remainder), render interpolation alpha, uses three's `Timer` (NOT Clock). Exposes hooks `onSimStep(dt, tick)` and `onRender(alpha, frameDt)`. Pauses when tab hidden.
- src/core/Input.ts: keyboard + mouse + pointer lock; rebindable ACTION MAP (`moveForward, moveBack, moveLeft, moveRight, jump, sprint, crouch, fire, ads, reload, interact, slot1..5, harvest, map, swapShoulder, toggleDebug`) with defaults W/A/S/D move, Space jump, Shift sprint, C or Ctrl crouch/slide, LMB fire, RMB ADS, R reload, E interact, 1-5 slots, Q harvest tool, M map, T swap shoulder, F3 debug. Produces an `InputFrame` per sim tick (edge-detected presses buffered between ticks so no input is lost at low FPS). Mouse look accumulates yaw/pitch with sensitivity setting; supports raw `movementX/Y`; pitch clamped +-85 degrees. Persist bindings/sensitivity in localStorage under a versioned key (wrap in try/catch).
- src/core/EventBus.ts: tiny typed pub/sub for UI/audio/vfx to subscribe to sim `EventQueue` output.
- src/core/DebugOverlay.ts: toggle F3. Shows FPS (smoothed), frame ms, sim ms, physics ms, backend name, draw calls & triangles (from renderer.info), player pos/vel/fsm/grounded, tick. A lil-gui panel live-edits MovementConfig (apply immediately). Also `?debug=1` opens it at load.
- src/core/Engine.ts: composition root. Loads physics (await), builds world from `?seed=` (default 1337), creates scene, renderer, loop, input, local player, camera. Exposes `window.__game` (engine instance) for console poking when `?debug=1`.

PLAYER VIEW & CAMERA (M4-M5)
- src/player/CharacterRig.ts: an original procedural low-poly humanoid ("Pip") built from primitives (capsule torso, sphere head with visor, box limbs, small backpack), flat-shaded `MeshStandardNodeMaterial`, with a simple procedural animation layer: idle breathing, walk/run swing driven by speed, crouch lowering, jump/fall pose, yaw smoothing, upper-body pitch (aim) tilt. 12 skinless bones as Object3D hierarchy so later phases can attach a weapon socket at the right hand and a back socket. Expose `setPose(state)` and `update(dt)`.
- src/player/PlayerView.ts: interpolates between previous and current sim states using alpha and drives the rig.
- src/player/ThirdPersonCamera.ts: over-the-shoulder camera. Orbit around a pivot at head height; shoulder offset (0.55, 1.6, -3.2) with a `swapShoulder` toggle (smoothed lateral flip); spring-arm: shape-cast/raycast from pivot toward the desired camera position against WORLD layer only, pull camera in with a 0.2 m margin and smooth recovery so it never pops; camera-vs-terrain near-plane protection. ADS: while ADS is held, smoothly (critically-damped) move to a tighter offset (0.45, 1.5, -1.6) and FOV 75 -> 50 (values in a `CameraConfig` object); sprint widens FOV +6; crouch lowers pivot 0.5 m. Add `CameraEffects.ts` with additive trauma-based shake (`addTrauma(x)`), landing dip from `Land` events, and a hook for recoil kick used by Phase 4. Camera is render-only (not part of shared sim) but its yaw/pitch is what feeds InputFrame.
- src/player/LocalPlayerController.ts: each sim tick: sample Input -> InputFrame -> `stepPlayer` -> push events to EventBus. Holds previous/current state for interpolation.

MINIMUM WORLD FOR TESTING (M6)
- src/world/IslandView.ts (Phase-1 version): builds a terrain mesh from the shared Heightmap (chunked 64x64 quads, vertex normals from `sampleNormal`, simple height-tinted vertex colors via a `MeshStandardNodeMaterial`), a directional sun + hemisphere light with a basic shadow map, a sky-colored background and fog, test props (boxes of 0.5/1.0/1.5/2.0/2.5 m height for mantle testing next phase, a 30 m wall, a steep ramp). Static colliders for the props via PhysicsWorld, with matching meshes. A visible 1x1 m grid on the training pad for scale. (Phase 3 replaces visuals; keep the class name and public methods.)

POLISH & DOCS (M7)
- Click-to-play overlay, ESC releases pointer lock and shows a pause overlay with key list.
- `?renderer=webgl` must work and the overlay must show the active backend.
- Write ARCHITECTURE.md: module diagram (ASCII), data flow (Input -> InputFrame -> shared sim -> events -> views), the sim/render split rule, the seed rule, the file map, config locations, how to add a new sim feature safely, and the Phase 1 public API of each shared module.
- Write PROGRESS.md: phase table (1..8 with status), M1..M7 checklist for Phase 1 (checked), a "Next phase needs" section, "Known limitations", and the tuned default values.
- Final self-check: run typecheck, typecheck:shared, tests, and `vite build` and paste the pass/fail summary.

ACCEPTANCE: `npm run dev` opens, WASD + mouse + jump + crouch work, camera never clips through walls, ADS zoom is smooth, F3 shows >= 60 fps on a mid-range machine at Medium, tests pass, `?renderer=webgl` renders correctly. Finish with a short report listing deviations and open risks.
````

## 5. Browser Verification Checklist
1. `npm run dev` → open `localhost:5173/?debug=1`. F3 overlay shows **backend = WebGPU** (Chrome/Edge) and **≥ 60 FPS**; reload with `?renderer=webgl` and confirm it shows WebGL2 and still renders identically.
2. Walk, strafe, jump, crouch; walk up the 0.3 m stairs (auto-step), try the 40° slope (should not climb it), run into the 30 m wall with the camera behind you: the camera must pull in smoothly, never clip through.
3. Hold RMB: smooth ADS zoom in/out (no snapping); press the shoulder-swap key: smooth lateral flip.
4. Hold a forward key while uncapping FPS in the lil-gui panel (set run speed 12): movement stays consistent regardless of frame rate (sim is fixed-step).
5. In the console: run `npm test`: determinism test passes.

## 6. Debug / Recovery Mini-Prompt
````
Phase 1 is broken: [describe symptom + any console error text]. Read CLAUDE.md and ARCHITECTURE.md, then reproduce with `npm run typecheck`, `npm run typecheck:shared` and `npm test`. Find the ROOT CAUSE (check the installed three/rapier type definitions in node_modules for the real API signature before changing anything), fix it without changing any public API listed in ARCHITECTURE.md, add a regression test in tests/ if the bug is in src/shared, and add a one-line entry to PROGRESS.md under "Known limitations/fixed". No placeholders, no TODOs.
````

---

# PHASE 2 — Advanced Zero Build Locomotion: Tactical Sprint, Stamina, Momentum Sliding, Ledge Mantling, Glider

## 1. Scope
Full locomotion state machine in the shared sim: stamina-gated tactical sprint (holsters weapon), momentum-based sliding that accelerates downhill, raycast-detected mantle/vault, skydive and glider with redeploy, fall-impact events, camera/rig support for every state, and an in-browser self-test panel.

## 2. Model & Settings Command
````
/clear
/model claude-opus-5-5
/effort high
````
**Quota impact:** MEDIUM–HEAVY (state-machine + physics tuning; moderate file count but intricate logic).

## 3. Pre-Flight Check
Phase 1 committed and passing. These must exist: `src/shared/sim/{PlayerSim,PlayerState,MovementConfig,InputFrame}.ts`, `src/shared/physics/PhysicsWorld.ts`, `src/player/{CharacterRig,ThirdPersonCamera,CameraEffects,LocalPlayerController}.ts`, `src/core/DebugOverlay.ts`, `tests/determinism.test.ts`, `CLAUDE.md`, `ARCHITECTURE.md`, `PROGRESS.md`.

## 4. The Real Copy-Paste Prompt

````
PHASE 2 of 8 for Driftglass. First read CLAUDE.md, ARCHITECTURE.md, PROGRESS.md and obey every rule in CLAUDE.md (shared-sim purity, no placeholders/TODOs, check installed library types before using an API, original IP only). Work in milestones M1..M7; after each: `npm run typecheck && npm test`, fix, tick PROGRESS.md.

GOAL: replace the simple Phase 1 movement with the complete Zero Build locomotion set, entirely inside src/shared (deterministic), with client views for camera/rig.

M1 — LOCOMOTION FSM (src/shared/sim/LocomotionFSM.ts, refactor PlayerSim.ts)
- States: Idle, Walk, Run, Sprint, Crouch, Slide, Jump, Fall, Mantle, Vault, Skydive, Glide, Dead(reserved, behaves as Idle with no input). One explicit transition table with guard functions and enter/exit hooks; every transition is unit-tested in tests/locomotion.test.ts. PlayerSim must delegate per-state logic to StaminaSim, SlideSim, MantleSim, GliderSim modules (new files, pure).
- Speeds: Walk (ADS/slow) 3.5, Run 6.0, Crouch 3.0, Sprint 8.5, Slide entry 10.5 -> decays. All multipliers (ADS 0.6, weapon-equipped 0.95, harvest-tool 1.05, casting-consumable 0.6) are exposed via a `speedModifiers` field in PlayerState so Phases 4-5 can set them.

M2 — TACTICAL SPRINT + STAMINA (src/shared/sim/StaminaSim.ts)
- Stamina 0..100. Sprint drains 10/s (full bar = 10 s of sprint). Regen 14/s starting 0.8 s after sprint ends (the delay resets if sprint is re-pressed). Cannot START a sprint below 15 stamina (hysteresis) and sprint auto-ends at 0 with a 0.5 s lockout. Sprint requires moving forward-ish (angle between wish dir and facing < 60 deg) and being grounded; entering the air keeps momentum but stops the drain. Sprint auto-cancels when the player presses FIRE or ADS (weapon comes back up); `holsterWeapon` boolean in PlayerState is true while sprinting (Phase 4 reads it).
- Support `sprintMode: "hold" | "toggle" | "auto"` (auto-sprint when stick forward) in MovementConfig.
- RulesConfig modern flag `infiniteSprintWithHarvestTool`: when true and `harvestToolEquipped` is true, stamina does not drain.
- Expose `stamina`, `staminaMax`, `sprintLocked` in PlayerState for the HUD.

M3 — MOMENTUM SLIDE (src/shared/sim/SlideSim.ts)
- Slide starts when CROUCH pressed while sprinting (or while moving > 7 m/s) and grounded. Entry speed = max(current speed, 10.5) * 1.0, never above 16. Capsule drops to crouch height. Steering: wish direction may rotate the velocity direction at up to 70 deg/s (no strafe thrust). Friction: on flat ground horizontal speed decays so a flat slide lasts about 1.1 s (coefficient in config). Slope physics: acceleration along the surface = g * sin(slopeAngle) * slopeBoost (config 1.35). On a downhill slope steeper than 6 degrees speed is conserved/increased (cap 20 m/s); on uphill it decays fast. Must use ground normal from the character controller; stay glued to terrain with snap-to-ground; if the ground drops away the player goes airborne while KEEPING horizontal velocity.
- Slide-jump: pressing JUMP during a slide cancels it with a 1.15x horizontal boost (capped) and a normal jump. Slide ends when speed < 4 -> Crouch (or Run if CROUCH released and headroom allows). Re-slide cooldown 0.45 s. Cannot slide while a consumable is being cast (reserved flag).
- Emit events `SlideStart`, `SlideEnd`, and `SlideLoop{speed}` (for audio later).

M4 — LEDGE MANTLE + VAULT (src/shared/sim/MantleSim.ts)
- Detection runs every tick while airborne OR while pressing forward into a wall while grounded-sprinting/jumping. Algorithm (all with PhysicsWorld raycasts/shape casts on WORLD+DESTRUCTIBLE layers): (1) forward ray from chest height (0.9 m) along facing, length 0.7 m; hit normal must be within 35 degrees of horizontal (a wall, not a slope). (2) from 0.15 m inside the hit point, cast a ray straight DOWN starting 2.4 m above ground to find the ledge top; ledge height H = top - feetY. (3) validate: H in [0.5, 2.3]; the top surface normal.y > 0.7; landing spot clear for a standing capsule (shape-cast) with 0.05 m margin; if H <= 1.1 and the obstacle thickness (second down-ray 0.9 m further) shows ground within 0.6 m of the original floor -> VAULT (clear it and keep forward speed) else MANTLE (climb up, speed -> 3 m/s).
- Execution: kinematic, collision-disabled-but-validated path along a cubic Bezier from current pos -> (above the lip) -> final standing pos over duration = clamp(0.28 + 0.18*H, 0.3, 0.75) s for mantle, 0.32 s for vault. Fully deterministic (state holds `mantleT`, `mantleFrom`, `mantleCtrl`, `mantleTo`). Cancel only on Glide/Skydive impossible; no cancel. After finish, grant 0.15 s of input lock then return to Idle/Run depending on input, preserving sprint intent.
- Input: JUMP or MANTLE_OR_GLIDE while the detector returns a valid target and the player is moving forward (or airborne against the wall). Provide `MantleSim.probe(state, world)` that returns the candidate target so the HUD/debug can draw it.
- Debug visualizer in src/core/DebugOverlay.ts: draw the probe rays and target point (three LineSegments + sphere) when F4 is pressed.

M5 — SKYDIVE, GLIDER, REDEPLOY (src/shared/sim/GliderSim.ts)
- Skydive: free-fall with horizontal steering 20 m/s max, forward lean increases horizontal speed and vertical speed (dive), flare reduces it; vertical terminal speed 55 m/s (dive up to 75 with full lean). Camera/rig: arms-out pose, camera pulled back.
- Glider: auto-deploy at 120 m above ground if the player has not pressed deploy; manual deploy with MANTLE_OR_GLIDE (Space tap in the air). Glide: forward speed 22 m/s, descent 7 m/s at neutral, W increases speed (28) and sink (11), S slows (16) with sink 5; A/D bank-turn at 55 deg/s with roll angle for the rig; ground proximity: auto-close the glider when within 1.4 m of ground (-> Fall/Land). Landing from Glide has NO fall damage and triggers `Land` with impactSpeed capped.
- Redeploy (RulesConfig.gliderRedeploy): after leaving the ground by falling (not jumping) more than 6 m with downward speed > 12 m/s, pressing MANTLE_OR_GLIDE deploys the glider; a 1.0 s re-deploy cooldown and the glider auto-stows at ground contact. Include cliffs in the test area to try it.
- Fall impact: on landing emit `Land{impactSpeed, fallHeight}`; add `fallDamage(impactSpeed, rules)` pure function in src/shared/combat/DamageModel.ts (create the file with just this function plus exports for later): classic = damage = clamp((impactSpeed-14)*3.2, 0, 100) lethal; modern (nonLethalFalls) = same but result clamped so it can never reduce hp below 1 (a "splat" flag returned). Nothing applies the damage yet (Phase 4 does) but unit-test the function.
- A debug "Launch Tower": a 150 m tower (static collider) in the test world + key F6 teleports the player to its top, and F7 teleports to 400 m altitude, so skydive/glide can be tested quickly.

M6 — VIEWS: RIG, CAMERA, FEEL
- CharacterRig: add poses for Sprint (forward lean, pumping arms, weapon-lowered flag), Slide (leaned back, one leg extended, low), Mantle/Vault (hands on ledge IK-less keyframed pose along the Bezier progress), Skydive (spread eagle), Glide (arms up holding a glider frame; draw an original procedural glider: a stylised delta wing with two emissive stripes; scale-in/out animation on deploy/stow), plus smooth blends between all states (0.12 s).
- ThirdPersonCamera: sprint FOV +6 with ease; slide lowers pivot and adds subtle roll in slide direction; mantle pulls the camera slightly back; skydive/glide pull back to (0.6, 1.9, -5.5) and loosen pitch clamp; landing dip scaled by impactSpeed; all through CameraEffects, no snapping.
- Footstep/slide/mantle/land events must reach the EventBus (audio comes in Phase 5).

M7 — SELF-TEST + DOCS
- src/core/SelfTest.ts: pressing F9 runs scripted in-browser checks through the REAL sim: sprint drains 10 s of stamina, slide on the 25-degree slope reaches > 14 m/s, mantle succeeds on 1.0/1.5/2.0 m boxes and fails on 2.6 m, vault clears a 0.8 m box, glide lands without damage, redeploy works off the cliff. Print PASS/FAIL per check in a DOM panel. Same checks mirrored in tests/locomotion.test.ts for CI.
- Extend the test world (IslandView Phase-1 test area) with: boxes 0.5/0.8/1.0/1.5/2.0/2.6 m, a 25-degree and 15-degree long hill for sliding, a cliff 12 m high, and the Launch Tower. Meshes + colliders for each.
- Update ARCHITECTURE.md (locomotion FSM diagram, state table, config table, event list, input-to-state matrix) and PROGRESS.md (tick milestones, Phase 3 needs).

ACCEPTANCE: sprint/slide/mantle/vault/skydive/glide/redeploy all work, are deterministic (extend tests/determinism.test.ts with a 30-second scripted run that includes slide + mantle + glide), and F9 shows all PASS. No placeholders. End with a short report of tuned values that differ from this brief.
````

## 5. Browser Verification Checklist
1. **Stamina:** hold Shift forward on the flat pad: the sprint ends after ~10 s, then has to recover before restarting (HUD not built yet: read `stamina` in F3 overlay or `__game`).
2. **Slide:** sprint down the 25° hill and press crouch: speed climbs (watch F3) well past run speed; a flat-ground slide dies in ~1 s; slide-jump keeps momentum.
3. **Mantle/Vault:** run at the 1.0 m, 1.5 m and 2.0 m boxes with Space: smooth climb with no teleport; the 2.6 m box must refuse; press F4 to see the probe rays.
4. **Glide:** F7 (400 m), free-fall, auto-deploy at ~120 m, steer, land softly. Jump off the 12 m cliff and tap Space for redeploy.
5. **F9:** every self-test row shows PASS, and FPS stays ≥ 60.

## 6. Debug / Recovery Mini-Prompt
````
Phase 2 locomotion bug: [state which mechanic: sprint / slide / mantle / vault / skydive / glide / redeploy] — expected [X], actual [Y]. Read ARCHITECTURE.md, then write a FAILING vitest in tests/locomotion.test.ts that reproduces it using the real PlayerSim + PhysicsWorld (scripted InputFrames, fixed 1/60 dt). Fix the cause in src/shared/sim/* (never by special-casing the test), keep determinism (run tests/determinism.test.ts), and update the tuned-values table in ARCHITECTURE.md if a constant changed. No TODOs.
````

---

# PHASE 3 — Next-Gen Stylized Graphics Pipeline: Custom Shaders, Lighting, Post-Processing, Island Terrain, GPU Particles

## 1. Scope
Replace the Phase 1 placeholder visuals with the real look: the Driftglass Atoll island (shared heightmap + biomes + landmarks), triplanar/splatmap terrain, instanced foliage with wind, stylized water, gradient sky dome with time of day, CSM sun shadows, stylized-PBR + cel/rim material, `RenderPipeline` post stack (bloom, GTAO, ACES, vignette), quality presets with dynamic resolution, and a GPU particle system with all effect presets Phase 4–6 need.

## 2. Model & Settings Command
````
/clear
/model claude-opus-5-5
/effort high            # use medium for the M6 particle milestone if the window is tight
````
**Quota impact:** HEAVY (many shader files, high iteration risk). Milestones M1–M8 are independent enough to split across two windows.

## 3. Pre-Flight Check
Phases 1–2 committed. Must exist: `src/shared/world/Heightmap.ts`, `src/shared/physics/{PhysicsWorld,Heightfield}.ts`, `src/world/IslandView.ts` (Phase 1 version), `src/core/{RendererFactory,Engine,DebugOverlay}.ts`, `src/render/`, `src/shaders/` (empty dirs OK), the three docs.

## 4. The Real Copy-Paste Prompt

````
PHASE 3 of 8 for Driftglass: the graphics pipeline and the real island. Read CLAUDE.md, ARCHITECTURE.md, PROGRESS.md first and obey CLAUDE.md (shared-sim purity, no placeholders/TODOs, verify library APIs in node_modules before use, original IP only, everything procedural, every material works on WebGPU AND the WebGL2 fallback). Milestones M1..M8; after each run typecheck/test, view it via `npm run dev`-level reasoning (you cannot see the browser: so add the debug toggles described and make failure states loud with on-screen warnings), tick PROGRESS.md.

IMPORTANT API NOTES (verify against the installed version, do not trust these blindly): import renderer/materials from "three/webgpu" and nodes from "three/tsl". Post-processing is `RenderPipeline` (renamed from `PostProcessing` in r183; if the pinned version still names it PostProcessing use that) with `pass(scene, camera)`, `bloom`, and GTAO `ao` nodes from "three/addons/tsl/display/*". `EffectComposer` is WebGL-only: never use it. Shadows for WebGPU: `CSMShadowNode` from "three/addons/csm/CSMShadowNode.js" attached via `light.shadow.shadowNode`. Use `Timer`, not `Clock`. Compute: `Fn(...).compute(count)`, `renderer.compute()` / `computeAsync`, `StorageInstancedBufferAttribute` / `instancedArray`; compute is a WebGPU-backend feature: detect `renderer.backend.isWebGPUBackend` and provide a CPU-simulated InstancedMesh fallback for particles on WebGL2. Do not use deprecated `PostProcessing`/`Clock` if the pinned version marks them deprecated.

M1 — ISLAND DEFINITION (shared, deterministic)
- src/shared/data/island.json + src/shared/world/IslandSpec.ts: Driftglass Atoll, ~2.4 km x 2.4 km playable (world size 3072 m with ocean margin). Biomes: Salt Dunes (south beach, sand), Whisper Pines (north-west conifer forest), Saltmarsh Fields (flat farmland, east), Obsidian Quarry (rocky, high), Windmill Heights (central-north hill with a landmark mill), Lantern Hollow (low swampy valley with lit lanterns), Rustwater Docks (south-east harbor), Pinecrest Outpost (small town). 8 named POIs with centre, radius, flatten radius, loot tier (1-3) and a mini "town layout" (list of building footprints with width/depth/height/rotation/type). All original names and layouts.
- src/shared/world/Heightmap.ts (replace Phase 1 interior; KEEP the signature): island mask (radial + warped noise falloff), ridged mountain mass around Obsidian Quarry (peak ~140 m), rolling hills, river valley, beach slope to sea level 0, flatten pads under each POI (smoothstep blend to the POI flatten radius), keep a 100 m flat spawn pad island platform for the pre-game lobby located outside the main island at a fixed offset (a small separate islet "Launch Isle"). Provide `heightAt`, `normalAt`, `slopeAt`, `biomeAt(x,z)` (returns biome id + blend weights) in BiomeMap.ts, and a `isWater(x,z)`.
- Keep the Phase 1/2 test area available behind `?testarea=1` (a separate islet "Proving Grounds" at a fixed offset) so movement tests still work.
- Rapier heightfield: switch Heightfield.ts to chunked heightfield colliders (e.g. 256 m tiles at 2 m cells; streaming not needed, all static) so tall terrain does not create one giant collider. Add tests: collider height equals heightAt within 5 cm at 200 random points; no NaNs; determinism for a seed.

M2 — TERRAIN RENDERING (src/world/TerrainChunks.ts, src/shaders/TriplanarTerrain.ts)
- Chunked terrain, 128 m chunks, 3 LODs (cell size 2, 4, 8 m) selected per chunk by distance with hysteresis, skirts or edge-stitching to hide LOD cracks, frustum culling per chunk, geometry built from the SHARED heightmap, normals from analytic gradient. Vertex data carries biome blend weights (4 channels) and slope/height packed attributes.
- TSL terrain material (MeshStandardNodeMaterial based): 4 material layers (sand, grass, rock, dirt/mud) blended by biome weights AND slope/height rules; triplanar projection for rock/cliff layers; all albedo/roughness/normal detail generated procedurally with TSL noise (e.g. `mx_noise_float`, fbm helpers in src/shaders/noise.ts) at two scales with distance-based detail fade; macro-variation tint; stylized painterly saturation; wet-sand darkening near the shoreline; cheap fake AO from cavity/slope. No external textures.
- Debug toggles via DebugOverlay: wireframe, LOD tint, biome-weight view.

M3 — FOLIAGE, ROCKS, PROPS (src/shared/world/PropPlacement.ts, src/world/FoliageView.ts, src/shaders/WindFoliage.ts)
- Shared deterministic placement from the seed: trees (3 conifer variants + 2 broadleaf + palms on beaches), bushes, grass tufts, rocks/boulders (3 sizes), reeds near water, fences, flowers; density from biome + slope + POI exclusion zones; Poisson-disk-like jitter grid via Rng. Output compact typed arrays per spatial cell (64 m cells) so the server can reuse it for collision/destructibles later. Collider list for trunks/boulders (capsule/cylinder/hull simplified) exposed from shared.
- Rendering: `InstancedMesh` (or BatchedMesh where it measurably wins) per variant per cell, distance-based cell culling, 3 LODs for trees (full / simplified / billboard-cross), grass drawn only within 60 m with density falloff. Geometry is procedural low-poly stylized (trunk cylinders + stacked cones/icospheres with vertex colors).
- WindFoliage.ts (TSL): vertex displacement = height-weighted sway (low frequency world-space noise gust + per-instance phase) + leaf flutter (high frequency) with a global `windStrength` and `windDirection` uniforms; grass bends away from the player within 1.5 m (uniform player position). Works for instanced meshes (use instance matrix correctly in TSL).
- Collision for trees/boulders registered in PhysicsWorld on the WORLD layer; destructible flag + hit points assigned (Phase 5 uses it).

M4 — LANDMARKS, TOWNS, WATER (src/world/PropsView.ts, src/world/WaterView.ts, src/shaders/Water.ts)
- Procedural buildings from the POI layouts: boxes with gabled roofs, doors/windows as emissive/recessed details via simple geometry, silos, docks with planks, a windmill with rotating blades (animated), lantern posts (emissive) in Lantern Hollow, wrecked boat at the docks. Each gets static colliders. Interiors are walkable (doors are open gaps), so mantle targets and ladders-free multi-storey is OK: keep it to 1-2 floors.
- Water: large plane with TSL material: depth-based color (shallow turquoise to deep navy using depth from the heightmap via a baked low-res depth texture), animated dual-scrolling normal waves from procedural noise, fresnel reflection of the sky color, shoreline foam bands, sun glint, subtle vertex waves. Swim is NOT in scope: add a `isWater` kill-zone rule note in ARCHITECTURE.md only (players in deep water take no special handling yet; clamp them at shore via invisible collider ring at sea level - 1.5 m so they cannot swim away).

M5 — SKY, LIGHTING, SHADOWS (src/world/SkyView.ts, src/shaders/SkyDome.ts, src/render/Lighting.ts, src/render/Shadows.ts)
- Sky dome (TSL, inside-out sphere, depth-write off): vertical gradient (zenith/horizon/ground haze), sun disc + glow, procedural fbm clouds scrolling, stars at night, driven by a single `timeOfDay` (0..24) with presets (Golden Morning default 9.5 h). Hemisphere ambient + `scene.environment` from a small PMREM/cube capture of the sky regenerated only when timeOfDay changes by > 0.1 h. Fog color = horizon color; exponential-squared height fog, distance tuned so mountains fade.
- Sun: `DirectionalLight` with `CSMShadowNode` (3-4 cascades, far 400 m, light margin, fade enabled), shadow map size per quality preset, bias/normalBias tuned to avoid acne on terrain and peter-panning on characters; shadow-casting restricted to near cascade for foliage (flag in material/instances). Stable texel snapping to avoid shimmering while moving (verify in docs; implement if the node does not).
- Expose `Lighting.setTimeOfDay(h)`; the sun direction is also exported for the stylized materials.

M6 — STYLIZED PBR + CEL/RIM MATERIAL (src/shaders/StylizedLit.ts, src/shaders/Fresnel.ts)
- `createStylizedMaterial({color, roughness, metalness, emissive, rimColor, rimPower, bands})`: a MeshStandardNodeMaterial (or custom lighting model if the node API supports it in the pinned version; otherwise a MeshToonNodeMaterial variant) that keeps PBR specular/IBL but quantizes DIRECT diffuse into soft 3-band ramp (smoothstep edges, adjustable softness), adds a fresnel rim light tinted by sky/sun (strongest on the sun-opposite side), slight hue-shift in shadows (cooler), and an optional thin back-face outline (inverted-hull) for characters. Apply it to the CharacterRig, props and buildings; terrain/foliage keep their own materials but use the same ramp function from src/shaders/StylizedLit.ts for visual coherence.
- Characters render with outlines on the High/Ultra preset only.

M7 — POST-PROCESSING & QUALITY (src/render/RenderPipelineFX.ts, QualityPresets.ts, src/core/Quality.ts)
- RenderPipeline with: scene pass -> GTAO ambient occlusion (half-res, radius ~1.2 m, intensity tunable) -> emissive-threshold bloom (strength 0.35, radius 0.6, threshold ~1.0 in linear HDR) -> vignette (subtle) -> ACES Filmic tone mapping applied ONCE (avoid double tone mapping: respect `outputColorTransform`) -> FXAA/SMAA if MSAA is unavailable. A color-grade node with exposure, contrast, saturation uniforms. Provide a `storm` post-effect hook (desaturate + noise + vignette weight uniform) that Phase 6 will drive.
- Quality presets Low / Medium / High / Ultra controlling: render scale (0.6..1.0), shadow map size + cascades (1x1024 / 2x1536 / 3x2048 / 4x2048), AO on/off + resolution, bloom on/off, foliage density & draw distance, grass distance, tree LOD distances, water detail, outlines, anisotropy. Persisted in localStorage; `?quality=low|medium|high|ultra` URL override.
- Dynamic resolution scaler: samples frame time over 1 s; if > 20 ms for 2 consecutive windows, lower render scale by 5%; if < 13 ms for 5 s, raise by 5% (bounds per preset; can be disabled in settings later).
- Auto quality pick at first launch from a 3-second benchmark.
- On the WebGL2 fallback, features unsupported by the backend must degrade gracefully (e.g. no GTAO/compute) with a one-line console notice; nothing may throw.

M8 — GPU PARTICLE SYSTEM + EFFECT PRESETS (src/vfx/ParticleSystem.ts, src/vfx/presets/*, src/shaders/ for any TSL)
- ParticleSystem core: pooled emitters, additive/alpha blend sprite materials (SpriteNodeMaterial/instanced quads with camera-facing billboards in TSL), per-particle life/size/color/velocity curves; WebGPU path = compute shader simulation in storage buffers; WebGL2 path = CPU-simulated InstancedMesh with the same public API and the same visual presets (cap counts lower). Soft-particle depth fade where the backend allows. API: `vfx.spawn(presetId, position, direction?, opts?)`, `vfx.update(dt)`.
- Presets (each with a debug key in F5 menu to spawn it at the crosshair): MuzzleFlash (3 variants: rifle, shotgun cone, launcher), BulletTracer (stretched glowing streak between two points, fades in 0.08 s), HitSpark (surface-colored), ImpactPuff (stylised neutral puff on player hits, no gore), ShieldBreak (hexagonal shards + radial burst + bloom flash, blue), OvershieldBreak (distinct gold/white variant with a ring shockwave), ExplosionSmall (launcher), Dust (footstep/land/slide), Debris (generic chunk burst with 4 palettes: wood/stone/metal/leaf), LootSparkles, StormLightning (vertical forked bolts as camera-facing emissive ribbons with flicker, sized for 200 m tall), StormEmbers (rising purple motes), WaterSplash.
- Budget: 20k simultaneous particles on WebGPU, 3k on the fallback, all under 1.5 ms CPU/frame.
- Add a `vfx` stress test in F5 to spawn 5000 particles and report the frame time.

DOCS: ARCHITECTURE.md: render pipeline diagram, material catalogue, shader file index, quality table, backend differences (WebGPU vs WebGL2), perf budget table with measured numbers you can derive from renderer.info, how to add a new material/effect. PROGRESS.md updated; list any shader feature that is WebGPU-only.

ACCEPTANCE: the island looks cohesive and stylized at 60 fps on Medium (1080p, iGPU class) with ~300 draw calls or fewer (report the actual number from renderer.info); backend toggle works; every preset spawns on both backends; tests for island/heightfield determinism pass; typecheck + build pass; no placeholders. End with a short report of what is WebGPU-only.
````

## 5. Browser Verification Checklist
1. **Visual check** at spawn (Driftglass Atoll): terrain shows sand/grass/rock layers with no texture stretching on cliffs, trees sway in the wind, grass bends as you walk through it, water has foam at the shoreline, sun shadows are crisp near you and stable (no shimmer) while moving.
2. **FPS/draw calls:** F3 shows ≥ 60 FPS at Medium and the draw-call count Claude reported; switch Low/High with `?quality=`; the dynamic resolution scaler should visibly adjust render scale if you throttle (open a heavy tab).
3. **Time of day:** call `__game.lighting.setTimeOfDay(19)` in the console: dusk sky, long shadows, bloom on emissive lanterns, no tone-mapping washout (no double tone mapping).
4. **Backend parity:** reload with `?renderer=webgl`: everything still renders (some effects reduced), no console errors.
5. **F5 particle menu:** every preset fires; the stress test keeps ≥ 45 FPS.

## 6. Debug / Recovery Mini-Prompt
````
Phase 3 graphics bug: [symptom, e.g. "terrain black on WebGL fallback", "shadow shimmer", "grass not swaying", "bloom blows out"] on backend [WebGPU/WebGL2]. Read ARCHITECTURE.md. Check the installed three version's exports in node_modules (three/webgpu, three/tsl, three/addons/tsl/display) for the real node names; do not guess. Isolate by adding a DebugOverlay toggle that disables the suspect pass/material, find the root cause, fix it, confirm on BOTH backends, and note any backend-specific workaround in ARCHITECTURE.md. No placeholders.
````

---

# PHASE 4 — Health, Shield, Regenerating Overshield, 5-Slot Inventory, Rarity Weapons & Ballistics

## 1. Scope
Shared combat simulation: damage layering (Overshield → Shield → Health), regen rules, fall damage application, the 5-slot hotbar + harvest tool, ammo pools, five rarity tiers, hitscan (assault rifle, shotgun, SMG) with bloom/spread, damage falloff and headshots, projectile weapons with gravity and travel time (sniper, launcher), recoil/sway, analytic player hitboxes, weapon views, training dummies, and the data-driven `weapons.json`. Part B tunes the JSON and generates a balance report.

**Original weapon names (use exactly these):** Vireo Carbine (AR), Scatterback (shotgun), Hummer-12 (SMG), Longsight (bolt sniper), Thumper (launcher), plus the **Trailpick** (harvest tool).

## 2. Model & Settings Command
````
# PART A
/clear
/model claude-opus-5-5
/effort high
# PART B (after Part A passes its checklist and you've committed)
/clear
/model claude-sonnet-5-5
/effort medium
````
**Quota impact:** Part A HEAVY (largest rules-heavy phase), Part B LIGHT.

## 3. Pre-Flight Check
Phases 1–3 committed. Must exist: `src/shared/sim/*`, `src/shared/combat/DamageModel.ts` (has `fallDamage`), `src/shared/rules/{Events,Rng,RulesConfig}.ts`, `src/vfx/ParticleSystem.ts` + presets (MuzzleFlash, BulletTracer, HitSpark, ShieldBreak, OvershieldBreak, ExplosionSmall), `src/player/{CharacterRig,ThirdPersonCamera,CameraEffects}.ts`, `src/core/Input.ts`.

## 4A. The Real Copy-Paste Prompt — PART A (Opus)

````
PHASE 4A of 8 for Driftglass: combat. Read CLAUDE.md, ARCHITECTURE.md, PROGRESS.md first and obey CLAUDE.md (all logic in src/shared, deterministic, seeded Rng only, no placeholders/TODOs, verify library APIs, original IP only). Milestones M1..M8 with typecheck/test and PROGRESS.md ticks after each.

M1 — HEALTH / SHIELD / OVERSHIELD (src/shared/combat/HealthSim.ts, DamageModel.ts)
- State per damageable: hp(0..100), shield(0..100), overshield(0..50), `lastDamageTime` (sim time), `alive`. Damage order: Overshield first, then Shield, then Health; carry-over between layers inside one hit; headshot/weak-spot multipliers are applied BEFORE layering. Overshield regen: starts `overshieldRegenDelay` = 5.0 s after the last damage taken, rate 10/s (full recharge 5 s), continues only while not damaged; any damage resets the delay. Config in RulesConfig/`combat.json`. Modern flags: `eliminationRestoresOvershield` (full refill on a kill), `nonLethalFalls` (use fallDamage splat result: hp clamps to 1 and all shields/overshield zero when a fatal fall happens).
- Emit events: `DamageTaken{victim, attacker, amount, layer: "overshield"|"shield"|"health", headshot, weaponId}`, `OvershieldBroken`, `ShieldBroken`, `Eliminated{victim, killer, weaponId, headshot}`, `OvershieldRestored`.
- A generic `Damageable` interface implemented by players, bots, dummies, destructibles.
- Wire `Land{impactSpeed}` events from Phase 2 to apply `fallDamage` to the local player (sim-side, in PlayerSim or a CombatSim wrapper).
- tests/combat.test.ts: layering math, carry-over, regen timing (fake sim clock), kill, modern/classic flag behaviour, fall splat.

M2 — ITEM DEFINITIONS & INVENTORY (src/shared/inventory/ItemDefs.ts, InventorySim.ts, data/weapons.json, data/consumables.json)
- Rarity enum: Common, Uncommon, Rare, Epic, Legendary with colors (gray #B6BBC4, green #4CCB4A, blue #3FA7FF, purple #B05CFF, gold #FFB52E) in a shared constant (UI/beams will use them; colorblind-safe alternates also defined).
- Inventory: 5 hotbar slots (indices 0-4, keys 1-5) holding weapon or consumable stacks, plus a permanent `harvest` tool slot (Trailpick) and, behind `pocketItemSlot`, one extra pocket slot (utility; just the slot and API this phase). Ammo pools with caps: light 250, medium 250, heavy 30, shells 50, rockets 12. Operations (all pure, return events): `pickup(item)`, `swap(slot, item)` (returns the dropped item), `drop(slot)`, `equip(slot)`, `moveSlot(a,b)`, `addAmmo(type,n)`, `consumeAmmo`, `canPickup(item)` (stack limits: bandage-class 15, kit-class 3, mini-shield-class 6, big-shield-class 3), per-weapon `magAmmo` stored on the weapon instance.
- consumables.json (original names): Patch Wrap (15 HP, 3 s cast, heals only up to 75 HP, stack 15), Field Kit (100 HP, 10 s, stack 3), Spark Cell (25 shield, 2 s, only up to 50 shield, stack 6), Bulwark Cell (50 shield, 5 s, up to 100, stack 3). (Cast logic itself arrives in Phase 5; define data + `ConsumableDef` types now.)

M3 — WEAPON DATA & MODEL (src/shared/data/weapons.json, src/shared/combat/WeaponSim.ts)
- Data-driven. Each weapon: id, name, class, ammoType, fireMode (auto/semi/burst/pump/bolt), `kind: "hitscan"|"projectile"`, rarities[5] with {damage, fireRate, magSize, reloadTime, spreadBase, bloomPerShot, recoilV, recoilH, headshotMult, equipTime}, falloff[{range, mult}], range, pellets (shotgun), projectile {speed, gravity, drag, lifetime, radius, explosion{radius, falloff, selfMult, knockback}} , bloom {min, max, perShot, recoveryPerSec, adsMult, moveMult, crouchMult, airMult, sprintLocksFire}, sway/recoil patterns, sound class tags, muzzle offset, model recipe id.
- Starting baselines (Common -> Legendary; Part B refines these): 
  - Vireo Carbine (auto, medium ammo): damage 30/31/33/35/36, 5.5 shots/s, mag 30, reload 2.7/2.6/2.5/2.4/2.2, headshot 1.5x, falloff 100% to 60 m then 75% by 120 m.
  - Scatterback (pump, shells): 10 pellets, damage per shot 70/80/90/100/110 (distributed), 0.7 shots/s, mag 5, reload 5.0/4.8/4.6/4.4/4.2, headshot 1.5x, effective 15 m, falloff to 20% by 35 m.
  - Hummer-12 (SMG, light): damage 13/14/15/16/17, 15 shots/s, mag 20/20/20/26/26, reload 1.7/1.6/1.5/1.4/1.3, headshot 1.5x.
  - Longsight (bolt sniper, heavy): projectile speed 320 m/s, gravity 4 m/s^2, damage 100/104/108/112/116, 0.33 shots/s, mag 1, reload 4.7/4.1/3.6/3.1/2.5, headshot 2.5x, ADS zoom 4x with scope overlay flag.
  - Thumper (launcher, rockets): projectile speed 55 m/s, gravity 3 m/s^2, direct 100 + splash up to 100 within 4 m (linear falloff), self-damage 50%, 0.75 shots/s, mag 1, reload 3.2/3.0/2.8/2.5/2.2, knockback impulse, arming distance 3 m.
  - Trailpick (harvest, melee): swing 0.55 s, 20 damage to players, 50 damage to props with a weak-point "sweet spot" critical (2x) detected by a moving reticle timing window (Phase 5 consumes).
- WeaponSim.ts: pure per-weapon state machine: Holstered, Equipping, Ready, Firing (cooldown), Reloading, Empty. Handles fire-rate accumulation at fixed dt, auto vs semi vs pump (rack time = 1/fireRate) vs bolt (bolt-cycle after each shot), reload start/cancel-by-switch/finish, auto-reload on empty, ammo consumption, `canFire` (not sprinting when `sprintLocksFire`, not mantling/sliding/gliding unless allowed per class, equip finished).

M4 — SPREAD, BLOOM, RECOIL (src/shared/combat/Spread.ts, Recoil.ts)
- Crosshair bloom model: current bloom angle = clamp(base + accumulated, min, max); accumulated += bloomPerShot on each shot, decays at `recoveryPerSec` after a 0.15 s grace; multipliers: ADS, moving (speed-proportional), crouching, airborne, sliding. Each shot's direction = aim direction rotated by a uniformly-random point inside the bloom cone using the SEEDED Rng (`rng = Rng(matchSeed ^ playerId ^ shotIndex)`; deterministic for netcode).
- Recoil: per-shot vertical kick + horizontal random drift (seeded), camera applies kick; recovery pulls back toward the pre-kick aim at `recoilRecovery` deg/s; ADS multiplies recoil by 0.6. Expose `recoilKick` output consumed by CameraEffects. Weapon sway/inertia (visual only) lives in the view.
- tests/ballistics.test.ts: bloom growth/decay, determinism for same seed, cone distribution stays inside angle.

M5 — HITBOXES & HITSCAN (src/shared/combat/Hitboxes.ts, Ballistics.ts)
- ANALYTIC player/bot/dummy hitboxes (NOT Rapier colliders, so Phase 8 can rewind them): head sphere r=0.14 at head, torso capsule, two upper-leg and two lower-leg capsules, arm capsules; zone multipliers from config: head per-weapon (1.5-2.5), torso 1.0, arms/legs 0.9. Hitbox transform comes from the entity's sim state (position, yaw, crouch/slide/prone-height) so it does not depend on the rig animation. Provide `rayVsHitboxes(origin, dir, maxDist, entity)` returning nearest hit with zone.
- Hitscan resolution `resolveHitscan(shooter, aimOrigin, aimDir, weapon, rarity, world, entities, rng)`: (1) ray from the CAMERA/eye through the bloom-perturbed direction (aim assist none), find the world impact via PhysicsWorld raycast on WORLD+DESTRUCTIBLE layers and the nearest entity hitbox hit; take whichever is closer; (2) re-validate from the muzzle toward that point (if the muzzle ray hits world first, the shot is blocked by close cover, as in real third-person shooters); (3) apply range falloff (piecewise linear), zone multiplier, rarity damage; shotgun: N pellets each with its own seeded cone point; returns a list of `HitResult` and a `tracerEnd`. Emit `ShotFired{shooter, weaponId, origin, dir, seed}` and `ShotHit{...}` events.
- Penetration none. Self-hit ignored. Team field reserved for future duos (hits on same team ignored when set).

M6 — PROJECTILES (src/shared/combat/Ballistics.ts)
- Fixed-step ballistic simulation: position += velocity*dt, velocity.y -= gravity*dt, drag; CONTINUOUS collision each step by raycasting from previous to new position against world and entity hitboxes (swept sphere approximated by 3 rays or shapecast for the launcher radius); lifetime and max range; spawn at the muzzle but aimed so the trajectory intersects the camera crosshair target (solve for launch direction using the gravity drop at the crosshair-target distance, clamp to a sensible max). Sniper hit = direct damage with headshot multiplier. Launcher: on impact or timeout explode: radial damage with linear falloff to entities (via hitbox distance to nearest point), line-of-sight check for splat blocking (rays to hitbox centre), self-damage multiplier, knockback impulse applied to player velocity (PlayerSim accepts external `impulse`), destroy-by-explosion hook for props (Phase 5 consumes `ExplosionDamage` events).
- Deterministic, no allocations in the hot loop (preallocated pool of 64 projectiles).
- tests: gravity drop at known distance matches analytic value within tolerance; no tunnelling at 320 m/s through a 0.3 m wall; explosion falloff numbers.

M7 — CLIENT VIEWS, FEEL, TRAINING DUMMIES
- src/combat/WeaponView.ts: original procedural low-poly models for the five weapons + Trailpick (body, barrel, mag, stock, small glowing rarity-colored accent strip; rarity changes the accent color and adds a subtle emissive pulse for Epic/Legendary), attached to the rig's right-hand socket, holster to the back when sprinting (animated), equip/reload/fire animations procedural (recoil kick, bolt cycle, pump rack, mag drop), muzzle socket for VFX. Weapon sway lagging the camera, bob while walking.
- src/combat/ProjectileView.ts: renders projectiles (glowing streak/round), tracers via the Phase 3 BulletTracer preset, impact VFX by surface (terrain/rock/wood), explosion VFX, camera shake scaled to distance.
- src/combat/HitFeedback.ts: emits UI-bus events (`hitmarker{zone, layer, killed}`, `damageNumber`) for Phase 7; for now draws temporary in-world floating debug damage numbers (billboard sprites) so you can see the damage during this phase, plus a DOM debug line.
- Training range at the Proving Grounds (`?testarea=1`) AND a dedicated `?range=1` mode on the main spawn pad: 10 static dummies at 10/25/50/100/200 m, 4 moving dummies strafing with an analytic path, 2 armored dummies with overshield. Dummies are `Damageable` + hitbox entities using the same CharacterRig (grey material), respawn 5 s after elimination, print incoming damage layer/zone in the debug overlay. Debug commands (F8 menu): give weapon by id+rarity, give ammo, set hp/shield, kill self, toggle infinite ammo.
- Input wiring: slots 1-5, Q for harvest tool, scroll-wheel cycles, R reload, LMB fire, RMB ADS (ADS zoom per weapon: 1.2x AR, 1.1x SMG, 1.05x shotgun, 4x sniper, 1.1x launcher), sprint locks fire, hold to fire for autos. Reload cancel on slot switch.
- Locomotion integration: movement speed modifier from weapon class (set `speedModifiers`), `holsterWeapon` from sprint, firing is allowed while sliding, blocked during Mantle/Vault/Skydive/Glide.

M8 — DOCS
- ARCHITECTURE.md: combat data flow diagram, damage-layer diagram, weapon JSON schema table, event list, hitbox table, determinism rules (shot seed formula), how to add a weapon. PROGRESS.md updated with Phase 5 needs (pickups need ItemDefs/Inventory hooks).

ACCEPTANCE: all five weapons work; headshots, falloff, bloom, projectile drop and explosion behave per the tables; Overshield shatters (event fires) and regenerates after 5 s; tests pass; 60 fps with 14 dummies and automatic fire. No placeholders. Report any baseline values you changed and why.
````

## 4B. PART B — Weapon tuning JSON + balance report (Sonnet)

````
PHASE 4B (tuning only; do NOT change TypeScript logic except the new tool). Read CLAUDE.md and ARCHITECTURE.md (weapon JSON schema section). Tasks: (1) Create tools/balance-report.ts (run with `npx tsx tools/balance-report.ts`; add tsx as a dev dependency and an npm script `balance`) that loads src/shared/data/weapons.json and prints, per weapon and rarity: DPS (sustained incl. reload), burst DPS, TTK against 100 HP, against 100 HP + 100 shield, and against full 250 effective HP (100/100/50 overshield) at 10 m, 30 m, 60 m for hitscan; headshot TTK; shots to kill; mag dump damage; also a matrix of "who wins" for each weapon vs each weapon at 15 m and 40 m assuming 60% accuracy. Output as a markdown table to tools/BALANCE.md. (2) Using that report, tune ONLY numbers in weapons.json so that: Scatterback wins inside 10 m, loses beyond 25 m; Hummer-12 wins 10-25 m close-mid; Vireo Carbine is the best all-rounder 20-60 m; Longsight one-shots nothing at Common vs full 250 EHP but is a two-shot threat at Legendary headshot; Thumper is a strong area-denial tool but the worst in a 1v1 at 15 m. Every rarity step must be a strict improvement (no tier regresses) but a Common Vireo must not lose to a Legendary Hummer-12 at 40 m. (3) Keep all five rarities of every weapon present, valid against the existing JSON schema, and rerun `npm test` and `npm run typecheck`. (4) Write the final numbers table into ARCHITECTURE.md under "Weapon balance (v1)" and update PROGRESS.md. No placeholders; show before/after for the changed numbers.
````

## 5. Browser Verification Checklist
1. Open `/?range=1`: F8 → give each weapon at Common and Legendary. Dummies at 10/25/50/100/200 m: AR spray shows bloom growth; shotgun is lethal at 8 m and weak at 30 m; headshots show larger debug numbers.
2. **Sniper/Launcher ballistics:** shoot the 200 m dummy with the Longsight aiming dead-on: there should be visible travel time and a small drop (rounds land low unless compensated by the aim-solve); Thumper explodes with splash, damages you at your feet (50%) and knocks you back.
3. **Overshield:** take damage from a dummy-simulated hit (F8 set hp/shield or shoot yourself with the launcher): overshield depletes first, shatter VFX fires, and it recharges ~5 s after the last hit; the recharge delay resets if hit again.
4. **Inventory:** keys 1–5 swap; reload cancels on switch; sprint holsters the weapon and blocks fire; picking more than 5 items is not possible yet (Phase 5) but `F8 give` respects the stack and ammo caps.
5. FPS ≥ 60 with all dummies and full-auto fire; `npm test` passes (combat + ballistics).

## 6. Debug / Recovery Mini-Prompt
````
Phase 4 combat bug: [symptom, e.g. "shotgun pellets all hit the same spot", "overshield never regenerates", "sniper shots land high"] — weapon [id/rarity]. Read ARCHITECTURE.md (combat sections). Write a failing vitest in tests/combat.test.ts or tests/ballistics.test.ts that reproduces it with fixed seeds and dt=1/60, fix the root cause in src/shared/combat/* (never in the view), verify determinism (same seed => identical results), then update the weapon/hitbox tables in ARCHITECTURE.md if any constant changed. No placeholders.
````

---

# PHASE 5 — Loot Chests, Floor Loot Beams, Consumables (Cast Times), Destructible Props & Procedural Web Audio SFX

## 1. Scope
Part A: deterministic loot placement from the match seed, glowing chests (with harmonic hum), floor loot with rarity beams, pickup/swap/drop flow, ammo, consumables with cast-time progress and cancel rules, destructible environment props (harvest tool + weapons + explosions) dropping loot and scrap, a small upgrade bench that spends scrap. Part B: the whole procedural Web Audio engine and SFX bank (no audio files).

## 2. Model & Settings Command
````
# PART A
/clear
/model claude-opus-5-5
/effort medium           # high if Claude struggles with the destructible instancing logic
# PART B (after Part A passes and is committed)
/clear
/model claude-sonnet-5-5
/effort medium
````
**Quota impact:** Part A MEDIUM–HEAVY, Part B MEDIUM (many small synth recipes).

## 3. Pre-Flight Check
Phases 1–4 committed. Must exist: `src/shared/inventory/{InventorySim,ItemDefs}.ts`, `src/shared/data/{weapons,consumables}.json`, `src/shared/combat/{HealthSim,WeaponSim,Ballistics}.ts`, `src/shared/world/PropPlacement.ts` (colliders + destructible flags), `src/vfx/presets/{LootSparkles,Debris,Dust}.ts`, `src/shared/rules/Events.ts`, `src/core/EventBus.ts`.

## 4A. The Real Copy-Paste Prompt — PART A (Opus)

````
PHASE 5A of 8 for Driftglass: loot, consumables, destructibles. Read CLAUDE.md, ARCHITECTURE.md, PROGRESS.md and obey CLAUDE.md (all authoritative logic in src/shared, seeded Rng only, no placeholders/TODOs, verify library APIs, original IP only). Milestones M1..M7 with typecheck/test and PROGRESS.md ticks after each.

M1 — LOOT DATA & PLACEMENT (src/shared/data/loot_tables.json, src/shared/world/LootPlacement.ts, src/shared/inventory/LootSim.ts)
- loot_tables.json: weighted tables per source: floorLoot(tier 1..3), chest(tier 1..3), supplyCrate, destructible(wood crate, barrel, shed, stone cache). Each entry {itemId, rarityWeights[5], quantity range}. Tier raises rarity weights (tier 1: C 55/U 30/R 12/E 3/L 0; tier 3: C 10/U 25/R 35/E 22/L 8). Chests guarantee 1 weapon + 1 consumable + ammo; floor loot is a single item or ammo stack; ammo stack sizes match the weapon family (e.g. medium 30, shells 8, rockets 2).
- LootPlacement.ts (pure, from island.json POIs + seed): positions chests inside buildings/at designated spots (rotation facing the open side), floor loot spawns around POIs and open areas, weights by POI tier; counts target ~80 chests and ~350 floor items on the island; avoid spawning inside colliders (validate with PhysicsWorld overlap tests at generation time); outputs stable entity ids (`chest:<n>`, `floor:<n>`).
- LootSim.ts: authoritative state of all loot entities: chests {id, pos, opened}, floor items {id, itemInstance, pos, ownerless, spawnedAt}, `openChest(id, actor)` (spawns its drops with a deterministic arc/scatter so they pop out in a fan and settle on terrain, via simple ballistic arc + ground snap, no rigid body), `pickup(id, actor)` / `dropItem(actor, slot)`, `spawnDeathLoot(actor)` (drops the whole inventory; used in Phase 6), id allocation counter in state, event emission (`ChestOpened`, `LootSpawned`, `LootPicked`, `LootDropped`). Interaction rules: range 2.2 m, facing cone 75 degrees, closest valid target wins, cannot interact while mantling/sliding/gliding/casting.
- tests/loot.test.ts: determinism of placement from seed, no loot inside colliders, rarity distribution within tolerance over 10k rolls, chest guarantee, pickup/swap/drop flow with full inventory, ammo stack merging, pickup range/cone.

M2 — CHESTS (src/loot/ChestView.ts, src/shaders/LootBeam.ts)
- Original chest model ("Glimmer Cache"): an iron-banded crate with a hinged lid, emissive gold seam, an inner glow, and a floating light motes particle effect (LootSparkles) when closed; lid opens with a spring animation when interacted (hold E for 0.6 s with a small radial progress ring; Phase 7 will skin it); after opening, glow turns off and the lid stays open; contents pop out with a light burst and a rarity-colored pillar on each item.
- A subtle glowing PULSE on the chest body is visible from 60 m (bloom picks it up); chests are interactable via the shared LootSim.
- Chest harmonic hum is an AUDIO feature wired in Part B: here only expose `ChestView.audioHandle` with world position and a `hum` hook the audio engine subscribes to via the EventBus (`ChestProximity{chestId, distance}` events fired when the player is within 35 m, throttled to 10 Hz).

M3 — FLOOR LOOT & RARITY BEAMS (src/loot/LootView.ts, src/loot/BeamView.ts)
- Each floor item renders: a recognisable procedural model (weapon silhouettes from Phase 4 WeaponView at 0.6 scale lying flat, ammo box with a colored band by type, consumable props: bandage roll, kit box, cell bottles) slowly rotating and bobbing; a rarity-colored vertical LIGHT PILLAR (TSL additive beam shader with soft edges, vertical gradient fade, scrolling noise, billboard-free cylinder) whose height and intensity scale with rarity (Common ~2 m faint ... Legendary ~14 m strong with sparkles), visible and distance-faded up to 120 m; a ground ring decal pulses. Use ONE instanced mesh per item type + ONE instanced beam mesh with per-instance color/height; cull beyond 120 m; cap visible beams at 300 via nearest-first selection.
- Pickup UX data (no HUD yet; use the debug DOM overlay): when the nearest interactable is in range show a world-space prompt "[E] Pick up Vireo Carbine (Epic)" with rarity color, and a compare line (current slot weapon vs new). Auto-pickup ammo and consumable stacks that fit when walking over them (configurable). HOLD E to swap with the currently equipped slot when the hotbar is full.
- Dropping: key G drops the current slot (item pops forward with an arc); death loot uses the same code.

M4 — CONSUMABLES WITH CAST TIMES (src/shared/inventory/ConsumableSim.ts)
- Pure state machine `ConsumableSim`: `start(slot)` allowed only if the item is useful (e.g. Patch Wrap only if hp < 75; Spark Cell only if shield < 50; Bulwark Cell only if shield < 100; Field Kit only if hp < 100) and the actor is not gliding/skydiving/mantling; progress advances at fixed dt; effect applies on COMPLETION (heals are not gradual); cancel ONLY on: switching to another slot, starting a mantle/vault/slide/skydive/glide, or death. Jumping, firing and taking damage do NOT cancel. Movement speed modifier while casting 0.6 (via `speedModifiers`). Emit `CastStarted{item,duration}`, `CastProgress{t}`, `CastCompleted`, `CastCancelled{reason}` events; consume one stack unit only on completion; clamp to caps (Patch Wrap heals to at most 75 HP).
- Expose `progress01` and `duration` for the HUD cast bar (Phase 7). For now render a temporary DOM progress bar under the debug overlay.
- Pocket item slot (modern flag): implement ONE working pocket utility, "Hush Bubble" (a short-lived 4 s, 3 m radius dome that blocks incoming hitscan/projectile damage for those inside; mesh = translucent hex dome shader; 20 s cooldown, key V) fully functional in shared sim and view. It proves the slot API; do not add other pocket items.
- tests/consumables.test.ts: every item's math, caps, cancel rules, cannot-start rules.

M5 — DESTRUCTIBLE PROPS (src/shared/world/Destructibles.ts, src/loot/DestructibleView.ts)
- Shared authoritative `DestructibleSim`: every destructible registered from PropPlacement and buildings gets {id, kind, hp, maxHp, material: wood|stone|metal|leaf, lootTable, scrapRange, pos, colliderHandle}. Kinds: Tree (hp 300; falls as a unit toward the hit direction), Boulder (hp 400), Wooden crate (hp 60), Barrel (hp 40; the red-orange "Fuel Barrel" variant explodes: radial 60 damage to everything in 5 m, chains to other barrels, deterministic), Fence/Shed wall panels (hp 120; shed removes the panel and its collider), Stone cache (hp 150). Damage sources: Trailpick (50 dmg, 2x on sweet-spot hit — the weak point moves along the object; implement a timing indicator: a point oscillates along a vertical range at 1.6 Hz and a hit within 0.12 of its position is a critical, hit cadence 0.55 s), weapons (Environmental damage multiplier from weapons.json `structureDamage`, default 0.6 for bullets, 1.0 for splash), explosions. Destroying emits `PropDestroyed{id,kind,pos,dir,material}` and rolls the loot table and scrap; spawns floor loot via LootSim.
- View: instanced props hide a destroyed instance (write zero-scale to the instance matrix, update only the changed range), collider removed from PhysicsWorld; destruction plays: Trees = procedural fall animation (rotate about the base over 1.1 s with slight bounce + leaf burst + dust), Boulders = break into 5-8 rock chunks flying out (pooled dynamic visual-only chunks with ballistic motion, max 64 alive, despawn 6 s, with Debris VFX), crates/barrels burst into planks/staves, sheds drop a panel. Hit feedback on each non-lethal hit: shake + sparks + material-specific dust. All visuals driven purely by the events.
- Environmental cover hardening option: RulesConfig `coverDamageMult` (default 0.6) scales bullet damage vs props.

M6 — SCRAP & TINKER BENCH
- Scrap (resource) is dropped by props (wood crate 5-10, barrel 8-14, shed 15-25, stone cache 20-30), picked up automatically as small glowing chips, tracked in `InventorySim.scrap` (cap 999). 
- "Tinker Bench": 12 spawned across the island next to chests/at POIs (deterministic). Interaction (hold E 0.6 s) upgrades the currently equipped WEAPON by exactly one rarity tier for the cost from `consumables.json`/`rules` (Common->Uncommon 75, ->Rare 150, ->Epic 250, ->Legendary 400 scrap), preserving magazine ammo ratio, with a visual flash + sound event. A bench cannot upgrade Legendary. Fully testable in tests/loot.test.ts.

M7 — INTEGRATION, DEBUG, DOCS
- Loot density debug overlay (F10): toggles all beams on/off, shows counts by rarity, teleports to nearest chest / nearest bench.
- All new events routed through EventBus for Phase 5B audio and Phase 7 HUD. Performance: 60 fps with all island loot loaded; report draw calls and the beam instance cap.
- Update ARCHITECTURE.md (loot flow diagram, interaction rules table, consumable table, destructible table, event list, loot-table schema) and PROGRESS.md.

ACCEPTANCE: open chests, pick up/swap/drop loot, use every consumable with cast bars and correct caps, destroy every prop kind and see drops, upgrade a weapon at the bench, all deterministic from the seed, tests pass, no placeholders. Report any value changes.
````

## 4B. PART B — Procedural Web Audio SFX (Sonnet)

````
PHASE 5B of 8 for Driftglass: procedural audio. Read CLAUDE.md, ARCHITECTURE.md (event list) and PROGRESS.md. Hard rules: NO audio files, NO external libraries — everything is synthesized at runtime with the Web Audio API (AudioContext, OscillatorNode, noise via AudioBuffer, BiquadFilter, GainNode, DynamicsCompressor, ConvolverNode with a generated impulse response, PannerNode (HRTF) or StereoPanner for positional sources). No placeholders/TODOs. Respect browser autoplay policy (create/resume the context on the first user gesture, the click-to-play overlay). Milestones M1..M5; typecheck + `vite build` after each; tick PROGRESS.md.

M1 — ENGINE (src/audio/AudioEngine.ts)
- Master graph: sources -> category buses (sfx, weapons, ambient, ui, music-unused) -> master gain -> soft-clip DynamicsCompressor -> destination. Volume setters per bus (0..1) persisted in the settings store later (expose `setBusVolume(bus, v)`). Listener follows the camera each frame (position + orientation). A tiny generated-IR reverb send (outdoor: short and dark; indoors = inside any building footprint from island.json -> room reverb). Voice limiter: max 48 concurrent one-shots, steal the oldest lowest-priority voice. Distance model: inverse with rolloff, cutoff low-pass by distance for far shots. `Doppler` none.
- API: `play(soundId, {position?, volume?, pitch?, bus?})`, `playLoop(soundId, opts) -> handle{setPosition,setVolume,setPitch,stop}`, `stopAll()`, `setListener(...)`.

M2 — SYNTH PRIMITIVES (src/audio/Synth.ts)
- Reusable builders: noise (white/pink/brown), ADSR envelope helper, FM/AM oscillator pair, filtered noise burst, pitched thump (sine with exponential pitch drop), metallic click (band-passed noise + short ring), "whoosh" (noise + sweeping band-pass), harmonic stack (additive partials with detune), simple convolver IR generator. Seeded variation (`Rng` from src/shared) is NOT allowed to influence game state: use a separate non-shared Math.random-based variation only in src/audio.

M3 — SFX BANK (src/audio/SfxBank.ts): one synthesized recipe per sound id with 3-4 randomized variations (pitch +-6%, filter +-10%) to avoid repetition:
- Weapons by class: Vireo Carbine (punchy mid crack + body thump + short tail), Scatterback (heavy boom, low shelf, rack/pump sound on cycle), Hummer-12 (tight high clicky burst), Longsight (sharp supersonic crack + long low tail + bolt cycle), Thumper (launch thoomp + whistling flight loop + big explosion with sub-bass and debris crackle), Trailpick swing/hit (wood/stone/metal variants). Distance variants: close and far (low-passed, delayed by distance/343 m/s up to 0.6 s for a physical delay feel). Reload (mag out, mag in, bolt), dry-fire click, equip, weapon-swap.
- Impacts: bullet impact by material (dirt, rock, wood, metal, water), body hit thud, headshot "tick", ricochet zing, player hit-marker sounds (normal tick, headshot sharper ping, shield-hit blue chime, kill confirm double-tone).
- Shield/overshield: shield-break glassy crack + rising shimmer (distinct from overshield-break which is a deeper metallic "ring + whoosh" with a downward sweep), overshield-recharge rising hum loop, damage-taken low thud with a directional hint, low-health heartbeat (loop, 1.3 Hz, intensity via filter).
- Movement: footsteps by surface (sand, grass, rock, wood, metal, water-splash) at run/sprint/crouch intensities, jump grunt-less whoosh, landing thump scaled by impact speed, slide loop (filtered noise with pitch tied to speed), mantle effort + hands-on-ledge scuff, glider deploy snap + wind loop (intensity from airspeed), skydive wind roar loop.
- Loot & interaction: chest HARMONIC HUM loop (additive harmonic stack with slow detune and a shimmering amplitude LFO; panner position at the chest; audible up to 35 m via the `ChestProximity` events, volume curve eased; stops when opened), chest open (creak + magic sparkle arpeggio), pickup sounds by rarity (Common soft click up to Legendary rising 4-note chime with shimmer), item drop, bench upgrade (anvil-like metallic clink + rising whoosh), scrap pickup tick.
- Consumables: Patch Wrap rustle loop, Field Kit zip/click, Spark Cell + Bulwark Cell bubbling/charge-up risers matched to cast duration, completion chime, cancel "fizzle".
- Destruction: wood crack/splinter, stone crumble, barrel burst, explosion (layered), tree fall creak + thud.
- Match/UI placeholders used by later phases but implemented now: storm ambience loop (low rumble + distant crackle, volume by proximity to the wall, harsher inside the storm), storm tick damage zap, bus engine hum loop (for Phase 6), countdown beeps, elimination sting, "last one standing" fanfare (short synthesized triumphant chord progression, original), UI click/hover/confirm/error.
- Ambience (src/audio/Ambience.ts): wind bed varying with altitude and time of day, bird/insect chirps (random synthesized events with day/night swap), ocean wash near the coast (distance to shore from the shared heightmap), foliage rustle scaled by wind strength.

M4 — WIRING (src/audio/SfxBank.ts, src/core/Engine.ts)
- Subscribe to EventBus events (ShotFired, ShotHit, DamageTaken, OvershieldBroken, ShieldBroken, Eliminated, Land, SlideStart/Loop/End, mantle/vault events, glider events, ChestProximity, ChestOpened, LootPicked, LootDropped, Cast*, PropDestroyed, ExplosionDamage, FootstepEvent, etc. — read src/shared/rules/Events.ts for the real names) and map each to sounds with correct positions (3D for world events, 2D for self-UI). Footstep cadence comes from the shared Footstep events (do not invent your own timing). Local player's weapon sounds are non-positional; remote/other entities are positional.
- Audio debug panel (F11): list of every sound id with a play button, bus sliders, active voice count, a test of 40 simultaneous explosions to verify the limiter and compressor (no clipping).

M5 — DOCS
- ARCHITECTURE.md audio section (graph diagram, bus table, sound-id catalogue, event->sound map, how to add a sound); PROGRESS.md.

ACCEPTANCE: zero audio files in the repo; every sound id plays from the F11 panel without clipping (master peaks < -1 dBFS via the compressor); chest hum fades in/out with distance and pans correctly; footsteps change by surface; nothing plays before the first user gesture; typecheck and build pass.
````

## 5. Browser Verification Checklist
1. **Loot flow:** run to Pinecrest Outpost: rarity pillars visible from far away (Legendary tallest); open a chest (hold E, lid animation, items pop out in a fan); swap at full hotbar; G drops items; ammo auto-picks up.
2. **Consumables:** damage yourself to 40 HP (F8) and use a Patch Wrap: 3 s cast bar, move speed reduced while casting, switch slots to cancel (no stack consumed), heals cap at 75; Spark Cell refuses to start at ≥ 50 shield.
3. **Destruction:** harvest a tree (sweet-spot crit on the moving marker), shoot a Fuel Barrel next to a crate for a chain explosion, break a boulder; loot and scrap drop, trees visibly fall, FPS stays ≥ 60.
4. **Bench:** collect ~75 scrap, upgrade a Common weapon: tier changes and rarity color updates on the in-hand model.
5. **Audio:** after the click-to-play gesture you hear: the chest hum from ~35 m, footsteps changing between sand/grass/rock, distinct shield-break vs overshield-break sounds, no clipping during the F11 explosion stress test.

## 6. Debug / Recovery Mini-Prompt
````
Phase 5 bug: [symptom: e.g. "loot spawns inside a building wall", "consumable cast doesn't cancel on slot switch", "destroyed tree collider remains", "no sound after first click", "chest hum doesn't stop"]. Read ARCHITECTURE.md. For logic bugs (loot/consumables/destructibles): write a failing test in tests/ first, fix in src/shared, keep determinism from the seed. For view/audio bugs: reproduce via the F10/F11 debug panels, log the event stream, find the root cause (check the AudioContext state / instance matrix updates), fix, and note it in PROGRESS.md. No placeholders.
````

---

# PHASE 6 — Battle Royale Loop: Bus Drop, Shrinking Storm Wall Shader, Mini-Map, Bots, Victory ("Last One Standing") Screen

## 1. Scope
Part A: shared match state machine (lobby → bus → drop → in-progress → ended), the battle bus flight and ejection, drop/glide integration, the multi-stage storm model (deterministic circles, tick damage) plus the storm wall shader and storm post-effect, shared-code bot AI that plays through the real sim (so it will run on the server later), death/elimination flow with loot drop and spectating, placement tracking. Part B: minimap, full-screen map overlay, kill feed, alive counter, and the end screen.

## 2. Model & Settings Command
````
# PART A
/clear
/model claude-opus-5-5
/effort high
# PART B (after Part A passes and is committed)
/clear
/model claude-sonnet-5-5
/effort medium
````
**Quota impact:** Part A HEAVY (bots are the risk: reserve a window), Part B LIGHT–MEDIUM.

## 3. Pre-Flight Check
Phases 1–5 committed. Must exist: all of `src/shared/{sim,combat,inventory,world}`, `src/shared/world/Destructibles.ts`, `src/shared/inventory/{LootSim,ConsumableSim}.ts`, `src/vfx/presets/StormLightning.ts`, `src/render/RenderPipelineFX.ts` (storm post hook), `src/audio/*` (storm/bus sounds exist), `src/shaders/`, the island data with the Launch Isle.

## 4A. The Real Copy-Paste Prompt — PART A (Opus)

````
PHASE 6A of 8 for Driftglass: the battle royale loop. Read CLAUDE.md, ARCHITECTURE.md, PROGRESS.md and obey CLAUDE.md (shared-sim purity: MatchSim, StormModel, BotBrain are all pure src/shared code driven by the same InputFrames as a human; seeded Rng only; no placeholders/TODOs; verify library APIs; original IP only). Milestones M1..M8 with typecheck/test and PROGRESS.md ticks after each.

M1 — MATCH STATE MACHINE (src/shared/match/MatchSim.ts, Placement.ts, rules/RulesConfig.ts additions)
- Phases: Lobby (players free-roam on Launch Isle with the training range open; countdown starts when `minPlayers` met or the host presses Start; for offline: auto-start 20 s after the player clicks Play), BusFlight, InProgress, Ended. A single `MatchSim.step(dt)` owns timers; clean serialisable `MatchState` (phase, tick, seed, aliveCount, placements, kills per entity, storm state, bus state).
- Entities: `PlayerEntity` (human or bot) with PlayerState + HealthSim + Inventory + WeaponSim + ConsumableSim + stats (kills, damageDealt, spawnTick, deathTick, placement). `MatchSim` steps all entities each tick in a stable order (sorted by id) so the result is deterministic.
- Config: `matchSize` (default 24 for offline testing; supports up to 100), `botFill` true, `teamSize` 1 (reserved field). Placement = aliveCount at the time of death + 1; winner = last alive.
- Deaths: on `Eliminated` -> drop all loot via LootSim.spawnDeathLoot, record killer, apply modern overshield siphon, emit `PlayerEliminated`, switch the dead human to Spectator; match ends when alive <= 1 -> `MatchEnded{winnerId, stats}`.
- tests/match.test.ts: full headless 60-second simulated match with 12 bots, no human, completes without exceptions and with deterministic final placements for the same seed (run twice and compare), no NaNs, phases advance on schedule.

M2 — BATTLE BUS & DROP (src/shared/match/BusPath.ts, src/match/BusView.ts)
- Bus path from the seed: a straight line across the island passing within 400 m of the centre, flight altitude 250 m, speed 45 m/s, length = island span + 200 m each side (~75 s). Players "board" at the start (their positions snapped into the bus, hidden). The human sees a bus-cam (free look around the bus, pointer lock) with a prompt to jump; pressing JUMP ejects the player at the bus position with the bus velocity as initial horizontal velocity and Skydive state (Phase 2). Auto-eject at the end of the flight path. Bots eject at randomized points biased toward POIs by weight.
- Original bus: a boxy "Cargo Zeppelin" (cigar-shaped envelope with panels, propellers spinning, gondola) with a soft engine hum; flight shows its shadow on the island below. Dropping players leave streak trails (small VFX).
- Free-fall -> glider auto-deploy at 120 m (Phase 2), landing logic as before; "dropped" flag; first 3 seconds after landing grant no spawn protection (explicitly none).

M3 — STORM MODEL (src/shared/match/StormModel.ts, src/shared/data/storm.json)
- Data-driven phase table (10 circles; tunable). Example baseline (radius m / wait s / shrink s / damage per second): 
  1: 1100 / 90 / 80 / 1; 2: 750 / 75 / 70 / 1; 3: 500 / 60 / 60 / 2; 4: 320 / 55 / 50 / 5; 5: 200 / 45 / 40 / 8; 6: 120 / 35 / 35 / 10; 7: 70 / 30 / 30 / 10; 8: 35 / 25 / 25 / 10; 9: 12 / 20 / 20 / 10; 10: 0 / 0 / 20 / 10.
  Initial circle centre = a random point within the island such that the circle fits mostly on land; each subsequent centre is chosen with the seeded Rng so the next circle lies fully inside the current one (target offset up to radius_prev - radius_next). The first circle appears 60 s after the bus finishes (config).
- `StormModel.step(dt)` -> {currentCenter, currentRadius, targetCenter, targetRadius, phaseIndex, state: "waiting"|"shrinking", timeLeft, damagePerSecond}; interpolates centre/radius linearly (or smoothstep) during shrink. `isOutside(pos)`. `StormDamageSim`: damage ticks once per second to every alive entity outside (percent-of-max-health style: dps value applied as absolute points), applied to health layers like any damage with attacker = null, source "storm". `debugTimeScale` config (default 1; ?stormscale=4) to test quickly. A `fastMatch` rules preset (all waits and shrinks x0.4) for testing.
- tests: monotone shrink, next circle inside current, damage cadence, determinism per seed, time scale.

M4 — STORM VISUALS (src/shaders/StormWall.ts, src/match/StormView.ts, post-effect)
- Storm WALL: a tall (400 m) open cylinder mesh with ~256 radial segments centered on the current circle, radius animated each frame. TSL material: translucent magenta-violet energy wall: vertical gradient (bright base, fading to the top), scrolling fbm noise layers in two directions, bright vertical filaments, fresnel edge glow when viewed at grazing angles, soft intersection fade with terrain using depth (soft particles on the near-ground band), emissive for bloom, double-sided; inside surface darker. Back-face and front-face parity handled so it looks right from inside and outside.
- The DANGER ZONE beyond the wall: the world outside the safe circle gets a violet fog tint and slightly lower exposure (blend in the sky/fog uniforms based on the camera's signed distance to the wall), rain-of-embers particles (StormEmbers preset) in the zone, StormLightning bolts striking randomly outside the wall (deterministic count/time from seed is NOT needed: visual only, use a view-side RNG) with a flash on the sky and a delayed thunder sound event.
- Post effect: when the local player is OUTSIDE the safe zone, drive the Phase 3 `storm` hook: desaturate to 35%, noise grain, stronger vignette, a subtle purple tint pulsing with the damage tick, plus camera shake on each tick; fade in/out over 0.6 s.
- The NEXT circle is shown as a thin white-ish ring on the ground (a flat ring mesh with animated dashes) at the target radius, visible from afar, plus a world-space "safe zone" beam at the target centre (tall faint white beam) so you can find the safe area; both hide on the final circle. Also expose the data to the minimap (Part B).
- Performance: wall + zone effects cost < 1 ms; works on both backends.

M5 — BOT AI (src/shared/ai/BotBrain.ts, BotPerception.ts, src/match/BotRunner.ts)
- Bots are ordinary PlayerEntities fed InputFrames from `BotBrain.decide(botState, view, dt, rng)`, running through the SAME PlayerSim/WeaponSim/Combat code as humans (this is what lets the server host bots in Phase 8). BotBrain is pure and deterministic (own Rng stream per bot). BotRunner (client) is only a wrapper that calls the shared code.
- Perception (BotPerception.ts): visible enemies if within view cone (110 deg) + line-of-sight raycast, hearing of gunshots within 80-150 m (from `ShotFired` events) giving a noisy direction, notices loot within 25 m, knows the storm state.
- State machine / utility AI: DROP (choose a landing spot by POI weight; steer skydive/glide toward it; deploy glider timing), LOOT (go to nearest chest/floor weapon scoring by rarity and need; open/pick up/equip best weapon by score, keep ammo, use healing when hp < 60 or shield < 40 and no enemies), ROTATE (move to the next safe circle, sprint when outside, use slide on slopes opportunistically), ENGAGE (face the target, ADS, burst-fire patterns, strafe left/right on a randomized period, crouch occasionally, reload behind cover heuristically = when no enemy visible, throw away if low health -> FLEE), FLEE/HEAL (retreat out of LOS, cast a heal), HARVEST (rare, ignores), STORM_ESCAPE (highest priority if outside).
- Locomotion: steering with look-ahead raycasts (3 rays: forward, left, right) to avoid obstacles; jump over low obstacles (shape-cast to detect), mantle via the same MANTLE_OR_GLIDE input when the probe from Phase 2 finds a ledge in the movement direction; stuck detection (moved < 1 m in 2 s -> pick a new waypoint / jump / reverse); no navmesh required, but waypoints are placed on terrain via heightAt with slope penalty. Water avoidance via isWater.
- Skill model: reaction time 0.25-0.6 s, aim error (angular noise decays as they track), aim-turn speed limit, accuracy per difficulty (Easy/Normal/Hard in RulesConfig `botDifficulty`), bots never wallhack and never exceed human fire rates; they use the same bloom/recoil model.
- Performance: AI decisions at 10 Hz per bot (staggered by id), simulation at 60 Hz; 50 bots must keep total sim time < 6 ms/tick at Medium on a mid-range laptop; measure and report, add an LOD for far bots (skip LOS checks beyond 200 m from every human, simplified steering).
- tests/bots.test.ts: bots loot, rotate and fight in a headless 90 s fast match; at least one elimination occurs; no bot gets stuck (> 10 s without moving) in a 5-seed sweep; same seed => identical outcome.

M6 — ELIMINATION & SPECTATING (src/match/Spectator.ts)
- When the human dies: slow-motion 1 s with desaturation, loot drop, elimination banner data (killer name, weapon, distance, headshot), then Spectator: third-person follow cam of the killer or any alive entity, cycle with LMB/RMB, free camera option, shows their health. When the human wins: camera orbit.
- Bot/player names from an original name generator (shared, seeded): "Kestrel", "Nimbus", "Tally", "Moss", ... 200 original names.

M7 — OFFLINE GAME FLOW (src/match/MatchController.ts, src/core/Engine.ts)
- Start menu (minimal DOM, Part B skins it): Play button, seed field, bot count slider (0-99), difficulty selector, fast-match toggle. Flow: Lobby on Launch Isle (training range + weapons rack with test weapons) -> countdown -> bus -> drop -> match -> end -> "Play again" re-seeds and resets everything (full teardown of loot/props/entities/VFX with no leaks: verify by looping 3 matches headless and checking object counts / geometry counts in renderer.info stay flat).
- Pause menu (ESC) with Resume / Leave match / Controls (shows the key list). No dead buttons: the full Settings menu arrives in Phase 7.
- Rules/URL flags: `?bots=`, `?seed=`, `?fast=1`, `?stormscale=`, `?skipbus=1` (spawn directly at a random POI with starter loadout for testing), `?god=1`.

M8 — DOCS: ARCHITECTURE.md (match state diagram, storm table, bot FSM diagram, entity list, flow diagram, shared-vs-client map showing exactly what Phase 8 will host on the server), PROGRESS.md.

ACCEPTANCE: a full match against bots can be played start to finish from the Play button: bus, drop, loot, fights, storm circles shrinking with damage, elimination or victory, restart. Headless bot-only matches are deterministic. 50 bots keep >= 45 fps at Medium. No placeholders. Report perf numbers and tuned AI constants.
````

## 4B. PART B — Minimap, Map Overlay, Kill Feed, End Screen (Sonnet)

````
PHASE 6B of 8 for Driftglass: match UI. Read CLAUDE.md, ARCHITECTURE.md and PROGRESS.md. Hard rules: UI is vanilla TypeScript + DOM/CSS (no framework) in src/ui/, driven by a small typed store `src/ui/UIStore.ts` that subscribes to shared events and MatchState; Canvas2D for maps; no placeholders/TODOs; original art direction (flat, bold, slightly rounded geometric UI, Driftglass palette: deep teal #0F2A33, warm sand #F2E3C6, signal orange #FF7A3D, storm violet #8A4BFF; font stack: system-ui, with letter-spaced uppercase labels); all text from src/shared/rules/Strings.ts. Milestones M1..M5; typecheck + `vite build` after each; tick PROGRESS.md.

M1 — UIStore + MAP BASE TEXTURE (src/ui/UIStore.ts, src/ui/map/MapRenderer.ts)
- UIStore: tiny observable store (get/set/subscribe with selector support), fed by an adapter that reads MatchState each render frame (throttled to 15 Hz for the HUD) and by EventBus events.
- MapRenderer: renders a top-down base map ONCE per seed into an offscreen canvas (2048x2048 for the full map): per-pixel color from the SHARED heightmap + biome map (sea gradient, beach, grass, forest, rock, shaded relief with a light from the NW), POI labels (name, tier dot), roads/paths between POIs (simple generated polylines, seeded), the Launch Isle inset. Cache it; regenerate on seed change. A worker is optional; do it on idle slices (requestIdleCallback in chunks) so it never causes a long frame.

M2 — MINIMAP (src/ui/map/Minimap.ts)
- 200x200 circular minimap, top-right: option "rotate with camera" (default) or north-up (setting), zoom 1x/2x (key), shows: player arrow (facing), bots/other players ONLY when firing nearby (red pulse for 2 s on a gunshot within 120 m, driven by ShotFired events: no wallhack), loot chests within 60 m (small gold dots, hide when opened), the current storm circle (white circle), the next safe circle (dashed), the storm wall as a violet filled outside region, the bus path line + bus icon during the flight phase, the player's map ping, POI names at the larger scale. Edge-clamped icons for the next-circle and pings. Redraw at 30 Hz on one canvas; no allocations in the draw loop.

M3 — FULL MAP OVERLAY (src/ui/map/MapOverlay.ts)
- M key toggles (pointer lock released while open, game keeps running in a "live map" like real BR games, with a dimmed backdrop). Pan with drag, zoom with wheel (1x-4x), shows the same overlays as the minimap plus: all POI labels, the current/next circles with their timers ("Storm shrinks in 0:42"), the bus route with a drop-marker you can place (click) which becomes a waypoint beam on the minimap/compass, ping markers (right-click to set/clear, one active ping, shown as a beacon on the minimap + 3D world beam in the main view), player position + facing. During the BusFlight phase the map opens by default and the "drop here" marker is highlighted.

M4 — KILL FEED, ALIVE COUNTER, ELIMINATION & END SCREENS (src/ui/hud/KillFeed.ts, AliveCounter.ts, EliminationBanner.ts, EndScreen.ts)
- Kill feed (top-left, under the alive counter, max 5 entries, 6 s lifetime, fade): "Killer [weapon icon, rarity-colored] Victim" with headshot skull icon, storm kills show a storm icon, the local player's name highlighted, slide-in animation. Weapon icons are generated inline SVG (original, simple silhouettes for the five weapons + storm + fall).
- Alive counter: top-right under the minimap a small people icon drawn as inline SVG + number with a punch animation on change, and eliminations counter with the same style.
- Elimination banner: center-top toast "ELIMINATED <name>" for the local player's kills (+ distance and weapon, headshot flair).
- Death screen overlay: "YOU WERE ELIMINATED" with placement "#7 of 24", killer name, weapon, and buttons Spectate / Leave. Wires to Phase 6A's Spectator.
- END SCREEN: when the local player is the winner, show a big original celebration: title string from Strings.ts ("LAST ONE STANDING"), animated confetti on a canvas (pooled particles), a stats panel (placement, eliminations, damage dealt, time survived, distance traveled, accuracy, headshot %), a "Play again" and "Main menu" button; for non-winners show the same stats with their placement. A short synthesized fanfare is triggered through the audio engine (id exists from Phase 5B).

M5 — START MENU & DOCS
- Skin the Phase 6A start menu and pause menu with the same visual language (Play, Seed, Bots, Difficulty, Fast match, and a Controls button that opens the key list; no dead buttons: Phase 7 adds the real Settings menu).
- Update ARCHITECTURE.md (UI architecture, store shape, map pipeline) and PROGRESS.md.

ACCEPTANCE: minimap and full map are accurate (a position on the map equals the world position within 3 m), no frame hitches when opening the map, kill feed and end screens work in a bot match, no console errors, typecheck + build pass.
````

## 5. Browser Verification Checklist
1. **Full loop:** `?bots=23&fast=1`: click Play → lobby countdown → bus flight (map open, place a drop marker) → eject → free-fall → glider → land → loot → fight → storm shrinks → die or win → end screen → Play again, without memory growth (watch renderer.info geometries/textures stay flat over 3 matches).
2. **Storm:** the wall is a glowing violet cylinder with scrolling filaments; stepping outside triggers desaturation + shake + damage ticks; the next-circle ring and safe-zone beam are visible; thunder/lightning in the danger zone.
3. **Bots:** they drop at POIs, loot chests, fight each other, rotate to the circle, and heal. After 90 s in `?fast=1` there are visible eliminations and kill-feed entries. No bot stands stuck in a wall for long.
4. **Maps:** minimap rotates with the camera and shows the storm circles; M opens a pannable/zoomable full map; a ping placed there appears as a 3D beacon in the world.
5. **Perf:** with `?bots=50` the F3 overlay still shows ≥ 45 FPS at Medium and sim time per tick under ~6 ms.

## 6. Debug / Recovery Mini-Prompt
````
Phase 6 bug: [symptom: e.g. "bots freeze after landing", "storm circle ends up outside previous circle", "match never ends", "memory grows each match", "map position is offset by ~X m"]. Read ARCHITECTURE.md. Reproduce headless first: write/extend a test in tests/match.test.ts or tests/bots.test.ts with the failing seed (`?seed=<n>` from the browser), find the root cause in src/shared (keep determinism: run the same-seed-twice test), only then fix any view/UI code. Use ?stormscale=4 and ?skipbus=1 to speed up manual repro. No placeholders.
````

---

# PHASE 7 — HUD, Crosshair Bloom Dynamics, Hitmarkers, Damage Numbers, Inventory Screen & Settings Menu

## 1. Scope
The complete in-game interface, all DOM/CSS/SVG on top of the `UIStore` from Phase 6B: health/shield/overshield bars, stamina ring, hotbar, ammo, cast bar, interaction prompts, dynamic crosshair driven by the real bloom value, scope overlay, hitmarkers (health vs shield vs overshield vs headshot vs kill), world-space damage numbers, directional damage indicators, compass, storm timer banner, full inventory screen (rearrange/drop), and the Settings menu (graphics, sensitivity, keybinds, audio, gameplay, accessibility) with persistence.

## 2. Model & Settings Command
````
/clear
/model claude-sonnet-5-5
/effort medium          # drop to low for the CSS-only milestones (M1, M2, M7)
````
**Quota impact:** LIGHT–MEDIUM. Mostly DOM/CSS/TS with no new simulation logic. Break at any milestone.

## 3. Pre-Flight Check
Phases 1–6 committed. Must exist: `src/ui/UIStore.ts`, `src/ui/hud/{KillFeed,AliveCounter,EliminationBanner,EndScreen}.ts`, `src/ui/map/*`, `src/shared/combat/Spread.ts` (current bloom value), `src/shared/sim/StaminaSim.ts`, `src/shared/inventory/ConsumableSim.ts` (exposes `progress01`), `src/combat/HitFeedback.ts` (emits `hitmarker`/`damageNumber` UI events), `src/core/Input.ts` (rebindable action map), `src/core/Quality.ts`, `src/audio/AudioEngine.ts` (bus volumes), `src/shared/rules/Strings.ts`.

## 4. The Real Copy-Paste Prompt

````
PHASE 7 of 8 for Driftglass: HUD and settings. Read CLAUDE.md, ARCHITECTURE.md (UI section, event list, Spread/bloom API) and PROGRESS.md. Hard rules: vanilla TypeScript + DOM/CSS/inline SVG only (no frameworks, no UI libraries); all state flows through src/ui/UIStore.ts; NEVER read simulation state mid-tick in a way that allocates per frame (HUD updates at 30 Hz max, crosshair and damage numbers at render rate); no placeholders/TODOs; all strings from src/shared/rules/Strings.ts; art direction as in Phase 6B (Driftglass palette: deep teal #0F2A33, sand #F2E3C6, signal orange #FF7A3D, storm violet #8A4BFF); rarity colors come from the shared rarity constant (gray #B6BBC4, green #4CCB4A, blue #3FA7FF, purple #B05CFF, gold #FFB52E) with colorblind alternates. Milestones M1..M8; typecheck + `vite build` after each; tick PROGRESS.md.

M1 — LAYOUT, THEME, SAFE AREAS (src/ui/styles/*.css, src/ui/hud/HudRoot.ts)
- CSS variables for palette/spacing/radius; a responsive layout using CSS grid + clamp() so the HUD scales from 1280x720 to 4K; HUD scale setting (80-130%); safe margins; `prefers-reduced-motion` support; pointer-events none on the HUD except menus. Z-order: world canvas < HUD < prompts < map overlay < inventory < menus < toasts. A single HudRoot that mounts/unmounts widgets and hides everything in spectator/bus modes as appropriate.

M2 — VITALS (src/ui/hud/Vitals.ts, StaminaRing.ts)
- Bottom-left: layered bars: Overshield (gold, 50 pts, thin segmented bar ABOVE the shield bar, glows while regenerating, flashes + shatters (SVG shard animation) on `OvershieldBroken`), Shield (blue, 100), Health (green, 100) with numeric values; damage "ghost" trail (a lagging lighter bar that drains after 0.4 s), heal pulse, low-health (<25) red vignette pulse synchronised with the heartbeat sound loop, shield-break cyan flash on the bar. Every layer animates via transform/opacity only (no layout thrash).
- Stamina: a thin ring around the crosshair/character OR a bar under the vitals (setting `staminaStyle: "ring"|"bar"|"hidden"`), appears only when stamina < 100 or sprinting, fades out 1 s after full, turns orange when low and red + shake when locked (`sprintLocked`).

M3 — HOTBAR, AMMO, CAST BAR, PROMPTS (src/ui/hud/Hotbar.ts, AmmoCounter.ts, CastBar.ts, Prompts.ts)
- Bottom-right hotbar: 5 slots (+ the harvest tool slot to the left and the pocket slot when enabled) with item icons (inline SVG silhouettes for the 5 weapons, 4 consumables, ammo types; generate from small path definitions in src/ui/icons.ts), rarity-colored borders/glows, slot number badges, stack counts, equipped slot enlarged with an accent bar, a reload/cooldown sweep, empty-slot ghost, swap animation. Ammo counter next to it: "mag / reserve" with a low-ammo orange warning below 25% of mag and a red flash at zero, ammo type icon.
- Cast bar: centered below the crosshair, label ("Using Field Kit"), radial or horizontal progress from `ConsumableSim.progress01`, cancel flash on `CastCancelled`, completion pulse, speed-lines not needed.
- Prompts: world-anchored and screen-space prompts: "[E] Pick up <Item> <Rarity>" with rarity color and a compare mini-card (damage/DPS/mag deltas with green up / red down arrows), "[Hold E] Open Glimmer Cache" with a circular fill ring, "[Hold E] Upgrade at Tinker Bench (150 scrap)", bus "[Space] Jump", glider "[Space] Deploy". Scrap counter near the hotbar.

M4 — CROSSHAIR BLOOM DYNAMICS (src/ui/hud/Crosshair.ts)
- Render a crosshair per weapon class (config in weapons.json `crosshair` field, add if missing): Vireo Carbine = center dot + 4 ticks, Scatterback = 4 arcs forming a circle, Hummer-12 = small plus, Longsight = hidden while hip (tiny dot) and full scope overlay (vignette mask with fine reticle + mil dots + bullet-drop ticks) when ADS, Thumper = ring with center cross, Trailpick/none = tiny dot, consumable = hidden.
- The crosshair size is driven by the REAL spread: read `Spread.currentBloomAngle` (degrees) from the local player's WeaponSim each frame and convert to pixels using the camera's vertical FOV and the viewport height (`px = tan(angle) / tan(vfov/2) * (viewportH/2)`) so the visual gap equals the true cone; smooth the visual with a fast critically-damped follow (never lags more than 1 frame at fire rate). Animation: kick-out on each shot, shrink back with the real recovery, shrinks when ADS/crouching, expands while moving/airborne/sliding, hides while sprinting with the weapon holstered, fades while using a consumable. Color changes: white default, red when over an enemy hitbox (use a cheap hitscan from the camera each frame via the shared helper, no extra physics cost when idle: cap to 30 Hz) with a user option `crosshairColor` and `crosshairOpacity`, thickness, outline.
- Unit test (tests/ui.crosshair.test.ts) for the angle->pixel conversion math.

M5 — HITMARKERS, DAMAGE NUMBERS, DIRECTIONAL INDICATORS (src/ui/hud/Hitmarker.ts, DamageNumbers.ts, DamageIndicator.ts)
- Hitmarker (screen center X): white for a health hit, cyan for a shield hit, GOLD for overshield, thicker/orange-red on headshots, a larger red X with a short flash on a kill; 0.18 s animation (scale pop then fade), stacking-safe for shotgun pellets (one marker per shot with total damage, not per pellet), plays the matching audio ids from Phase 5B (hitmarker normal / headshot / shield / kill confirm).
- Damage numbers: world-space DOM or canvas sprites anchored at the hit position and projected each frame, pooled (max 40 alive), float up with random drift, scale by damage, color-coded (white health, cyan shield, gold overshield, yellow crit/headshot with a tiny skull glyph), merge consecutive hits on the same target within 0.35 s into a running total (shotgun = single number), setting to turn them off, and `damageNumbersStyle: "floating"|"stacked-at-reticle"`.
- Directional damage indicator: a red arc segment around the crosshair pointing to the attacker's direction relative to the camera yaw (storm/fall damage shows a full-screen edge pulse in storm violet / white), fades in 1.2 s; plus a screen-edge blood-free hit vignette (original: red-orange edge glow).
- All driven by the shared `DamageTaken`/`ShotHit` events (read src/shared/rules/Events.ts for exact names).

M6 — COMPASS, STORM BANNER, MATCH HUD (src/ui/hud/Compass.ts, StormBanner.ts)
- Top-center compass strip with cardinal/intercardinal ticks, degrees, ping marker + waypoint marker + safe-zone direction marker (violet) and distance in meters under markers; storm banner under it: "Storm closes in 0:42" / "Storm is closing" / "Phase 5: 8 dmg/s", with a pulsing violet warning when the player is outside the circle ("YOU ARE IN THE STORM") and a distance-to-safe-zone readout; countdown/start banners ("MATCH STARTS IN 5").

M7 — INVENTORY SCREEN (src/ui/menus/InventoryScreen.ts)
- Tab opens (pointer unlocked, game continues unpaused as in real BR games, input frames zeroed while open): a panel showing the 5 hotbar slots large with stats (damage, DPS, mag, reload, rarity), the harvest tool slot, the pocket slot, an ammo grid (type, count/cap with bars), consumable stacks, scrap, and a drag-and-drop area: drag between slots to rearrange (calls `InventorySim.moveSlot`), drag out of the panel to drop (calls `dropItem`), right-click context menu: Drop / Drop half stack / Use. Weapon tooltip with rarity color, stat deltas vs the equipped slot, and an inspect 3D preview (a small second render via an OffscreenCanvas or CSS-rotated SVG silhouette; pick the cheaper approach and justify it in ARCHITECTURE.md). Keyboard accessible (arrow keys + Enter + Delete).

M8 — SETTINGS MENU & PERSISTENCE (src/ui/menus/SettingsMenu.ts, src/core/Settings.ts)
- `Settings` module: typed schema with version number + migration function, load/save to localStorage in try/catch with in-memory fallback, `onChange` subscribers applied live (no reload), "Reset to defaults" per tab and global, import/export JSON.
- Tabs and controls:
  - Graphics: Quality preset (Low/Medium/High/Ultra/Custom), Render scale slider (50-100%), Dynamic resolution on/off + target FPS (30/60/90/120), Shadow quality, Cascade count, Ambient occlusion on/off, Bloom on/off, Foliage density, View distance, Anti-aliasing, Outlines, FPS counter on/off, V-sync note (browser-controlled), Renderer info (WebGPU/WebGL2 read-only) + a "Force WebGL2 (restart)" toggle that sets the URL flag.
  - Controls: Mouse sensitivity X/Y (0.05-3.0), ADS sensitivity multiplier (0.2-2.0) with an optional per-zoom-level (sniper scope multiplier), invert Y, field of view slider (60-110, applied to the base camera FOV), toggle vs hold for sprint/crouch/ADS, auto-sprint, shoulder swap default, key rebinding UI (click a row -> "press a key", conflict detection with swap/clear, Esc cancels, mouse buttons and wheel supported) driving `Input.ts`, reset bindings.
  - Audio: Master, Weapons, Effects, Ambient, UI sliders (drives AudioEngine buses), mute-when-unfocused toggle.
  - Gameplay: Auto pickup ammo, Auto swap to better weapon on pickup, Damage numbers style, Hitmarker size, Minimap rotation/zoom/opacity, Screen shake intensity (0-100%), HUD scale, Crosshair style/color/opacity/thickness/gap with a live preview, Stamina style, Show kill feed, Streamer mode (hides names).
  - Accessibility: colorblind rarity palette (Default, Deuteranopia, Protanopia, Tritanopia: swap the rarity color constant live), high-contrast HUD, reduce motion, reduce flashing (disables shield-break flash and storm pulse), subtitles for key sounds (small text cues like "Gunshots NE", "Chest nearby", "Storm closing", driven by audio events), larger UI text.
- The menu is reachable from the pause menu (ESC), the main menu and the in-game via a cog on the pause screen; opens without losing the match (pauses nothing in multiplayer-ready fashion: the sim keeps running but input frames are zeroed). Applying a setting mid-match must work for each item (verify each, no restart-only items except the Renderer toggle).
- tests/settings.test.ts: schema migration, defaults, clamping of out-of-range values, rebinding conflict resolution.

DOCS: ARCHITECTURE.md (HUD widget table with the store keys/events each reads, settings schema table, z-order diagram, perf notes: HUD DOM node count < 400, no per-frame allocations in Crosshair/DamageNumbers) and PROGRESS.md.

ACCEPTANCE: a bot match is fully playable with a complete HUD; every setting works live and persists after reload; the crosshair visibly matches the bullet spread (fire a Hummer-12 at a wall 30 m away and check the hole spread against the crosshair gap); HUD costs < 1 ms/frame on Medium; no console errors; typecheck, tests and build pass. No placeholders.
````

## 5. Browser Verification Checklist
1. **Vitals:** take damage from each layer (F8 tools or a bot): overshield (gold) drains first with a shatter animation, then shield, then health; ghost trail lags; low health triggers a red pulse with the heartbeat sound; overshield regen glows after ~5 s without damage.
2. **Crosshair:** fire the Vireo Carbine full-auto at a wall 30 m away: crosshair expands per shot and the bullet holes (impact decals/sparks) land inside the visible gap; ADS and crouching tighten it; sprinting hides it; the Longsight shows the scope overlay on ADS.
3. **Feedback:** hitmarkers differ for health/shield/overshield/headshot/kill; damage numbers float and merge for shotgun pellets; a hit from behind shows the directional arc on the correct side.
4. **Inventory (Tab):** drag-reorder weapons, drag out to drop, right-click Use on a Spark Cell: a cast bar starts; the game keeps running while it is open.
5. **Settings:** change sensitivity, FOV, quality preset, rebind "crouch", switch the colorblind palette: all apply live; reload the page and confirm everything persisted; `Reset` restores defaults.

## 6. Debug / Recovery Mini-Prompt
````
Phase 7 UI bug: [widget + symptom, e.g. "crosshair gap doesn't match spread", "damage numbers misplaced when FOV changes", "setting X doesn't persist", "HUD drops FPS in big fights"]. Read ARCHITECTURE.md (UI section). Reproduce, then find the root cause (check: store subscription firing too often, layout thrash from reading/writing styles in one frame, wrong FOV used in projection, stale settings snapshot). Fix with the smallest change, add a unit test if it is math/schema logic, and make sure no allocations were added to per-frame paths. No placeholders.
````

---

# PHASE 8 — Authoritative Multiplayer (Colyseus 0.18), Client-Side Prediction, Lag Compensation & Web Hosting Deployment Prep

## 1. Scope
Host the **same shared simulation** (`src/shared`) on a Node Colyseus server; clients send inputs, predict their own movement and shots, interpolate remote players, and the server resolves everything authoritatively (movement, combat, loot, chests, consumables, storm, match flow) with lag-compensated hit validation. Interest management (area-of-interest `StateView`) keeps bandwidth sane for 20–100 entities, bots run server-side, matchmaking/lobby, reconnect, anti-cheat basics, a headless load-test, and deployment prep for static hosting (client) + a Node host (server).

## 2. Model & Settings Command
````
/clear
/model claude-fable-5-2         # Path A (needs usage credits; this is the netcode phase where it earns its cost)
/model claude-opus-5-5          # Path B (default, no credits needed)
/effort high
````
**Quota impact:** HEAVY. Plan two full windows: Window 1 = M1–M4 (server + movement prediction), Window 2 = M5–M8 (combat/lag comp/world state/deploy). Milestones are resumable; use the Resume prompt in §0.5 between windows. If you are on Path A, consider switching to Opus 5.5 (`/clear` first) for M7–M8 (load test + deployment files) to save credits.

## 3. Pre-Flight Check
Phases 1–7 committed and the offline game fully playable. Specifically verify: everything stateful is already in `src/shared` (MatchSim, StormModel, BotBrain, LootSim, Destructibles, ConsumableSim, WeaponSim, Ballistics, HealthSim, PlayerSim); `npm run typecheck:shared` passes (no DOM/three imports in shared); `tests/determinism.test.ts` + `tests/match.test.ts` pass; bots run through the same `PlayerSim` as humans. If any of these fail, run the Phase 6 debug prompt first: netcode on a non-deterministic sim will not work.

## 4. The Real Copy-Paste Prompt

````
PHASE 8 of 8 for Driftglass: authoritative multiplayer with Colyseus 0.18, client-side prediction, lag compensation, and deployment prep. Read CLAUDE.md, ARCHITECTURE.md, PROGRESS.md and obey CLAUDE.md. CRITICAL: before writing any netcode, FETCH AND READ the current Colyseus docs yourself with your web tools: https://docs.colyseus.io/netcode (index), /netcode/server-input, /netcode/client-prediction, /netcode/determinism, /netcode/lag-compensation, and the state-sync / StateView / schema pages, plus `npm view colyseus version` and `npm view @colyseus/schema version`, @colyseus/sdk or colyseus.js (whichever the 0.18 docs specify) and @colyseus/tools. The names below (defineInput, setFixedTimestep, inputs.get(sid), allowRewindState, rewind.attachAll, rewind.lastSeenBy, room.input(), Predict.get, predict.tick, predict.reconciler, predict.sim, ctx.reckonTime, allowRewind) come from the docs as of Nov 2026: if the installed version differs, the INSTALLED TYPES AND DOCS WIN, adapt and note it in ARCHITECTURE.md. Pin exact versions. Zero placeholders/TODOs. Milestones M1..M8; after each: typecheck (client + server), tests, and tick PROGRESS.md.

THE PLAN
- Server (Node, `server/`) imports `../src/shared` directly (alias or tsconfig paths + a build step: use tsup or tsx; the server must run `shared` unchanged, including Rapier via @dimforge/rapier3d-compat in Node).
- Tick: `setFixedTimestep(step, 30, { subSteps: 2 })` -> the shared sim runs at the same 60 Hz dt = 1/60 on both sides (two 1/60 sub-steps per 30 Hz server tick; read the docs for how ctx.subSteps/subDt are meant to be used, and match them on the client via `input.stepSeconds`/`input.subSteps`). Patch rate/state sync rate per docs (start 20 Hz).
- The server's authoritative state is the shared `MatchState` + entity states, mirrored into Colyseus Schema for replication (flat, compact types: quantize positions to 1/64 m as int16/int32 where docs recommend; yaw/pitch as uint16).

M1 — SERVER SKELETON (server/package.json, tsconfig.json, src/index.ts, rooms/MatchRoom.ts, schema/*)
- Colyseus server with `MatchRoom` (`maxClients` 32 humans, bots fill to `matchSize` 100 default 48 configurable), `filterBy(["mode"])`, a lobby phase with countdown (reuses MatchSim Lobby), `onAuth` accepting a display name (sanitize: length, charset, profanity-free-length only; no accounts), `onJoin`/`onLeave` with `allowReconnection(client, 20)` for dropped connections (the entity stays alive/AFK-safe during the grace period), `onDispose` clean up PhysicsWorld. The room constructs the SAME world from the match seed (`createHeightmap(seed)`, placements, LootSim, Destructibles, StormModel, BusPath).
- Schema (server/src/schema/*.ts using @colyseus/schema): `PlayerSchema` (id, name, x,y,z (quantized), yaw, pitch, vx,vz coarse (for remote animation), fsm (uint8 enum), crouch/sprint/slide/glide flags, hp, shield, overshield (uint8), alive, activeSlot + equipped weapon id + rarity, kills, placement, isBot), `LootSchema` (floor items: id, itemId, rarity, qty, pos), `ChestSchema` (opened bit-array or map of opened ids), `DestructibleSchema` (destroyed ids set), `StormSchema` (phase, state, center, radius, target center/radius, timeLeft), `MatchSchema` (phase, aliveCount, busPos, tick, seed). Static data (terrain, tree/chest positions) is NOT in the schema: derived from the seed.
- Interest management: use StateView so each client only receives players/loot within 300 m (players) and 150 m (loot) plus the always-visible match/storm data; hysteresis to avoid flicker. Document the visibility rules.
- tests/server (vitest + a headless room harness or colyseus testing utilities): room boots, two fake clients join, state replicates.

M2 — INPUT PIPELINE (shared + server + client)
- Define the input schema with `defineInput` mirroring `InputFrame` (moveX/moveZ int8, yaw/pitch float32 (or quantized per docs), button flags as separate booleans or a bitmask uint16, `slot` int8, `tick` as required by docs). Sanitize on the server (clamp yaw/pitch/moves; reject NaN; cap buttons).
- Server step: for each human entity, consume exactly one input per fixed step via the documented API (iterate/next/drain), apply `idle` policy when no input arrives (repeat last movement for <= 150 ms then neutral), run `stepPlayer` from shared, then run WeaponSim/ConsumableSim/InventorySim reactions to the buttons (fire, reload, interact, slot select, harvest) via shared functions, push shared events to a server event queue for replication (damage, kill, chest opened, etc. -> either Schema changes or `room.broadcast`/targeted `client.send` messages as the docs recommend; keep reliable messages for rare events).
- Client: `room.input({ type: PlayerInputSchema, ...})`; the sim loop that currently drives `LocalPlayerController` is replaced by `predict.tick(now)` which returns the number of fixed steps due this frame; for each step stage and `input.send()` exactly once (CONTRACT from the docs' determinism page: one send per fixed step).

M3 — CLIENT PREDICTION OF THE LOCAL PLAYER (src/net/NetClient.ts, PredictionBridge.ts)
- Use `Predict.get(room, {...})` and `predict.sim({ input, world, step })` (engine-state variant) because player movement is Rapier-backed: `world` = the client's PhysicsWorld; `step(ctx, state, cmd)` calls the shared `stepPlayer`; implement the `adopt`/`pose` callbacks the docs describe so a server correction teleports the Rapier character body and restores PlayerState, then REPLAYS unacknowledged inputs deterministically. Smoothing (`smoothMs` ~65) on visual correction only; snap if error > 2 m.
- Everything that mutates the local player's movement-relevant state must live inside the step function: stamina, slide, mantle timers, glider, speedModifiers (set by ConsumableSim cast state mirrored from replicated state), so prediction == server. Impulses from explosions arrive as server-authoritative events that are folded into reconciliation (the server adds them to the entity state; the client sees the correction).
- Remote players: `predict.attachAll("players", { mode: "lerp", fields: [...], ... })` / render delay per docs (start ~100 ms), `RemoteAvatars.ts` renders them with the same `CharacterRig` and `PlayerView`, animation state from the replicated fsm/flags/velocity; weapon in hand from replicated activeSlot data; hitboxes reconstructed from replicated state for client-side prediction of hit feedback.
- Divergence diagnostics: enable the docs' `warnOnDivergence` in dev; add a debug overlay (F3) showing RTT (room.clock.smoothedRtt), reconciliation error, correction count/min, replay steps, snapshot rate, bytes/s in/out (measure via a WebSocket send/recv wrapper).
- tests/netcode.test.ts (headless, two in-process rooms or a loopback harness): client prediction vs server for a scripted 20 s run with 80 ms RTT + 10% jitter + 2% packet loss produce a final position error < 5 cm and < 3 hard corrections.

M4 — AUTHORITATIVE MATCH + BOTS ON THE SERVER
- MatchRoom drives `MatchSim` (bus flight, storm, deaths, placements, victory) on the fixed step; humans and server-hosted bots are the same PlayerEntity type. Bots: `BotBrain.decide` runs on the server (10 Hz decisions staggered, 60 Hz sim). Bot fill logic: fill to `matchSize` at match start; bots are marked in the schema so the UI can label them ("Bot" badge) with a setting to hide.
- Phase flow replicated; the client Lobby/Bus/Drop UI binds to replicated `MatchSchema` instead of the local MatchSim. Offline single-player mode MUST keep working unchanged through the same code (client-side MatchSim used when `?offline=1` or when no server is configured) — keep both paths healthy and tested.
- Server authority table in ARCHITECTURE.md: client may only send inputs; server decides movement, shots, damage, loot, chests, consumables, upgrades, storm, deaths.

M5 — COMBAT, LAG COMPENSATION (shared/combat + server/rooms)
- Shots: client sends the FIRE button inside the input (no separate "I hit X" message). Use `allowRewind: (d) => d.fire` on `room.input()` so only fire inputs carry the lag-comp timestamp. Server: `rewind = this.allowRewindState({ maxRewindMs: 500 })` (cap 300-500 ms), `rewind.attachAll(this.state.players, { fields: [x, y, z, yaw, hitbox-relevant flags (crouch/slide/glide)] })`; when resolving a fire input call the docs' lag-comp API (`rewind.lastSeenBy(...)` / seen.read) to reconstruct each potential target's position at the shooter's render time and feed those transforms into the SAME shared `resolveHitscan`/`Ballistics` code, analytic hitboxes from Phase 4 (this is why they are not Rapier colliders). World geometry is static so no rewind needed except destructibles (use destruction state at the server time).
- Server validates fire: weapon state (WeaponSim: cooldown, ammo, reload, holstered, equip), shooter alive, max 1 shot per fire-rate interval, the shot RNG seed = `matchSeed ^ entityId ^ shotIndex` so client and server compute IDENTICAL spread; reject impossible aim changes (max angular speed 1800 deg/s) and log violations per player with a score; kick/flag at a threshold.
- Client-side feedback prediction: muzzle flash, tracer, recoil, ammo decrement, sounds run immediately (predicted); hitmarkers/damage numbers show as "pending" for up to RTT and are CONFIRMED by the server's damage event (ctx.predict/defineEvent with confirm/reject as the docs describe, or your own pending-hit table keyed by shotIndex) so mispredictions are corrected; kill feed, elimination, health/shield/overshield UI come only from replicated authoritative state.
- Projectiles: server-simulated authoritative projectiles replicated as entities (id, pos, vel, type, spawn tick) with client-side prediction of the local player's own projectile (spawn locally, reconcile on server confirm by tick), remote players' projectiles extrapolated from spawn tick + velocity. Explosions authoritative.
- tests: same shot seed => identical spread on client & server code paths; lag-comp unit test: a target moving at 8 m/s is hit when the shooter aimed at where they saw it with 120 ms latency, and NOT hit when aiming at where it is now; rewind beyond max is clamped.

M6 — WORLD STATE: LOOT, CHESTS, CONSUMABLES, DESTRUCTIBLES, STORM
- Interact/pickup/drop/swap/use/upgrade are inputs (INTERACT/DROP/slot) processed on the server with the shared LootSim/InventorySim/ConsumableSim; the client predicts cast bars (visual only) and gets authoritative completion/cancel; inventory is replicated to its owner only (a private schema/StateView field or targeted message) and to others only as the active-slot summary.
- Chests/destructibles: only the CHANGED sets replicate (opened ids, destroyed ids); floor loot as `LootSchema` entities in the interest area; on join mid-match a client rebuilds the static world from the seed then applies opened/destroyed sets and the current loot list (late-join/reconnect test).
- Storm and bus replicated via `StormSchema`/`MatchSchema`; client StormView/BusView drive from replicated values with local interpolation by server time (`room.clock.serverNow()`), damage ticks authoritative.
- Server-authoritative destruction events broadcast the VFX direction/material so all clients play the right effect.

M7 — HARDENING & LOAD TEST (tools/loadtest.ts, server/src/security.ts)
- Rate limits and caps: input messages per second, message size, one connection per IP soft-limit option, name sanitization, room join throttle, max reliable messages/s. Server never trusts client positions or tick numbers beyond the input contract. Environment config via .env (PORT, MAX_CLIENTS, BOTS, TICK_RATE, ALLOWED_ORIGINS, LOG_LEVEL).
- tools/loadtest.ts: spawns N headless bot clients (default 40) with the colyseus client SDK in Node, each running a scripted/random input generator (walk, jump, slide, shoot, loot) and reports: server tick time p50/p95/p99, average bytes/s per client, snapshot size, CPU, memory over 5 minutes. Target: 32 humans + 68 bots at 30 Hz with p95 tick < 20 ms on a 2-vCPU instance; if not met, add LOD tricks (bots beyond 250 m from any human update at 15 Hz, relevance-based replication) and report the numbers honestly.
- Metrics/health: GET /health, optional @colyseus/monitor behind basic auth in non-production only, structured logs of join/leave/disconnect/cheat-flags.

M8 — DEPLOYMENT PREP (Dockerfile, docs/DEPLOY.md, .env.example, vite config, CI)
- Client: `npm run build` -> static `dist/` (hashed assets, brotli/gzip precompressed via vite plugin or documented host setting); `VITE_SERVER_URL` env (ws:// for local, wss:// production) with a settings fallback to offline mode when unreachable; WASM/Rapier served correctly (the -compat build is inlined, verify); no COOP/COEP headers required, state that explicitly; cache headers guidance (immutable hashed assets, no-cache index.html); a startup "Connecting..." UI with latency display, region selector stub-free (single region OK: show the one server).
- Server: multi-stage Dockerfile (node:22-slim, build with tsup/tsc, run as non-root, healthcheck), `docker-compose.yml` for local, `.env.example`, graceful shutdown (SIGTERM: stop accepting rooms, finish the match or migrate-notify, close), horizontal scaling notes (Redis presence/driver for multiple processes with Colyseus's documented options, sticky load balancing / proxy WebSocket upgrade), TLS termination notes, CORS/ALLOWED_ORIGINS enforcement, and per-host recipes in docs/DEPLOY.md: (a) static client on Cloudflare Pages / Netlify / Vercel / GitHub Pages and (b) server on Fly.io / Railway / a VPS with Caddy/nginx (include a working Caddyfile and an nginx WebSocket block) and (c) Colyseus Cloud as an alternative: write the exact steps and commands, flagged "verify against provider docs on the day".
- GitHub Actions workflow: typecheck (client, shared, server), tests, client build, server build, docker build.
- Final docs: ARCHITECTURE.md netcode chapter (sequence diagrams for input->prediction->reconciliation, shot->lag comp->damage->confirmation, late join), bandwidth budget table (measured), authority table, config reference; PROGRESS.md marks all 8 phases complete with a "Known issues / next ideas" list (duos/squads, revive, emotes, ranked, cosmetic shop = out of scope).

ACCEPTANCE: `npm run dev` + `npm run server:dev` -> open two browser tabs (and a third on another device if you can), join the same room, play a full match with bots: movement feels instant (prediction), remote players are smooth, shots register fairly at 100-150 ms simulated latency (use Chrome DevTools network throttling and a built-in `?lag=120&jitter=20&loss=2` debug flag that wraps the socket for simulated latency), loot/chests/destruction/storm stay in sync, late join and reconnect work, offline mode still works, load test report included, Docker image builds, DEPLOY.md is followable. No placeholders. End with an honest report: measured numbers, risks, and anything not verified.
````

## 5. Browser Verification Checklist
1. **Two tabs:** `npm run server:dev` + `npm run dev`, open two tabs on the same room: both players appear in the lobby, take the bus, and see each other drop. Your own movement responds with zero perceived delay; the other tab's player moves smoothly.
2. **Latency test:** add `?lag=120&jitter=20&loss=2` to one tab: movement is still responsive, the F3 overlay shows corrections/min staying low (< 3/min on flat ground) and no rubber-banding when sprinting/sliding/mantling.
3. **Combat fairness:** shoot the other tab's player while strafing at ~100 ms lag: hits register where you saw them; hitmarkers show pending then confirm; the victim's health bar updates from the server; kills and placement appear in the kill feed/end screen.
4. **Shared world:** open a chest, break a tree and a barrel in tab A; tab B sees the same opened chest/destroyed props/loot; refresh tab B mid-match: it rejoins (reconnect) with the correct world state.
5. **Deploy rehearsal:** `docker build` succeeds, `npm run build && npm run preview` against a local server over `wss://` (or via the documented Caddy) works; `tools/loadtest.ts` prints p95 tick time under budget.

## 6. Debug / Recovery Mini-Prompt
````
Phase 8 netcode bug: [symptom: e.g. "rubber-banding when sliding", "hits don't register at 120 ms", "late joiner sees opened chests as closed", "server tick p95 too high with bots", "two clients desync after mantling"]. Read ARCHITECTURE.md (netcode chapter) and the Colyseus determinism page again (https://docs.colyseus.io/netcode/determinism: it lists the exact contract and the symptom each break causes). Reproduce with the headless harness in tests/netcode.test.ts using the failing latency/loss parameters; log the first tick where client prediction and server state diverge and which field; the cause is almost always (a) state mutated outside the shared step, (b) Math.random/time used in shared, (c) an input not sent exactly once per fixed step, or (d) a field missing from the replicated/adopted state. Fix the root cause in src/shared or the bridge, add the regression test, keep offline mode working. No placeholders.
````

---

# APPENDIX A — Master "Phase Gate" checklist (run before every `git commit`)

1. `npm run typecheck && npm run typecheck:shared && npm test && npm run build` all green.
2. `/?debug=1` loads with no console errors on WebGPU **and** `?renderer=webgl`.
3. F3 overlay: ≥ 60 FPS at Medium (≥ 45 with 50 bots / multiplayer).
4. `PROGRESS.md` shows the phase complete; `ARCHITECTURE.md` updated; no `TODO`/`FIXME`/`not implemented` strings: run `grep -rniE "TODO|FIXME|not implemented|placeholder" src server tools` and fix every hit.
5. `git add -A && git commit -m "Phase N"` then `/clear` before the next phase.

# APPENDIX B — Prompt for when Claude Code leaves a TODO behind

````
Run `grep -rniE "TODO|FIXME|not implemented|placeholder|stub" src server tools tests`. For every hit, implement the real functionality (do not just delete the comment unless the code is genuinely complete), run typecheck and tests, and report what you changed. Then update PROGRESS.md.
````

# APPENDIX C — Quota-saving cheat sheet

- Ask for **one milestone at a time** if you are on the last hour of a 5-hour window: "Do only M3 of the Phase N brief."
- Prefer **Sonnet 5.5 (Low)** for: renaming, CSS polish, JSON tuning, docs, test-writing for existing code, small bug fixes.
- Prefer **Opus 5.5 (Medium)** for anything touching `src/shared`, shaders, or netcode.
- Keep `CLAUDE.md` short (it loads every turn). Move long reference material into `ARCHITECTURE.md`, which Claude only reads at the start of a phase.
- Avoid pasting screenshots/long logs unless needed; paste the first error and a 10-line stack.
- Do not leave `?debug=1` panels (lil-gui, stats) running while Claude is iterating on perf: they distort measurements.

# APPENDIX D — Sources used for the research

- Three.js WebGPURenderer manual: https://threejs.org/manual/en/webgpurenderer
- Three.js r183 `RenderPipeline` rename, `Timer`, TSL spec: https://app.cinevva.com/news/2026-03-18-threejs-r183-render-pipeline
- Three.js WebGPU migration guide (2026): https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- `CSMShadowNode` docs: https://threejs.org/docs/pages/CSMShadowNode.html (and note on `CSM` being WebGL-only: https://threejs.org/docs/pages/CSM.html)
- `StorageInstancedBufferAttribute` (compute): https://threejs.org/docs/pages/StorageInstancedBufferAttribute.html
- Rapier kinematic character controller: https://rapier.rs/docs/user_guides/javascript/character_controller and snap-to-ground: https://rapier.rs/docs/user_guides/javascript/character_controller_snap_to_ground/
- Colyseus 0.18 netcode: https://docs.colyseus.io/netcode , https://docs.colyseus.io/netcode/client-prediction , https://docs.colyseus.io/netcode/server-input , https://docs.colyseus.io/netcode/determinism , release notes https://colyseus.io/blog/colyseus-018-is-here/
- Zero Build mechanics: Epic announcement coverage https://gamesradar.com/epic-announces-fortnite-zero-build-a-permanent-no-build-mode ; May 2026 overhaul https://allthings.how/fortnite-zero-build-overhaul-pocket-items-starting-loadout-and-no-lethal-fall-damage-v40-40/ ; guide https://gamertagmythras.com/blog/fortnite/fortnite-zero-build-guide
- Weapon stat shape and rarity scaling: https://fortnite.fandom.com/wiki/Assault_Riffle , https://www.gameskinny.com/ktudl/fortnite-chapter-2-weapons-list-and-stats
- Healing items (cast times, caps): https://fortnite.fandom.com/wiki/Consumable_Items , https://fortnite-archive.fandom.com/wiki/Healing_Items
- Storm structure and damage ramp: https://fortnite-archive.fandom.com/wiki/The_Storm_(Battle_Royale) , https://gamertagmythras.com/blog/fortnite/fortnite-storm-phases-guide
- Claude Code plan limits and Fable on Pro: https://alexcloudstar.com/blog/claude-code-usage-limits-2026/ , https://claudelog.com/faqs/is-fable-5-available-on-claude-pro-max/ , https://www.morphllm.com/claude-code-usage-limits

*Pricing and plan rules for Claude Code change often; verify with `/usage` and Anthropic's help center before relying on the quota notes above.*
