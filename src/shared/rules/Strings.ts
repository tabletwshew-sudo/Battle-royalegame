/**
 * All user-facing text labels in one place (R2). Fortnite terminology is used
 * as plain text labels only; change them here to rename anything in the game.
 * Pure data: safe for src/shared (no DOM, no runtime dependencies).
 */

export const GAME_TITLE = "DRIFTGLASS";
export const ISLAND_NAME = "Driftglass Atoll";
export const LOBBY_ISLAND_NAME = "Launch Isle";

/** Required on the start menu and in README (R2 d). */
export const FAN_NOTICE = "Unofficial fan project, not affiliated with Epic Games.";

export const MODE_LABELS = {
  solo: "Solo",
  duos: "Duos",
  trios: "Trios",
  squads: "Squads",
} as const;
export type ModeId = keyof typeof MODE_LABELS;

export const RARITY_LABELS = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
} as const;
export type RarityId = keyof typeof RARITY_LABELS;

export const TERMS = {
  victory: "VICTORY ROYALE",
  storm: "The Storm",
  stormClosing: "Storm is shrinking",
  stormForming: "Storm eye forming",
  bus: "Battle Bus",
  jump: "Jump",
  glider: "Glider",
  pickaxe: "Pickaxe",
  chest: "Chest",
  vendingMachine: "Vending Machine",
  upgradeBench: "Upgrade Bench",
  rebootCard: "Reboot Card",
  rebootVan: "Reboot Van",
  overshield: "Overshield",
  shield: "Shield",
  health: "Health",
  stamina: "Energy",
  pocketItem: "Pocket Item",
  scrap: "Scrap",
  eliminated: "Eliminated",
  spectating: "Spectating",
  playAgain: "Play again",
  ready: "Ready",
  play: "Play",
  bot: "BOT",
} as const;

export const FILL_LABELS = {
  players: "Fill with random players",
  bots: "Fill with bots",
  none: "No fill",
} as const;
export type FillId = keyof typeof FILL_LABELS;

export const PRIVACY_LABELS = {
  public: "Public",
  link: "Link-only",
} as const;
export type PrivacyId = keyof typeof PRIVACY_LABELS;

/** Quick-comms wheel entries (ping key held). */
export const QUICK_COMMS = {
  attack: "Attack here",
  defend: "Defend here",
  needAmmo: "Need ammo",
  needHeals: "Need heals",
  looting: "Looting",
  stormClosing: "Storm closing",
} as const;
export type QuickCommId = keyof typeof QUICK_COMMS;

export const PING_LABELS = {
  location: "Location",
  enemy: "Enemy spotted",
  item: "Item",
} as const;
export type PingKindId = keyof typeof PING_LABELS;
