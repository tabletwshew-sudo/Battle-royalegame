# Progress

Legend: [x] done · [ ] not started · [~] in progress

## Milestones
- [x] **M0 Research & spec**: references logged, mechanics notes, game spec, scaffold, docs, pinned versions
- [x] **M1 Core engine**: renderer factory (WebGPU + WebGL2), fixed loop, input, Rapier world, shared Rng/Events/Rules, debug overlay, determinism harness
- [x] **M2 Movement v1**: character controller, walk/jump/crouch, third-person camera + spring arm + ADS, procedural rig
- [x] **M3 Zero Build locomotion**: sprint/stamina, slide, mantle/hurdle/vault, shoulder bash, roll landing, skydive, glider, redeploy, fall damage, F9 self-test
- [~] M4 Island + graphics: heightmap/biomes/POIs, terrain, foliage, water, sky, shadows, materials, post stack, quality presets, particles
- [ ] M5 Combat core: layered health/shield/overshield, hitboxes, hitscan + bloom + recoil, projectiles, weapon data, inventory, weapon views, training range, balance report
- [ ] M6 Loot & economy: chests, floor loot, consumables, pocket items, destructibles, benches, vending, scrap, starting loadout
- [ ] M7 Audio: procedural engine, SFX bank, ambience on events
- [ ] M8 Match loop offline: lobby island, bus, drop, storm + shader + post, deaths, spectating, end screen, maps
- [ ] M9 Bots: BotBrain, difficulty, names, lobby behavior, headless tests, LOD
- [ ] M10 Teams offline: team model, friendly fire off, team HUD, nameplates, pings + wheel, Reboot Cards/Vans, spectating, bot teammates, DBNO flag
- [ ] M11 HUD/menus/settings complete
- [ ] M12 Server: Colyseus MatchRoom with shared sim, inputs, schema + StateView, server bots, reconnect
- [ ] M13 Netcode: prediction, interpolation, lag-compensated hits, projectiles, authoritative world, late join
- [ ] M14 Party online: PartyRoom, queue + seat reservations, persistence, bot fill timing
- [ ] M15 Hardening & deploy prep

## M0 checklist
- [x] docs/REFERENCES.md with fetch log (all fetches blocked; see Known issues)
- [x] docs/MECHANICS_NOTES.md with every heading, source tags and `UNKNOWN: tunable` defaults
- [x] docs/UI_REFERENCE_NOTES.md: not required (no `reference/` folder)
- [x] docs/GAME_SPEC.md (behavior authority)
- [x] Scaffold: package.json scripts, exact-pinned deps, tsconfig + tsconfig.shared (ES2022-only), vite + vitest configs, .gitignore, .npmrc
- [x] `src/shared/rules/Strings.ts` and `src/shared/data/names.ts` (labels, 11 POIs, 576 bot-name combos)
- [x] Static start screen with the fan notice (no controls yet); README notice
- [x] R6 purity test + R4 marker check (`npm run lint:markers`)
- [x] CLAUDE.md, ARCHITECTURE.md, PROGRESS.md
- [x] `npm run typecheck && npm run typecheck:shared && npm test` green; `npm run build` green

## M1 checklist
- [x] `Rng` (sfc32, order-independent named forks, state save/restore, `shotRng`)
- [x] `InputFrame` + `Button` bitmask + `sanitizeInput`; `EventQueue` / `SimEvent`; `StateHasher`; `FixedStepper`; `Simulation` interface
- [x] `RulesConfig` (+ fast preset, validation) and `UrlFlags` parser for every documented flag
- [x] `PhysicsWorld` (Rapier): static/dynamic boxes, raycast, snapshot/restore
- [x] `SandboxSim` engine test world + determinism harness (`npm run sim:determinism`): rerun and snapshot-restore are bit-identical
- [x] `RendererFactory` (WebGPU, automatic and forced WebGL2), ACES tone mapping; device-loss recovery to WebGL2
- [x] `GameLoop` (fixed 60 Hz, interpolation alpha, step cap, timing stats)
- [x] `Input` (bindings table, pointer lock, mouse look, tap latching), `Settings` (versioned localStorage), `Quality` presets, `EventBus`
- [x] F3 `DebugOverlay`, loud `ErrorPanel`, start screen button, sandbox HUD
- [x] `npm run smoke` browser check (headless Chromium): WebGL2 passes fully; WebGPU initializes, then falls back (see Known issues)
- [x] 58 tests green; typecheck, typecheck:shared, marker check, build green

Flags consumed in M1: `?seed=`, `?renderer=webgl`, `?quality=`. The others are parsed and shown on the start screen but have no consumer until their milestones.

