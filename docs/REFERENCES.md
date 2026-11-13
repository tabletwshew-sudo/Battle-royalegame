# References

Reference links are for **mechanics only**. Text, images and audio are never copied (R2c). Facts are paraphrased into `docs/MECHANICS_NOTES.md`.

## Fetch log (M0, 2026-11-13)

The M0 session ran in a cloud container whose network policy allows package registries only. Every web host below failed DNS resolution (`ENOTFOUND`), so **no reference page was read in M0**. The first six were tried. Once the policy was clearly blocking all hosts, the rest were not retried, to avoid repeating the same failure. This is noted per the protocol ("skip any that fail; note failures").

Effect: `MECHANICS_NOTES.md` values come from the project prompt's spec numbers plus the author's background knowledge of the reference game. Each value is tagged with its source, and anything not covered by the spec is marked `UNKNOWN: tunable`. **Action for a later session:** allow these hosts in the environment's network settings, re-run the fetch pass, and reconcile the notes. The defaults are tunables, so this changes no code structure.

| # | Topic | URL | Status |
|---|-------|-----|--------|
| 1 | Zero Build overview | https://gamesradar.com/epic-announces-fortnite-zero-build-a-permanent-no-build-mode | FAILED (DNS blocked) |
| 2 | Zero Build overview | https://www.engadget.com/fortnite-zero-build-mode-142940130.html | FAILED (DNS blocked) |
| 3 | ZB 2026 overhaul | https://allthings.how/fortnite-zero-build-overhaul-pocket-items-starting-loadout-and-no-lethal-fall-damage-v40-40/ | FAILED (DNS blocked) |
| 4 | v40.40 patch notes | https://communities.epicgames.com/thread/v40-40-act-iii-battle-royale-update-notes/0j2r | FAILED (DNS blocked) |
| 5 | ZB changes | https://insider-gaming.com/fortnite-zero-build-changes-patch-notes/ | FAILED (DNS blocked) |
| 6 | ZB guide / overshield | https://gamertagmythras.com/blog/fortnite/fortnite-zero-build-guide | FAILED (DNS blocked) |
| 7 | Creative movement rules | https://dev.epicgames.com/documentation/en-us/fortnite/player-movements-in-fortnite-creative | NOT FETCHED (policy blocks all web hosts) |
| 8 | Movement guide | https://gamertagmythras.com/blog/fortnite/fortnite-movement-guide | NOT FETCHED (same host as #6) |
| 9 | Movement strategies | https://dignitas.gg/articles/best-strategies-to-master-fortnite-movement | NOT FETCHED |
| 10 | Movement | https://allthings.how/?p=102984 | NOT FETCHED (same host as #3) |
| 11 | Assault Rifle | https://fortnite.fandom.com/wiki/Assault_Riffle | NOT FETCHED |
| 12 | Weapons list | https://www.gameskinny.com/ktudl/fortnite-chapter-2-weapons-list-and-stats | NOT FETCHED |
| 13 | Weapons | https://dotesports.com/?p=340869 | NOT FETCHED |
| 14 | Consumables | https://fortnite.fandom.com/wiki/Consumable_Items | NOT FETCHED |
| 15 | Healing items | https://fortnite-archive.fandom.com/wiki/Healing_Items | NOT FETCHED |
| 16 | Storm | https://fortnite-archive.fandom.com/wiki/The_Storm_(Battle_Royale) | NOT FETCHED |
| 17 | Storm phases | https://gamertagmythras.com/blog/fortnite/fortnite-storm-phases-guide | NOT FETCHED |
| 18 | Party tips | https://www.fortnite.com/news/5-tips-for-how-to-play-fortnite-with-friends | NOT FETCHED |
| 19 | Squad formation | https://www.gamerevolution.com/guides/532971-fortnite-squad-formation | NOT FETCHED |
| 20 | Rebooting | https://fortnite.fandom.com/wiki/Rebooting | NOT FETCHED |
| 21 | Reboot vans | https://www.engadget.com/2019/04/10/fortnite-reboot-vans-update/ | NOT FETCHED (same host as #2) |
| 22 | Reboot | https://www.cultofmac.com/?p=618024 | NOT FETCHED |
| 23 | Pings | https://www.gamesradar.com/fortnite-ping-system-how-to | NOT FETCHED |
| 24 | Pings | https://mein-mmo.de/en/in-fortnite-you-can-now-mark-intelligently-like-pings-in-apex-legends,323421 | NOT FETCHED |
| 25 | Pings | https://allthings.how/how-to-use-fortnite-ping-system/ | NOT FETCHED |
| 26 | Bots guide | https://gamertagmythras.com/blog/fortnite/fortnite-bots-guide | NOT FETCHED |
| 27 | Bot counts | https://dexerto.com/fortnite/fortnite-og-tests-reveal-how-many-bots-are-in-matches-and-its-incredibly-high-3012439 | NOT FETCHED |
| 28 | VS Bots playlist | https://allthings.how/fortnite-chapter-7-pacific-break-early-patch-notes-and-key-changes/ | NOT FETCHED |

## Tech references

The web docs were unreachable for the same reason. Per R5, the **installed packages' type declarations and sources** in `node_modules` were used instead. These are the authority anyway, because they match the pinned versions.

| Library | Web doc (not reachable) | Verified locally in M0 |
|---------|------------------------|------------------------|
| three 0.187.0 | https://threejs.org/manual/en/webgpurenderer | `three/src/Three.WebGPU.js` exports `WebGPURenderer`, `RenderPipeline` (and the legacy `PostProcessing` alias); `Timer` is exported from core; `Clock` logs a deprecation warning (r183) |
| three CSM | https://threejs.org/docs/pages/CSMShadowNode.html | `three/examples/jsm/csm/CSMShadowNode.js` exports `CSMShadowNode` |
| Rapier 0.21.0 | https://rapier.rs/docs/user_guides/javascript/character_controller | `rapier_wasm3d.d.ts`: `computeColliderMovement`, `enableAutostep`, `enableSnapToGround`, `setMaxSlopeClimbAngle` on the kinematic character controller |
| @colyseus/core 0.18.23 | https://docs.colyseus.io/netcode (+ client-prediction, server-input, determinism) | `build/Room.d.ts`: `defineInput`, `setFixedTimestep` (with `subSteps`), `allowRewindState`; `build/Rewind.d.ts`: `Rewind`, `maxRewindMs`, `lastSeenBy` |
