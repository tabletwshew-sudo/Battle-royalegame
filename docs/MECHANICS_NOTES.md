# Mechanics Notes (authority for tunables)

Every number here becomes a default in a config file (`src/shared/rules/*Config.ts` or `src/shared/data/*.json`) and can be tuned live in the debug panel.

**Source tags**
- `[SPEC]`: the project brief's number, adopted as the default.
- `[BG]`: the author's background knowledge of the reference game. **Not verified** in M0, because every reference fetch failed (see `REFERENCES.md`).
- `UNKNOWN: tunable`: no reliable number; the default shown is a design choice.

Where `[SPEC]` and `[BG]` disagree, `[SPEC]` is the default and the `[BG]` value is noted for later reconciliation.

---

## Movement
| Tunable | Default | Source / note |
|---|---|---|
| Run speed | 6.0 m/s | [SPEC] |
| Crouch speed | 3.0 m/s | [SPEC] |
| ADS walk | 3.5 m/s | [SPEC] |
| Tactical sprint | 8.5 m/s | [SPEC]; [BG] sprint is roughly 1.4x run, which matches |
| Gravity | 25 m/s² | [SPEC] |
| Jump apex | 1.2 m | [SPEC]; v0 = sqrt(2·g·h) ≈ 7.75 m/s |
| Coyote time / jump buffer | 0.10 s / 0.12 s | [SPEC] |
| Capsule | r 0.35, h 1.8, crouch h 1.1 | [SPEC] |
| Autostep / max slope | 0.45 m / 50° | [SPEC] |
| Stamina | 100 max, drain 10/s, regen 14/s after 0.8 s, start ≥ 15, empty lockout 0.5 s | [SPEC]; [BG] sprint drains a bar that refills on its own, and real numbers are not public → UNKNOWN: tunable |
| Sprint jump | +15% height, +20% forward carry | UNKNOWN: tunable |
| Pickaxe sprint | unlimited stamina while holding the Pickaxe (flag `pickaxeInfiniteSprint`, default on) | [SPEC] (2026 overhaul) |
| Slide | entry speed ≥ 5.5 m/s; flat decay 4 m/s²; downhill `speed += g·sin(slope)·1.0`; uphill decay 12 m/s²; cap 20 m/s; steer 70°/s; slide-jump x1.15 | [SPEC] cap/steer/boost; decays UNKNOWN: tunable |
| Slide kick | on, 15 dmg + 6 m/s knockback, 10 s per-target cooldown | [SPEC] |
| Mantle | ledge 0.5–2.3 m, path 0.3–0.75 s scaled by height, input lock 0.15 s, weapon raise delay 0.35 s | [SPEC] |
| Hurdle | obstacle ≤ 1.1 m with ground behind, keeps forward speed | [SPEC] |
| Shoulder bash | while sprinting/sliding, one door per sprint | [SPEC]; [BG] bash opens doors without breaking them |
| Roll landing | press jump within 0.15 s before impact: fall damage x0.5, +10 stamina | window/amounts UNKNOWN: tunable |
| Skydive | terminal 55 m/s, dive 75 m/s, auto-glider at 120 m AGL | [SPEC] |
| Glider | forward 22 m/s, sink 7 m/s, W: +4 fwd/+3 sink, S: −6 fwd/−2 sink, bank 60°/s, auto-close at 2 m | trade-offs UNKNOWN: tunable |
| Glider redeploy | after > 6 m fall at > 12 m/s; 1 s cooldown; glide landings take no fall damage | [SPEC] (2026 overhaul) |
| Fall damage | `clamp((v − 14)·3.2, 0, 100)`; modern non-lethal: a lethal fall leaves 1 HP, clears shield and overshield, 1.5 s "splat" | [SPEC]; [BG] classic mode is lethal at roughly 9+ m |

**M3 implementation notes** (design defaults chosen where the notes said UNKNOWN; all in `MovementConfig.ts`): slides start at max(current, 6 m/s), overspeed decel 9 m/s^2 keeps slide/launch momentum while running; boosted jump adds up to +3 m/s lift scaled by downhill excess speed; ledge probe reach grows by 0.06 s of travel; airborne grabs reach 0.25-1.1 m above the feet; roll window 0.2 s; glider A/D offset the heading by up to 35 deg; launch pads throw at 95 m/s (~180 m apex) and turn into a skydive at the apex.

## Health / Shield
| Tunable | Default | Source / note |
|---|---|---|
| Health | 100 | [SPEC] [BG] |
| Shield | 100 | [SPEC] [BG] |
| Overshield (Zero Build only) | 50, absorbs first | [SPEC]; [BG] Zero Build introduced a regenerating overshield of 50 |
| Overshield regen | delay 5.0 s after damage, 10/s | [SPEC]; [BG] the exact delay is not public → treated as tunable |
| Elim refills overshield | on, full | [SPEC] (2026 overhaul; "siphon") |
| Self pocket-item damage resets regen | off | [SPEC] |
| Damage order | multipliers → overshield → shield → health, with overflow in one hit | [SPEC] |

