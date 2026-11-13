# DRIFTGLASS: agent notes

Browser Zero Build battle royale (private school project). *Unofficial fan project, not affiliated with Epic Games.*

## Rules (short form; full text in docs/GAME_SPEC.md §1)
- R1 Zero Build only: no building/editing/materials. Props drop **scrap** (benches + vending only).
- R2 Fortnite terms as text labels only, kept in `src/shared/rules/Strings.ts` + `src/shared/data/names.ts`. No character/skin lookalikes, logos, ripped assets or copied reference text. Fan notice on start menu + README.
- R3 No external assets: geometry, textures, icons, audio are all procedural.
- R4 No unfinished markers or dead buttons. `npm run lint:markers` must be clean.
- R5 Verify APIs in the installed `node_modules` types before use. Versions are pinned exactly (`.npmrc` save-exact).
- R6 `src/shared` is pure deterministic TS: no DOM/three/window/Math.random/Date.now/performance.now. Seeded `Rng` only. Enforced by `tsconfig.shared.json` + tests/m0.scaffold.test.ts.
- R7 Sim at 60 Hz fixed; render interpolates; the world derives from one integer seed.
- R8 Perf budgets: 60 fps 1080p Medium iGPU, < 300 draws, HUD < 1 ms, 50 bots ≥ 45 fps; WebGPU + `?renderer=webgl`.
- R9 Update CLAUDE.md / ARCHITECTURE.md / PROGRESS.md every milestone.

## Commands
- `npm run dev`: Vite dev server (port 5173)
- `npm run build`: static client build into `dist/`
- `npm run typecheck`: full project (DOM + Node libs)
- `npm run typecheck:shared`: `src/shared` against ES2022 only
- `npm test`: vitest (tests/**/*.test.ts)
- `npm run lint:markers`: R4 grep guard
- `npm run check`: all of the above except build

## Docs
- docs/GAME_SPEC.md: behavior authority
- docs/MECHANICS_NOTES.md: tunables authority
- docs/REFERENCES.md: sources + fetch log
- ARCHITECTURE.md: modules, APIs, deviations, events
- PROGRESS.md: milestone status and what is next

## Gotchas
- npm needs `legacy-peer-deps=true` (in `.npmrc`): npm 10.9 crashes resolving vitest 5's optional peers.
- A global `tsc` 6.x exists on this machine. Always use the npm scripts / `npx --no-install tsc` (local 7.0.2).
- The cloud session's network blocks web hosts. Reference sites could not be fetched in M0.
