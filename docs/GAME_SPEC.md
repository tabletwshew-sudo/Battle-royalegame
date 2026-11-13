# DRIFTGLASS: Game Specification (authority for behavior)

DRIFTGLASS is a browser battle royale in the **Zero Build** style: no building or editing, and high mobility. It has squads, bots, pings and Reboot Vans. It is a private school project and an *Unofficial fan project, not affiliated with Epic Games*. Numbers live in `MECHANICS_NOTES.md` (authority for tunables). This file defines **behavior**. If the two conflict, behavior follows this file and numbers follow the notes.

Conventions: SI units, Y-up, right-handed, simulation at 60 Hz (`dt = 1/60`). "Sim" means pure code in `src/shared`. All randomness comes from the seeded `Rng` (sfc32) with named forks.

---

## 1. Hard rules
1. **Zero Build only.** No build/edit keys, structures or building materials. Prop resources are **scrap**, spent only at Upgrade Benches and Vending Machines.
2. **Original visuals and audio.** Everything is generated in code. Fortnite terms are text labels only, kept in `src/shared/rules/Strings.ts` and `src/shared/data/names.ts`. No character or skin lookalikes, logos, ripped assets or copied reference text. The fan notice appears on the start menu and in README.
3. **Determinism.** One integer match seed derives the whole world. Sim code has no `Math.random`, wall clock, DOM or three.
4. **Completeness.** No unfinished markers or dead controls in any shipped milestone.

## 2. Movement (`MovementConfig`)
State machine: `Grounded{walk,crouch,sprint,slide,ads}`, `Airborne{jump,fall}`, `Mantle`, `Hurdle`, `Skydive`, `Glide`, `Splat`, `Roll`, `Bus`, `Dead`.

- **Character controller:** kinematic capsule driven by Rapier's `KinematicCharacterController` (autostep, snap-to-ground, max slope), with coyote time and a jump buffer.
- **Tactical sprint:** Shift (hold / toggle / auto). Holsters the held item, which cannot fire while sprinting, and restores it when sprint ends. Drains stamina and regenerates after a delay. Cannot start below the threshold. At zero, sprint ends with a lockout. A sprint jump is higher and longer. Holding the Pickaxe gives unlimited stamina (flag). The energy bar is shown only while sprinting or recovering.
- **Slide:** Crouch while sprinting or moving fast, or hold crouch while running. Flat ground: starts at run speed and decays. Downhill: accelerates with slope, up to a cap. Uphill: decays quickly. Limited steering. Momentum is kept when the ground drops away. Sprint or jump ends it. A slide-jump keeps a boost multiplier. A jump at a ledge after a downhill slide is a **boosted jump** with extra lift. Sprinting at the end of a slide chains straight back into sprint. A **slide kick** on an enemy or destructible deals small damage and knockback (per-target cooldown, flag).
- **Mantle / hurdle / vault:** a ledge probe casts a chest-height forward ray, checks the wall normal, casts down to find the ledge top, then shape-casts for clearance. Ledges 0.5–2.3 m: mantle along a bezier path with a brief input lock. Obstacles ≤ 1.1 m with ground behind: hurdle that keeps forward speed. Jump while running into an obstacle auto-hurdles. A mantle while falling cancels the fall with no damage. Weapons need a raise delay after a mantle.
- **Shoulder bash:** sprinting or sliding into a closed door swings it open (rotating prop), one door per sprint.
- **Roll landing:** jump pressed just before a high-fall impact reduces fall damage and refunds a little stamina.
- **Skydive:** free fall with steering, dive speed and terminal velocity. The glider auto-deploys at its altitude. The player can cut the glider and free-fall the rest.
- **Glider:** forward speed and sink, with W/S trade-offs and banking. Closes automatically near the ground. **Redeploy:** after a fast, long enough fall (cliffs, towers, launch pads), the glide key reopens it, with a cooldown. Glider landings take no fall damage.
- **Fall damage:** `clamp((impact − 14) · 3.2, 0, 100)`. Modern rule (default, unranked): a would-be lethal fall leaves 1 HP, clears shield and overshield, and plays a ~1.5 s splat during which the player cannot act. Classic rule (flag): lethal.
- **Camera:** over-the-shoulder at offset (0.55, 1.6, −3.2), smooth shoulder swap, spring-arm collision, per-weapon ADS FOV/offset blend, sprint FOV kick, slide lowering and roll, landing dip, trauma shake, recoil kick. ADS works mid-air with every weapon and from the bus.
- **Held item:** Q selects the Pickaxe, 1-5 the hotbar slots. The item is lowered while sprinting, mantling, hurdling, rolling, skydiving, gliding or splatted, and needs a short raise time afterwards.
- **Doors:** Interact (E) opens or closes the nearest door; doors always swing away from whoever opens them.
- **Launch pads:** throw the character high into the air; at the apex it skydives, and the glider opens on its own at 120 m above ground.
- **Sprint modes** (setting): hold, toggle, or auto (always sprint when moving forward; holding the key walks).
- **F9 self-test** runs scripted checks for every move and reports pass/fail on screen.

