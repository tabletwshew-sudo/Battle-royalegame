/**
 * Display names for weapons, items, POIs and bots (R2). Labels only: every
 * model, icon and sound for these is generated procedurally elsewhere.
 * Pure data: safe for src/shared.
 */

export const WEAPON_NAMES = {
  assaultRifle: "Assault Rifle",
  pumpShotgun: "Pump Shotgun",
  tacticalSmg: "Tactical SMG",
  boltSniper: "Bolt-Action Sniper Rifle",
  rocketLauncher: "Rocket Launcher",
  pistol: "Pistol",
  pickaxe: "Pickaxe",
} as const;
export type WeaponId = keyof typeof WEAPON_NAMES;

export const CONSUMABLE_NAMES = {
  bandages: "Bandages",
  medkit: "Medkit",
  smallShield: "Small Shield Potion",
  shieldPotion: "Shield Potion",
  chugJug: "Chug Jug",
  slurpJuice: "Slurp Juice",
} as const;
export type ConsumableId = keyof typeof CONSUMABLE_NAMES;

export const POCKET_ITEM_NAMES = {
  shockwave: "Shockwave Grenade",
  medMist: "Med Mist Grenade",
  shieldBubble: "Shield Bubble",
} as const;
export type PocketItemId = keyof typeof POCKET_ITEM_NAMES;

export const AMMO_NAMES = {
  light: "Light Bullets",
  medium: "Medium Bullets",
  heavy: "Heavy Bullets",
  shells: "Shells",
  rockets: "Rockets",
} as const;
export type AmmoId = keyof typeof AMMO_NAMES;

/**
 * Named POIs on Driftglass Atoll. `u`,`v` are normalized map coordinates
 * (0..1, north-up, origin top-left) that the island generator (M4) uses as
 * anchor points. The relative layout loosely follows the reference island.
 */
export interface PoiName {
  readonly id: string;
  readonly name: string;
  readonly u: number;
  readonly v: number;
  /** Drop-weight hint for bots: hot drops are bigger and lootier. */
  readonly hot: boolean;
}

export const POIS: readonly PoiName[] = [
  { id: "tilted", name: "Tilted Towers", u: 0.36, v: 0.52, hot: true },
  { id: "pleasant", name: "Pleasant Park", u: 0.33, v: 0.27, hot: false },
  { id: "retail", name: "Retail Row", u: 0.72, v: 0.5, hot: true },
  { id: "salty", name: "Salty Springs", u: 0.58, v: 0.6, hot: false },
  { id: "lazy", name: "Lazy Lake", u: 0.62, v: 0.36, hot: false },
  { id: "lootlake", name: "Loot Lake", u: 0.47, v: 0.4, hot: false },
  { id: "sweaty", name: "Sweaty Sands", u: 0.16, v: 0.36, hot: false },
  { id: "misty", name: "Misty Meadows", u: 0.8, v: 0.75, hot: false },
  { id: "holly", name: "Holly Hedges", u: 0.26, v: 0.66, hot: false },
  { id: "docks", name: "Dirty Docks", u: 0.86, v: 0.3, hot: false },
  { id: "steamy", name: "Steamy Stacks", u: 0.78, v: 0.16, hot: true },
] as const;

/**
 * Bot name parts. Names are "Prefix Suffix" pairs (original, generic words).
 * 24 x 24 = 576 combinations, well above the 200 required.
 */
export const BOT_NAME_PREFIXES: readonly string[] = [
  "Amber", "Brisk", "Copper", "Dusty", "Ember", "Frosty", "Glassy", "Hazy",
  "Ivory", "Jolly", "Kelp", "Lunar", "Mossy", "Nimble", "Onyx", "Pebble",
  "Quartz", "Rusty", "Salty", "Tidal", "Umber", "Velvet", "Windy", "Zesty",
];

export const BOT_NAME_SUFFIXES: readonly string[] = [
  "Otter", "Falcon", "Gecko", "Badger", "Heron", "Lynx", "Marlin", "Newt",
  "Puffin", "Quokka", "Raven", "Stoat", "Tapir", "Urchin", "Vole", "Walrus",
  "Yak", "Beacon", "Comet", "Drifter", "Echo", "Harbor", "Pilot", "Rover",
];

/** Generic display names allowed for the local player's default name. */
export const DEFAULT_PLAYER_NAMES: readonly string[] = ["Jonesy", "Drifter", "Rookie", "Wayfarer"];
