# Progress

Legend: [x] done · [ ] not started · [~] in progress

## Milestones
- [x] **M0 Research & spec**: references logged, mechanics notes, game spec, scaffold, docs, pinned versions
- [ ] M1 Core engine: renderer factory (WebGPU + WebGL2), fixed loop, input, Rapier world, shared Rng/Events/Rules, debug overlay, determinism harness
- [ ] M2 Movement v1: character controller, walk/jump/crouch, third-person camera + spring arm + ADS, procedural rig
- [ ] M3 Zero Build locomotion: sprint/stamina, slide, mantle/hurdle/vault, shoulder bash, roll landing, skydive, glider, redeploy, fall damage, F9 self-test
- [ ] M4 Island + graphics: heightmap/biomes/POIs, terrain, foliage, water, sky, shadows, materials, post stack, quality presets, particles
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

## Known issues
- **Reference sites unreachable.** The session network policy blocks every web host (`ENOTFOUND`). MECHANICS_NOTES values are `[SPEC]`/`[BG]`, not verified against sources. To fix: allow the hosts in the environment network settings, re-run the fetch pass, and reconcile the notes. Only defaults would change.
- Legendary Bolt-Action headshot (290) one-shots the 250 max EHP, which is stronger than "two-shot threat". Kept per spec; revisit in the M5 balance pass.

## Next
**M1 Core engine.** Start with `src/shared/sim/Rng.ts` (sfc32 + named forks) and its tests. Then `src/shared/sim/EventBus` types, `RulesConfig`, `GameLoop` (fixed 60 Hz accumulator + interpolation alpha, `renderer.setAnimationLoop`), `RendererFactory` (`await renderer.init()`, `?renderer=webgl` → `forceWebGL`), `Input` → `InputFrame`, Rapier init (`await RAPIER.init()`), F3 debug overlay, and a determinism harness test (same seed + inputs ⇒ identical state hash).
