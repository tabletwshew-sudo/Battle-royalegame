import { DEFAULT_QUALITY, isQualityName, type QualityName } from "./Quality";

/**
 * Player settings persisted in localStorage with a version number so older
 * saves can be migrated. Storage is injected, which keeps this testable in Node.
 */
export const SETTINGS_VERSION = 1;
export const SETTINGS_KEY = "driftglass.settings";

export interface Settings {
  version: number;
  quality: QualityName;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Mouse look multiplier (1 = default). */
  mouseSensitivity: number;
  invertY: boolean;
  /** Whether the F3 stats overlay is shown. */
  showStats: boolean;
}

export const SETTINGS_LIMITS = {
  fov: { min: 60, max: 110 },
  mouseSensitivity: { min: 0.1, max: 5 },
} as const;

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    quality: DEFAULT_QUALITY,
    fov: 80,
    mouseSensitivity: 1,
    invertY: false,
    showStats: false,
  };
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Turns whatever was found in storage into valid current-version settings.
 * Unknown or damaged fields fall back to defaults; saves from a newer
 * version than this build understands are discarded.
 */
export function migrateSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (typeof raw !== "object" || raw === null) return base;
  const data = raw as Record<string, unknown>;
  const version = typeof data["version"] === "number" ? data["version"] : 0;
  if (version > SETTINGS_VERSION) return base;
  // Version 0 (pre-release saves without a version field) used "sensitivity".
  const sensitivity = version === 0 && data["mouseSensitivity"] === undefined ? data["sensitivity"] : data["mouseSensitivity"];
  return {
    version: SETTINGS_VERSION,
    quality: isQualityName(data["quality"]) ? data["quality"] : base.quality,
    fov: numberIn(data["fov"], SETTINGS_LIMITS.fov.min, SETTINGS_LIMITS.fov.max, base.fov),
    mouseSensitivity: numberIn(
      sensitivity,
      SETTINGS_LIMITS.mouseSensitivity.min,
      SETTINGS_LIMITS.mouseSensitivity.max,
      base.mouseSensitivity,
    ),
    invertY: typeof data["invertY"] === "boolean" ? data["invertY"] : base.invertY,
    showStats: typeof data["showStats"] === "boolean" ? data["showStats"] : base.showStats,
  };
}

/** The subset of the Web Storage API that the store needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(settings: Settings) => void>();

  /** @param storage localStorage, or null when storage is unavailable (private mode) */
  constructor(private readonly storage: StorageLike | null) {
    this.current = this.load();
  }

  get value(): Readonly<Settings> {
    return this.current;
  }

  /** Applies a partial change, validates it, saves and notifies listeners. */
  update(patch: Partial<Settings>): void {
    this.current = migrateSettings({ ...this.current, ...patch, version: SETTINGS_VERSION });
    this.save();
    for (const listener of this.listeners) listener(this.current);
  }

  /** Subscribes to changes; returns an unsubscribe function. */
  subscribe(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private load(): Settings {
    if (this.storage === null) return defaultSettings();
    try {
      const text = this.storage.getItem(SETTINGS_KEY);
      return text === null ? defaultSettings() : migrateSettings(JSON.parse(text));
    } catch {
      return defaultSettings();
    }
  }

  private save(): void {
    if (this.storage === null) return;
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.current));
    } catch {
      // Storage full or blocked: settings still apply for this session.
    }
  }
}

/** Returns window.localStorage, or null where it is blocked. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