## Weapons
All values live in `weapons.json` (Common → Legendary). From [SPEC]:

| Weapon | Damage | Rate | Mag | Reload (s) | Head | Notes |
|---|---|---|---|---|---|---|
| Assault Rifle | 30/31/33/35/36 | 5.5/s | 30 | 2.7/2.6/2.5/2.4/2.2 | x1.5 | falloff 100% → 60 m, 75% at 120 m |
| Pump Shotgun | 70/80/90/100/110 per shot (10 pellets) | 0.7/s | 5 | 5.0/4.8/4.6/4.4/4.2 | x1.5 | full to ~15 m, 20% by 35 m |
| Tactical SMG | 13/14/15/16/17 | 15/s | 20/20/20/26/26 | 1.7/1.6/1.5/1.4/1.3 | x1.5 | |
| Bolt-Action Sniper | 100/104/108/112/116 | 0.33/s | 1 | 4.7/4.1/3.6/3.1/2.5 | x2.5 | projectile 320 m/s, gravity 4 m/s², 4x scope |
| Rocket Launcher | 100 direct + ≤100 splash in 4 m | 0.75/s | 1 | 3.2/3.0/2.8/2.5/2.2 | – | projectile 55 m/s, gravity 3, self-damage 50% |
| Pistol | 24 (Common) | 6.75/s | 16 | 1.6 | x1.5 | starter |
| Pickaxe | 20 players / 50 props (weak-point x2) | 0.55 s swing | – | – | – | |

- Bloom: base spread, per-shot growth and recovery after a 0.15 s grace are [SPEC]. Per-class spread angles are UNKNOWN: tunable. Defaults: AR base 0.6°, +0.35°/shot, max 3.5°; SMG 1.0°, +0.25°, 4°; Pistol 0.5°, +0.6°, 3°; Shotgun pellet cone 5.5° (no growth). Multipliers: ADS x0.5, moving x1.4, crouch x0.8, airborne x2.0, sliding x1.6.
- Recoil: vertical kick per shot plus seeded horizontal drift; ADS x0.6 [SPEC]. Magnitudes are UNKNOWN: tunable.
- Rarity colors: Common #B6BBC4, Uncommon #4CCB4A, Rare #3FA7FF, Epic #B05CFF, Legendary #FFB52E [SPEC].
- Ammo caps: light 250, medium 250, heavy 30, shells 50, rockets 12 [SPEC].
- Cover damage multiplier for bullets on environment: 0.6 [SPEC].
- Balance targets for `tools/balance-report.ts`: Pump wins < 10 m, SMG wins 10–25 m, AR best 20–60 m, Legendary sniper headshot is a two-shot threat. Note: with the [SPEC] numbers, a Legendary headshot is 116 × 2.5 = 290, which exceeds the 250 maximum effective HP (overshield 50 + shield 100 + health 100), so it is actually a one-shot kill. A body shot (116) needs three hits at full EHP. The spec numbers are kept. The balance report checks "kills in ≤ 2 shots when at least one hits the head", which these numbers satisfy. Reconcile in the M5 tuning pass, Rocket = area denial.

## Loot / Items
| Item | Effect | Cast | Cap | Stack | Source |
|---|---|---|---|---|---|
| Bandages | +15 HP | 3.0 s | to 75 HP | 15 | [SPEC]; [BG] cast closer to 3.5 s |
| Medkit | +100 HP | 10 s | 100 | 3 | [SPEC] [BG] |
| Small Shield Potion | +25 shield | 2.0 s | to 50 | 6 | [SPEC]; [BG] some seasons used 1 s |
| Shield Potion | +50 shield | 5.0 s | 100 | 3 | [SPEC] [BG] |
| Chug Jug | full HP + shield | 15 s | – | 1 | [BG]; name listed in R2 → included, rare drop |
| Slurp Juice | +75 total, HP first then shield, over 37.5 s (2 per 1 s tick) | 2 s | 100/100 | 2 | [BG]; gradual effect is the exception to "apply on completion": the 2 s drink completes, then the regen ticks. Exact numbers UNKNOWN: tunable |

