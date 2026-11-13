/**
 * Sim -> presentation events. The sim never calls rendering or audio code;
 * it pushes plain data events here and clients drain them once per tick.
 * Each milestone adds its events to SimEventMap.
 */
export interface SimEventMap {
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
