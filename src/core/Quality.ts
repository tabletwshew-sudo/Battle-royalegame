/**
 * Graphics quality presets. M1 applies resolution scale and antialiasing;
 * later milestones extend each preset (shadows, post effects, foliage density).
 */
export const QUALITY_NAMES = ["low", "medium", "high", "ultra"] as const;
export type QualityName = (typeof QUALITY_NAMES)[number];

export interface QualityPreset {
  readonly name: QualityName;
  /** Fraction of the display resolution that is actually rendered. */
  readonly renderScale: number;
  /** Upper limit for the device pixel ratio before scaling. */
  readonly maxPixelRatio: number;
  /** Multisample antialiasing (fixed when the renderer is created). */
  readonly antialias: boolean;
}

export const QUALITY_PRESETS: Readonly<Record<QualityName, QualityPreset>> = {
  low: { name: "low", renderScale: 0.6, maxPixelRatio: 1, antialias: false },
  medium: { name: "medium", renderScale: 0.8, maxPixelRatio: 1, antialias: true },
  high: { name: "high", renderScale: 1, maxPixelRatio: 1.5, antialias: true },
  ultra: { name: "ultra", renderScale: 1, maxPixelRatio: 2, antialias: true },
};

export const DEFAULT_QUALITY: QualityName = "medium";

export function isQualityName(value: unknown): value is QualityName {
  return typeof value === "string" && (QUALITY_NAMES as readonly string[]).includes(value);
}

/** Picks the preset: URL flag first, then the saved setting, then the default. */
export function resolveQuality(flag: string | null, saved: string): QualityPreset {
  if (isQualityName(flag)) return QUALITY_PRESETS[flag];
  if (isQualityName(saved)) return QUALITY_PRESETS[saved];
  return QUALITY_PRESETS[DEFAULT_QUALITY];
}

/** Pixel ratio to hand to the renderer for a given display. */
export function effectivePixelRatio(preset: QualityPreset, devicePixelRatio: number): number {
  const base = Math.min(Math.max(devicePixelRatio, 0.5), preset.maxPixelRatio);
  return base * preset.renderScale;
}
