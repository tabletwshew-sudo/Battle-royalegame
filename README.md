# DRIFTGLASS

A browser-based Zero Build battle royale with squads, bots, pings and Reboot Vans. Built with Three.js (WebGPU with a WebGL2 fallback), Rapier and Colyseus. Every model, texture, icon and sound is generated procedurally in code.

> **Unofficial fan project, not affiliated with Epic Games.** This is a private school project and is not published or distributed. Fortnite terms appear as text labels only. No Epic assets, logos, characters, music or UI art are used.

## Status
Milestones **M0** (research, spec, scaffold), **M1** (core engine), **M2** (movement v1) and **M3** (Zero Build locomotion) are complete. The app opens the movement playground: a third-person character on a test course with ramps, stairs, mantle walls, hurdle fences, a hut with doors, a 25 m mesa with a slide ramp, a launch pad and a training dummy. See [PROGRESS.md](PROGRESS.md).

Controls: WASD move, mouse look, Shift sprint, Space jump / mantle / hurdle / deploy, cut or redeploy the glider, C or Ctrl crouch (press while running to slide), right mouse aim, Q Pickaxe, 1-5 slots, E open/close door, X swap shoulder, left click kick crates, R respawn crates, Esc release mouse.
Debug: F3 stats, F4 ledge probe + live tuning (incl. sprint mode), F9 movement self-test.
URL flags: `?seed=7`, `?renderer=webgl`, `?quality=low|medium|high|ultra`.

## Quick start
```bash
npm install
```
```bash
npm run dev
```
```bash
npm run check
```

Requires Node ≥ 22.

## Docs
- [docs/GAME_SPEC.md](docs/GAME_SPEC.md): game behavior
- [docs/MECHANICS_NOTES.md](docs/MECHANICS_NOTES.md): tunable numbers and their sources
- [docs/REFERENCES.md](docs/REFERENCES.md): reference links and fetch log
- [ARCHITECTURE.md](ARCHITECTURE.md): code structure