## 3. Combat
- **Damage pipeline:** raw damage × zone multiplier (head/body/limb) × falloff, with teammate damage blocked. The result goes to **Overshield → Shield → Health**, overflowing within one hit. Storm damage goes straight to health.
- **Overshield (Zero Build signature):** regenerates after a delay since the last damage; any damage resets the delay. An elimination refills it (flag). Pocket-item self-damage does not reset regen (flag). Breaks emit a `overshieldBreak` event (gold ring shatter, deep metallic sound). Shield breaks emit `shieldBreak` (cyan glass).
- **Hitboxes:** analytic only (a head sphere plus body and limb capsules from the animation pose), so the server can rewind them. Static world geometry is in Rapier.
- **Hitscan:** a camera ray through the bloomed crosshair finds the aim point. The shot is then revalidated from the muzzle, so close cover blocks it. Spread is seeded per shot (`matchSeed ^ entityId ^ shotIndex`). Bloom grows per shot and recovers after a grace period, with stance multipliers. Recoil is a vertical kick plus seeded horizontal drift, with recovery and an ADS multiplier, plus sway.
- **Projectiles:** fixed-step ballistics with gravity and drag, and a raycast per step for continuous collision. The launch direction is solved so the arc meets the crosshair target. Rockets: direct plus radial splash with line-of-sight, 50% self-damage, knockback, barrel chains, prop destruction.
- **Rarity:** five tiers. Each tier up never makes a stat worse.
- **Weapons:** Assault Rifle, Pump Shotgun, Tactical SMG, Bolt-Action Sniper Rifle (projectile, 4x scope overlay), Rocket Launcher (projectile), Pistol (starter), Pickaxe (harvest; props have a moving weak point that crits x2). Data lives in `weapons.json`.
- **Ammo pools** have caps. Ammo is auto-picked-up.
- **Cover:** environment props take x0.6 bullet damage but break to explosions and Pickaxe crits.
- `tools/balance-report.ts` prints DPS/TTK tables and asserts the range-role targets in the notes.

## 4. Inventory, loot, economy
- **Slots:** 5 hotbar (keys 1–5, scroll cycles), Pickaxe (Q), pocket item (V). Drop with G. Swap when full by holding E. Rearrange on the Tab screen with drag and drop. Stack limits per the notes.
- **Consumables:** the effect applies when the cast completes (Slurp: the drink completes, then regen ticks). A cast is cancelled by switching slot, mantle, slide, glide or death, but **not by damage**. Move speed x0.6 while casting. A cast bar is shown. Items refuse to start when they would do nothing.
- **Starting loadout** (flag): Pistol, 1 Small Shield Potion, 1 random Pocket Item.
- **Pocket items** (unlimited uses, cooldown): Shockwave Grenade (knockback only, self-boost allowed, pushes teammates), Med Mist Grenade (healing cloud), Shield Bubble (bullet-blocking dome). Swapped at Vending Machines for scrap.
- **Chests:** ~80, glowing, with a positional harmonic hum that stops when opened. Hold E to open. Contents pop out: guaranteed weapon + consumable + ammo, rarity weighted by tier.
- **Floor loot:** ~350 items with rarity light pillars (taller for higher rarity) and a pickup prompt with stat comparison.
- **Destructibles:** trees (fall), boulders (pooled debris chunks), crates, fuel barrels (explode and chain), shed panels, fences. They drop scrap and sometimes floor loot.
- **Upgrade Bench:** upgrades the held weapon by exactly one tier for scrap. **Vending Machines:** sell ammo and heals, and swap pocket items.
- **Death:** the full inventory drops in a pile with a beam. In team modes a Reboot Card drops too.