## M2 checklist
- [x] `MovementConfig` with the spec defaults (run 6, crouch 3, ADS 3.5, gravity 25, jump 1.2 m, coyote 0.10, buffer 0.12, capsule 0.35 / 1.8 / 1.1, autostep 0.45, slope 50 deg)
- [x] `PlayerController` on Rapier's character controller: ground accel/decel, air steering, jump with coyote + buffer, slopes, autostep, ground snap, crouch with stand-up clearance, ADS walk, shoulder swap, body facing, kill-plane respawn; `jump` / `land` / `respawn` events
- [x] Player state in the determinism harness: rerun and snapshot/restore stay bit-identical
- [x] Shared `CameraRig`: over-the-shoulder offset, ADS blend, sphere-swept spring arm (pivot and arm), FOV scale
- [x] Client `ThirdPersonCamera`: arm snap-in / ease-out, landing dip, ADS zoom, newest mouse angles every frame
- [x] Procedural humanoid rig (one skinned mesh, 18 bones) + procedural animation (run cycle, strafe, crouch, air, ADS, look, landing)
- [x] Movement playground course: ramps 20/35/48/55 deg, steps 0.3/0.45/0.6 m, ledges, crouch tunnel, camera walls, platform
- [x] 93 tests (34 new movement/camera tests), typecheck x2, markers, build, smoke (WebGL2) green; screenshots checked for idle, run, strafe, crouch, jump, ADS, camera against walls

## M3 checklist
- [x] Tactical sprint: stamina drain/regen/delay/start threshold/lockout, holster + raise delay, sprint jump, Pickaxe infinite sprint, sprint modes hold/toggle/auto (setting)
- [x] Slide: entry from sprint/run, flat decay, downhill acceleration (cap 20), uphill decay, steering, slide jump x1.15, boosted downhill jump, slide -> sprint chain keeps momentum, slide-on-landing, slide kick (rule flag, dummy target)
- [x] Mantle / hurdle: ledge probe (wall rays, top ray, hurdle far-edge search, clearance casts), mantle 0.5-2.3 m with height-scaled duration, airborne ledge grab (stops the fall), hurdle <= 1.1 m keeping speed, item raise delay, input lock
- [x] Doors: kinematic hinged doors, sprint/slide shoulder bash (one per sprint), Interact toggle
- [x] Roll landing, fall damage formula, modern non-lethal splat, classic lethal rule
- [x] Launch pad, skydive (steer, dive), glider (auto-deploy 120 m, W/S trade-offs, look-follow heading + A/D bank, auto-close), glider cut, redeploy rule + cooldown
- [x] Vitals (overshield/shield/health layers, regen) for fall damage and slide kicks
- [x] Client: per-mode procedural poses, glider + pickaxe models, sprint FOV kick, slide roll, skydive/glide framing, HUD vitals + energy bar + prompts + altitude, door view, F4 probe view + lil-gui tuning, F9 self-test panel
- [x] 29-case movement self-test (vitest + F9 in the browser: 29/29 in both), 133 tests, determinism incl. a scripted launch/skydive/glide snapshot run, smoke green on WebGL2 and on the WebGPU-fallback path

## M4 checklist (in progress)
- [x] Shared island generation: deterministic value/fBm/ridged noise, warped coastline with beaches, hills, terraced mountains (cliffs), 11 flattened POI pads, carved lakes (Loot Lake with its island), biomes, jittered-grid trees/rocks/bushes
- [x] Procedural buildings (house, shop, warehouse, switchback tower) and 11 landmarks; doors; launch pads on landmarks and mountain peaks
- [x] StaticWorld abstraction (playground + island), heightfield collider matching the shared height sampler, convex rock hulls, tree trunks
- [x] Swim mode (float, 4.5 m/s, climb out, wade out; water landings take no damage)
- [x] Tests: island generation/determinism/heightfield parity/pads/props, island sandbox spawn + swim + snapshot determinism; self-tests for house and tower walkability (31/31)
- [ ] Client rendering: terrain LOD, cel/rim materials, buildings, foliage with wind, water, sky + time of day, CSM shadows
- [ ] Post stack, quality presets + dynamic resolution, particles (GPU + CPU), F5 VFX menu

## Known issues
- **WebGPU not verified on screen.** The container's headless Chromium initializes WebGPU and compiles pipelines but cannot present frames (no swap-chain image support), so it drops the device. The game then switches to WebGL2 by itself. A WebGPU frame still needs to be checked once on a real GPU browser.
- **Reference sites unreachable.** The session network policy blocks every web host (`ENOTFOUND`). MECHANICS_NOTES values are `[SPEC]`/`[BG]`, not verified against sources. To fix: allow the hosts in the environment network settings, re-run the fetch pass, and reconcile the notes. Only defaults would change.
- Legendary Bolt-Action headshot (290) one-shots the 250 max EHP, which is stronger than "two-shot threat". Kept per spec; revisit in the M5 balance pass.

- Headless Chromium cannot produce pointer-lock mouse movement, so mouse look is verified through the debug `look()` control and unit tests, not a real mouse. Check mouse feel once in a desktop browser.

## Next
**M4 Island + graphics.** Island data (seeded heightmap ~2.4 km, biomes, the 11 POI anchors from `names.ts`), chunked terrain with LOD and a Rapier heightfield collider, triplanar/splat terrain material (TSL), instanced wind-animated foliage and rocks, water with foam, sky dome + time of day, sun with CSMShadowNode, stylized cel/rim materials, post stack via `RenderPipeline` (ACES, bloom, GTAO, vignette), quality presets extended (shadows, post, foliage density) + dynamic resolution, and the GPU/CPU particle system. Keep the movement playground reachable (`?scene=playground`) for movement tests; put cliffs and launch spots on the island for glider redeploys.