- Effect applies when the cast completes. Damage does not cancel; slot switch, mantle, slide, glide or death does. Move speed x0.6 while casting. Items refuse to start if they would do nothing. [SPEC]
- Starting loadout (modern flag): Pistol + 1 Small Shield Potion + 1 Pocket Item [SPEC].
- Pocket items [SPEC] (unlimited uses, cooldown): Shockwave Grenade 25 s (radius 6 m, 18 m/s push, no damage); Med Mist Grenade 30 s (cloud 5 m, heals 40 HP over 4 s); Shield Bubble 20 s (dome r 3.5 m, 4 s, blocks bullets). Radii and amounts are UNKNOWN: tunable.
- Chests: ~80 per island, hum audible ≤ 35 m, guaranteed weapon + consumable + ammo, hold E for 0.5 s (UNKNOWN: tunable) [SPEC]. Tier weights in `loot.json`.
- Floor loot ~350 [SPEC]. Death drops the full inventory [SPEC][BG].
- Scrap upgrade costs 75/150/250/400 [SPEC]. Vending: 12 benches + 10 posts [SPEC]. Prices UNKNOWN: tunable (ammo 30, heal 60–120, pocket swap 100).

## Storm
[SPEC] table, matching the [BG] shape of the classic 9–10 phase storm:

| # | Radius m | Wait s | Shrink s | DPS |
|---|---|---|---|---|
| 1 | 1100 | 90 | 80 | 1 |
| 2 | 750 | 75 | 70 | 1 |
| 3 | 500 | 60 | 60 | 2 |
| 4 | 320 | 55 | 50 | 5 |
| 5 | 200 | 45 | 40 | 8 |
| 6 | 120 | 35 | 35 | 10 |
| 7 | 70 | 30 | 30 | 10 |
| 8 | 35 | 25 | 25 | 10 |
| 9 | 12 | 20 | 20 | 10 |
| 10 | 0 | 0 | 20 | 10 |

- First circle appears ~60 s after the bus finishes [SPEC]. Each next centre is seeded and fully inside the current circle. Damage ticks at 1 Hz and goes to health directly (bypasses shields) [BG]. That bypass is adopted as default `stormBypassesShield: true`.

## Bus / Glider
- Bus at 45 m/s, 250 m altitude, seeded straight line across the island, auto-eject at the end [SPEC]. ADS is allowed from the bus [SPEC].
- Bus door opens 3 s after it enters the island edge (UNKNOWN: tunable).

## Party
- Leader = creator; leader can promote, kick and mute; modes Solo/Duos/Trios/Squads; max 4; fill options; ready-up then the leader plays [SPEC][BG].
- Privacy: Public / Link-only. Friends-only is replaced by a local "recent teammates" list because there is no friend graph [SPEC].
- Party code: 6 chars from an unambiguous alphabet (no 0/O/1/I). UNKNOWN: tunable.

## Teams / Reboot / Pings
- Reboot Card lifetime 270 s (older versions 90 s) [SPEC][BG]. Expires if all living teammates are eliminated.
- Reboot: 10 s interaction; progress drains when released at 1 s per s (UNKNOWN: tunable); extra holders speed it up additively (+50% each, UNKNOWN: tunable); van cooldown 60 s [SPEC] ([BG] early versions used 120 s); beacon visible ~100 m; respawn with starter Pistol, 100 HP, 0 shield [SPEC].
- ~30 vans [SPEC]; inert in Solo.
- Pings: tap = location (30 s), double-tap or ping an enemy = danger (8 s), item ping shows icon + rarity + distance; one active ping per player; 3 pings on one target within 3 s collapse into one [SPEC].
- DBNO (off by default): bleed 1 HP/s from 100, revive 10 s, crawl 1.5 m/s. All UNKNOWN: tunable [SPEC].

## Bots
- Fill lobbies to shorten waits; low-to-medium skill; generic names; mill and emote on the pre-game island; a vs-bots practice playlist exists [SPEC][BG].
- Skill knobs [SPEC]: reaction 0.25–0.6 s, hearing 80–150 m, view cone 110°, identical bloom/recoil, fire rate ≤ the human limit, no wallhacks. Per-difficulty values are UNKNOWN: tunable:
  - Easy: reaction 0.6 s, aim noise 4°, turn 180°/s, hearing 80 m.
  - Normal: 0.4 s, 2.5°, 300°/s, 110 m.
  - Hard: 0.25 s, 1.2°, 480°/s, 150 m.
- Bot fill wait 15–30 s, default 20 s; match size 48 (max 100) [SPEC].

## Zero Build changes
- No building or editing at all; cover comes from terrain and props [SPEC][BG].
- Overshield layer of 50, regenerating [SPEC][BG].
- Mobility tuned up: tactical sprint, mantle and hurdle are core; the 2026 overhaul added an infinite Pickaxe sprint, non-lethal falls, glider redeploy, manual glider cut / free-fall, pocket items and a starting loadout [SPEC].
- Cover objects are tougher to bullets (x0.6) [SPEC].
- Resources dropped by props are "scrap", spent only at benches and vending machines [SPEC].