## 5. Match flow
1. **Launch Isle** (pre-game): free roam, a training range, bots milling and emoting, countdown.
2. **Battle Bus:** a seeded straight line across the island at the notes' speed and altitude. Players jump, follow a teammate, or are auto-ejected at the end. ADS is allowed.
3. **Drop:** skydive, then glider, with an optional cut.
4. **Storm:** ten data-driven phases (`storm.json`). The first circle appears after a delay. Each next circle is fully inside the current one. Damage ticks at 1 Hz outside. Visuals: violet energy wall with filaments and edge glow, danger fog tint, lightning, embers, a screen effect when inside the storm (desaturate, grain, vignette, shake per tick), next-circle ring, safe-zone beam. `?fast=1` uses the fast preset and `?stormscale=` scales times.
5. **Elimination:** with no living teammates, or in Solo, the player spectates the killer. Otherwise they spectate teammates while a Reboot Card exists.
6. **End:** placement tracking. The last team standing gets the **VICTORY ROYALE** screen with stats. "Play again" returns to the party lobby.

### Island: Driftglass Atoll (~2.4 km)
Procedural heightmap and biomes. 11 named POIs anchored by `POIS` in `names.ts` (Tilted Towers centre-west, Pleasant Park north-west, Retail Row east, Salty Springs south-centre, Lazy Lake north-east of centre, Loot Lake centre, Sweaty Sands west coast, Misty Meadows south-east, Holly Hedges south-west, Dirty Docks east coast, Steamy Stacks north-east). Each POI has walkable procedural buildings and one landmark. The island also has water with foam, triplanar/splat terrain, wind-animated instanced foliage, and cliffs and launch spots that make glider redeploy useful. Unnamed spots host Reboot Vans, Vending Machines and benches.

### Maps
Circular minimap (rotating or north-up). Full map on M with pan/zoom, POI names, storm circles and timers, bus route, pings, drop marker, and teammates in team colors.

## 6. Party and teams
- **PartyRoom** (separate from the match): create gives a 6-char code and a `?party=CODE` link. The creator is leader. Up to 4 slots show name, color, procedural avatar, ready state and ping in ms. Privacy: Public (listed as joinable, with leader name and mode) or Link-only (default). Friends-only is replaced by a local "recent teammates" list (localStorage).
- **Leader powers:** mode (Solo/Duos/Trios/Squads), promote, kick, fill (random players / bots / none). **Mute** is per viewer and hides that member's chat and pings for them only. Everyone readies, then the leader presses Play (or auto-queue when all are ready). If the leader leaves, the longest-present member is promoted. The party persists between matches.
- **Chat:** text only, length-limited, rate-limited, sanitized. Quick-comms show as icon + text.
- **Queue:** the leader queues the whole party. The queue groups same-mode parties into a MatchRoom via seat reservations, fills team slots per the fill setting, and tops the match up with bots after the fill wait. Default match size is 48 (max 100). `?offline=1` runs the same flow locally.
- **In match:** 4 colorblind-safe team colors; nameplates; friendly fire off for bullets, explosions and slide kick (pocket-item pushes still affect teammates); a team panel on the left (health/shield/overshield, name, state, distance, pocket cooldown); off-screen indicators; teammates on minimap and map; shared markers; follow-jump (hold key to eject with and trail a teammate).
- **Pings:** middle mouse. Tap = location (blue), double-tap or ping on an enemy = danger (red), ping on an item/chest = item marker (icon, rarity color, distance). Hold = quick-comms wheel. Markers render in the world (through walls with distance), on the compass, minimap and map, in the pinger's team color. One active ping per player. Each kind has its own lifetime and sound. Anti-spam collapsing as in the notes.
- **Reboot:** an eliminated teammate drops a Reboot Card (original icon). Teammates collect it by walking over it. It expires after its lifetime or when the whole team is eliminated. At a Reboot Van, holding interact for 10 s reboots **all** carried cards. Releasing drains progress, and resuming continues from the current level. Several holders speed it up. While charging, the van plays a loud sound and shows a blue beacon visible from far away (a tell for enemies). On completion: two beeps and a rift effect, and each rebooted player respawns at the van with the starter Pistol, full health and no shield. Then the van is on cooldown and chimes when ready. Vans are inert and hidden in Solo.
- **DBNO** (flag, default off): a lethal hit downs the player, who crawls and bleeds out. Teammates revive (movement interrupts it). Enemies can finish.

