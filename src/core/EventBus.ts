/**
 * Minimal typed publish/subscribe hub for client-side systems.
 * `M` maps event names to payload types.
 */
export class EventBus<M extends object> {
  private readonly listeners = new Map<keyof M, Set<(payload: never) => void>>();

  /** Subscribes and returns a function that unsubscribes. */
  on<K extends keyof M>(type: K, listener: (payload: M[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as (payload: never) => void);
    return () => this.off(type, listener);
  }

  off<K extends keyof M>(type: K, listener: (payload: M[K]) => void): void {
    this.listeners.get(type)?.delete(listener as (payload: never) => void);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.listeners.get(type);
    if (set === undefined) return;
    for (const listener of set) (listener as (payload: M[K]) => void)(payload);
  }

  /** Number of listeners for one event type. */
  count(type: keyof M): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}
