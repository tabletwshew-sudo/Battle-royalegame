/**
 * Sim -> presentation events. The sim never calls rendering or audio code;
 * it pushes plain data events here and clients drain them once per tick.
 * Each milestone adds its events to SimEventMap.
 */
export interface SimEventMap {
  /** A character left the ground by jumping. Position is the take-off point (feet). */
  jump: { id: number; x: number; y: number; z: number; sprint: boolean; slide: boolean; boosted: boolean };
  /**
   * A character touched down. `speed` is the downward impact speed in m/s,
   * `damage` the fall damage actually taken (after a roll), `roll` whether it
   * rolled and `splat` whether a would-be-lethal fall left it at 1 HP.
   */
  land: { id: number; speed: number; x: number; y: number; z: number; damage: number; roll: boolean; splat: boolean };
  /** A character was put back at its spawn (fell out of the world, or eliminated in the sandbox). */
  respawn: { id: number; x: number; y: number; z: number; reason: "killPlane" | "eliminated" };
  /** Health reached zero (classic lethal falls, slide kicks on a weak target). */
  eliminated: { id: number; cause: "fall" | "slideKick"; by: number };
  sprintStart: { id: number };
  sprintEnd: { id: number };
  /** Stamina ran out mid-sprint (sprint is locked out briefly). */
  staminaEmpty: { id: number };
  slideStart: { id: number; speed: number };
  slideEnd: { id: number; speed: number };
  /** A mantle or hurdle started; `height` is the obstacle top above the feet. */
  traverse: { id: number; kind: "mantle" | "hurdle"; height: number; airborne: boolean };
  /** A door was bashed, opened or closed by character `by`. */
  door: { door: number; by: number; action: "bash" | "open" | "close" };
  /** A launch pad threw a character into the air. */
  launch: { id: number; x: number; y: number; z: number };
  skydiveStart: { id: number };
  gliderOpen: { id: number; redeploy: boolean };
  gliderClose: { id: number; cut: boolean };
  slideKick: { attacker: number; target: number; damage: number };
  /** A character fell or walked into deep water (start of a swim). */
  splash: { id: number; x: number; y: number; z: number };
  /** The held slot changed (0 = Pickaxe, 1-5 = hotbar). */
  equip: { id: number; slot: number };
  /** Sandbox: a radial impulse was applied at a point. */
  sandboxKick: { x: number; y: number; z: number; bodies: number };
  /** Sandbox: all crates were re-seeded and dropped again. */
  sandboxRespawn: { generation: number; crates: number };
}

export type SimEventType = keyof SimEventMap;

/** Discriminated union of every event, each stamped with the tick it happened on. */
export type SimEvent = {
  [K in SimEventType]: { readonly type: K; readonly tick: number } & Readonly<SimEventMap[K]>;
}[SimEventType];

export class EventQueue {
  private events: SimEvent[] = [];

  /** Records an event for the given tick. */
  push<K extends SimEventType>(type: K, tick: number, payload: SimEventMap[K]): void {
    this.events.push({ type, tick, ...payload } as unknown as SimEvent);
  }

  get length(): number {
    return this.events.length;
  }

  /** Returns all queued events in emission order and empties the queue. */
  drain(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
