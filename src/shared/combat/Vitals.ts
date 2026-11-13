/**
 * Character vitals (GAME_SPEC §3): Overshield (Zero Build layer) -> Shield
 * -> Health. M3 introduces the layers for fall damage and the slide kick;
 * M5 adds headshots, hit zones and weapon damage on top of `applyDamage`.
 */
export interface VitalsConfig {
  maxHealth: number;
  maxShield: number;
  maxOvershield: number;
  /** Seconds without damage before the overshield starts recharging. */
  overshieldRegenDelay: number;
  /** Overshield recharge per second. */
  overshieldRegenRate: number;
}

export function defaultVitalsConfig(): VitalsConfig {
  return { maxHealth: 100, maxShield: 100, maxOvershield: 50, overshieldRegenDelay: 5, overshieldRegenRate: 10 };
}

export interface Vitals {
  health: number;
  shield: number;
  overshield: number;
  /** Seconds since the last damage that resets overshield regen. */
  sinceDamage: number;
}

/** A fresh character: full health and overshield, no shield (shield comes from items). */
export function freshVitals(config: VitalsConfig): Vitals {
  return { health: config.maxHealth, shield: 0, overshield: config.maxOvershield, sinceDamage: config.overshieldRegenDelay };
}

/** How much each layer lost in one hit. */
export interface DamageResult {
  overshield: number;
  shield: number;
  health: number;
  /** Layers that reached zero in this hit. */
  brokeOvershield: boolean;
  brokeShield: boolean;
  /** Health reached zero. */
  lethal: boolean;
}

/**
 * Applies damage through the layers with overflow carrying into the next
 * layer within the same hit. `resetsRegen` false is used for damage that
 * must not delay overshield recharge (e.g. own pocket items).
 */
export function applyDamage(vitals: Vitals, amount: number, resetsRegen = true): DamageResult {
  let left = Math.max(0, amount);
  const fromOvershield = Math.min(vitals.overshield, left);
  vitals.overshield -= fromOvershield;
  left -= fromOvershield;
  const fromShield = Math.min(vitals.shield, left);
  vitals.shield -= fromShield;
  left -= fromShield;
  const fromHealth = Math.min(vitals.health, left);
  vitals.health -= fromHealth;
  if (resetsRegen && amount > 0) vitals.sinceDamage = 0;
  return {
    overshield: fromOvershield,
    shield: fromShield,
    health: fromHealth,
    brokeOvershield: fromOvershield > 0 && vitals.overshield === 0,
    brokeShield: fromShield > 0 && vitals.shield === 0,
    lethal: fromHealth > 0 && vitals.health === 0,
  };
}

/** Damage that skips the shield layers (falls, storm). */
export function applyHealthDamage(vitals: Vitals, amount: number): DamageResult {
  const fromHealth = Math.min(vitals.health, Math.max(0, amount));
  vitals.health -= fromHealth;
  if (amount > 0) vitals.sinceDamage = 0;
  return {
    overshield: 0,
    shield: 0,
    health: fromHealth,
    brokeOvershield: false,
    brokeShield: false,
    lethal: fromHealth > 0 && vitals.health === 0,
  };
}

/** Advances overshield regeneration by one tick. */
export function tickVitals(vitals: Vitals, config: VitalsConfig, dt: number): void {
  vitals.sinceDamage += dt;
  if (vitals.health <= 0) return;
  if (vitals.sinceDamage >= config.overshieldRegenDelay && vitals.overshield < config.maxOvershield) {
    vitals.overshield = Math.min(config.maxOvershield, vitals.overshield + config.overshieldRegenRate * dt);
  }
}
