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

Present after M0: `src/shared/rules/Strings.ts`, `src/shared/data/names.ts`, `src/main.ts`, `src/ui/StartScreen.ts`, `tools/check-markers.mjs`, `tests/m0.scaffold.test.ts`. The other `src/shared/*` folders exist but are empty until their milestones.

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
- Determinism: `Rng` (sfc32) with named forks (`world`, `loot`, `storm`, `bus`, `ai:<id>`, `shot`). Per-shot seed = `matchSeed ^ entityId ^ shotIndex`.

## Purity enforcement (R6)
1. `tsconfig.shared.json` compiles only `src/shared` with `lib: ["ES2022"]` and `types: []`, so DOM and Node globals are type errors (`npm run typecheck:shared`).
2. `tests/m0.scaffold.test.ts` scans `src/shared` for `Math.random(`, `Date.now(`, `performance.now(`, `window.`, `document.`, and `three` / `node:` imports.

## Library APIs verified in M0 (installed sources, R5)
- three 0.187.0: `three/webgpu` exports `WebGPURenderer` and `RenderPipeline`. `PostProcessing` is still exported as a legacy alias; **use `RenderPipeline`**. `Timer` is in core. `Clock` warns as deprecated since r183. `CSMShadowNode` lives at `three/examples/jsm/csm/CSMShadowNode.js`.
- Rapier 0.21.0: `world.createCharacterController(offset)` returns a controller with `computeColliderMovement`, `enableAutostep(maxHeight, minWidth, includeDynamic)`, `enableSnapToGround(dist)`, `setMaxSlopeClimbAngle(rad)`.
- @colyseus/core 0.18.23: `Room.defineInput(InputSchema, opts?)`, `Room.setFixedTimestep(cb, { subSteps })` with a per-step context, `Room.allowRewindState({ maxRewindMs })` returning `Rewind` (`lastSeenBy`, render-time resolution). Client-side `Predict` is to be verified in `@colyseus/sdk` during M13.

## Deviations from the brief
| Brief | Actual | Why |
|---|---|---|
| Fetch the reference links | All failed (DNS blocked by the session network policy) | Notes use `[SPEC]` and `[BG]` values with provenance tags; see docs/REFERENCES.md |
| `UI_REFERENCE_NOTES.md` | Not created | There is no `reference/` folder (the brief makes it conditional) |
| Placeholder grep in R4 | Wrapped as `npm run lint:markers` (`tools/check-markers.mjs`) | Same patterns; the script builds them from fragments so it does not match itself |
| — | `.npmrc legacy-peer-deps=true` | npm 10.9.9 crashes (`edgesOut` null) resolving vitest 5's optional peers |
| — | TypeScript 7.0.2 | Stable native compiler; the config avoids options removed in 7.x (no `baseUrl`, no `node10` resolution) |

## Tuned values
None yet. Defaults are in docs/MECHANICS_NOTES.md and become config modules from M1/M2.

## Events
The initial contract is in docs/GAME_SPEC.md §12. Typed payloads are added here as each milestone implements them.