## 7. Bots (`src/shared/ai`, pure)
- Bots drive the **same** PlayerSim/WeaponSim through `InputFrame`s as humans, so the server can host them unchanged.
- Difficulty Easy / Normal / Hard / Mixed, with the skill knobs from the notes. No wallhacks: vision is a cone with LOS rays, and hearing reacts to gunshots within a radius. Bloom, recoil and fire-rate limits are the same as for humans.
- Utility AI states: LOBBY, DROP, LOOT, ROTATE, ENGAGE, FLEE/HEAL, STORM_ESCAPE (top priority), TEAMWORK (cohesion ~25 m, ping sharing, card pickup and reboot, follow the human leader's drop).
- Locomotion: look-ahead raycast steering, jump and mantle via the shared ledge probe, stuck detection (re-path, jump, reverse), water avoidance, terrain waypoints.
- Decisions run at 10 Hz, staggered per bot. The sim runs at 60 Hz. Bots far from every human use a cheaper LOD.
- 576 generated two-word names. An optional "BOT" badge.
- Tests: a headless bot-only match is deterministic by seed, has no stuck bots, and has at least one elimination.

## 8. HUD and UI (DOM/CSS/SVG, store-driven, < 1 ms/frame)
Layout: vitals bottom-left (energy above overshield-gold above shield-blue above health-green, with ghost trails and shatter animations). Hotbar bottom-right (5 slots + Pickaxe + pocket item, rarity borders, ammo, scrap). Minimap top-right with compass top-centre. Kill feed and alive/elim counters at top-right under the minimap. Storm banner top-centre. Team panel on the left. Cast bar and interaction prompts at centre-bottom. Dynamic per-class crosshair whose gap equals the **real bloom angle**, and a sniper scope overlay. Hitmarkers (white health, cyan shield, gold overshield, red headshot, kill X). Merged world-space damage numbers. Directional damage arcs.

Screens: start menu (shows the fan notice), party lobby, inventory (Tab), map (M), pause, settings (graphics presets, render scale, dynamic resolution, FOV, sensitivity and ADS sensitivity, rebinding, audio buses, crosshair editor, HUD scale, colorblind palettes, reduce motion/flashing, subtitles; localStorage with versioned migration), end screen.

Style: flat, bold, slightly rounded geometric UI. Palette deep teal `#0F2A33`, sand `#F2E3C6`, signal orange `#FF7A3D`, storm violet `#8A4BFF`. 3D look: stylized cel-band and rim-lit PBR. (No `reference/` image folder was supplied in M0, so `UI_REFERENCE_NOTES.md` was not created. The layout above is the default.)

## 9. Audio (Web Audio, procedural)
Per-class weapon sounds with distance variants. Material impacts. Distinct shield and overshield breaks. Surface footsteps. Slide, glider and wind loops. Positional chest hum. Pickup chimes by rarity. Consumable loops. Destruction and explosions. Storm ambience, bus hum, per-type ping tones, van charging and beeps, UI sounds. A voice limiter and master compressor. No audio before the first user gesture.

## 10. Graphics
WebGPURenderer with automatic WebGL2 fallback (`?renderer=webgl`). TSL materials. Sun with CSMShadowNode cascades, gradient sky with time of day, ACES filmic tone mapping, bloom, GTAO, vignette via `RenderPipeline`. Chunked-LOD terrain, instanced wind foliage, stylized water, GPU compute particles (CPU instanced fallback). Quality presets Low/Medium/High/Ultra plus a dynamic resolution scaler. Budgets: 60 fps at 1080p Medium on an iGPU, < 300 draw calls, 50 offline bots ≥ 45 fps.

## 11. Debug and URL flags
Keys: F3 stats, F4 probes, F5 VFX menu, F8 give-items/god, F9 self-test, F10 loot overlay, F11 audio panel.
Flags: `?seed= ?bots= ?offline=1 ?renderer=webgl ?quality= ?fast=1 ?stormscale= ?skipbus=1 ?god=1 ?team=duos ?lag= ?demo=1 ?party=CODE`.
Errors are shown as loud on-screen panels, never only in the console.

## 12. Event list (sim → client), initial contract
`shot`, `hit{target,dmg,layer,head}`, `shieldBreak`, `overshieldBreak`, `elim{killer,victim,weapon}`, `explosion`, `propDestroyed`, `chestOpened`, `pickup`, `castStart/castEnd/castCancel`, `pocketUsed`, `mantle`, `slideStart/End`, `land{speed,roll,splat}`, `gliderOpen/Close`, `busJump`, `stormPhase`, `stormTick`, `ping{kind,pos,team}`, `rebootCardDrop/Pickup/Expire`, `rebootProgress`, `rebootComplete`, `vanReady`, `matchEnd{placement}`. The full payloads are defined in `ARCHITECTURE.md` and grow per milestone.
