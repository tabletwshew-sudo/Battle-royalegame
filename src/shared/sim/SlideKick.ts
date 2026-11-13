import type { EventQueue } from "./Events";
import type { PlayerController } from "./PlayerSim";

/**
 * Slide kick (GAME_SPEC §2, RulesConfig.slideKick): a sliding character that
 * reaches an opponent deals a little damage and knocks them away, once per
 * target per cooldown. Checked after all characters moved this tick, with a
 * reach large enough that the kick lands before the capsules collide.
 *
 * @param sameTeam teammates are never kicked (friendly fire off)
 * @returns ids of characters the kicks eliminated
 */
export function resolveSlideKicks(
  characters: readonly PlayerController[],
  sameTeam: (a: number, b: number) => boolean,
  tick: number,
  events: EventQueue,
): number[] {
  const eliminated: number[] = [];
  for (const attacker of characters) {
    const a = attacker.state;
    const c = attacker.config;
    if (a.mode !== "slide" || attacker.horizontalSpeed < c.slideKickMinSpeed) continue;
    const speed = attacker.horizontalSpeed;
    const dirX = a.vx / speed;
    const dirZ = a.vz / speed;
    for (const target of characters) {
      if (target === attacker || sameTeam(attacker.id, target.id)) continue;
      const t = target.state;
      const dx = t.x - a.x;
      const dz = t.z - a.z;
      const distance = Math.hypot(dx, dz);
      if (distance > c.capsuleRadius * 2 + c.slideKickRange || Math.abs(t.y - a.y) > 1.2) continue;
      // Only what is in front of the slide.
      if (distance > 1e-6 && (dx * dirX + dz * dirZ) / distance < 0.3) continue;
      if (!attacker.tryStartKickCooldown(target.id)) continue;
      const pushX = distance > 1e-6 ? dx / distance : dirX;
      const pushZ = distance > 1e-6 ? dz / distance : dirZ;
      target.applyKnockback(pushX * c.slideKickKnockback, 4, pushZ * c.slideKickKnockback);
      const lethal = target.takeDamage(c.slideKickDamage);
      events.push("slideKick", tick, { attacker: attacker.id, target: target.id, damage: c.slideKickDamage });
      if (lethal) {
        events.push("eliminated", tick, { id: target.id, cause: "slideKick", by: attacker.id });
        eliminated.push(target.id);
      }
    }
  }
  return eliminated;
}
