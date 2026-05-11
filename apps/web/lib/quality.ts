/**
 * Quality preset resolver, Phase 3.
 *
 * Per `docs/27c-fidelity-phase3-stadium-crowd.md` § "Post-processing":
 *
 *   | Quality | SSAO | Motion Blur | Shadow Cascade | DOF | Bloom | Vignette |
 *   | low     | off  | off         | 1024²          | off | min   | on       |
 *   | medium  | low  | off         | 2048²          | rep | on    | on       |
 *   | high    | full | on          | 4096²          | rep | on    | on       |
 *
 * URL flag override: `?quality=low|medium|high|auto` and a hard
 * "all-off" escape hatch `?fx=off` per the agent prompt's explicit
 * requirement (every post-FX must be bypassable via a single flag).
 *
 * `auto` is resolved from `navigator.deviceMemory` (GB) +
 * `navigator.hardwareConcurrency` (logical cores) heuristics. A
 * device-hint of `mobile` (UA contains `Mobi` / `Android`) further
 * caps the preset at `medium`.
 *
 * Pure module, no React, no Three, fully unit-testable in jsdom.
 */

export type QualityPreset = "low" | "medium" | "high";
export type QualityFlag = QualityPreset | "auto" | "off";

export interface QualityProfile {
  /** Active preset name. `null` when fx is fully off. */
  preset: QualityPreset | null;
  /** Hard-off switch, if true the renderer should not mount PostFX at all. */
  fxOff: boolean;
  /** Effect toggles. */
  ssao: boolean;
  ssaoSamples: number;
  motionBlur: boolean;
  /** Shadow map cascade size (pixels per side). */
  shadowMapSize: number;
  /** Depth-of-field allowed at all (still gated on goal-replay). */
  depthOfField: boolean;
  bloomIntensity: number;
  vignette: boolean;
  vignetteOffset: number;
  vignetteDarkness: number;
  /** Subtle film grain. */
  filmGrain: boolean;
  /** Chromatic aberration on goal-replay. */
  chromaticAberration: boolean;
}

export interface DeviceHint {
  /** GB of device RAM, or undefined if not exposed by the browser. */
  deviceMemory?: number;
  /** Logical CPU cores, or undefined if not exposed. */
  hardwareConcurrency?: number;
  /** Is this a mobile device per UA sniff. */
  isMobile?: boolean;
}

const PROFILES: Record<QualityPreset, QualityProfile> = {
  low: {
    preset: "low",
    fxOff: false,
    ssao: false,
    ssaoSamples: 0,
    motionBlur: false,
    shadowMapSize: 1024,
    depthOfField: false,
    bloomIntensity: 0.2,
    vignette: true,
    vignetteOffset: 0.15,
    vignetteDarkness: 0.9,
    filmGrain: false,
    chromaticAberration: false,
  },
  medium: {
    preset: "medium",
    fxOff: false,
    ssao: true,
    ssaoSamples: 7,
    motionBlur: false,
    shadowMapSize: 2048,
    depthOfField: true,
    bloomIntensity: 0.4,
    vignette: true,
    vignetteOffset: 0.1,
    vignetteDarkness: 1.0,
    filmGrain: true,
    chromaticAberration: true,
  },
  high: {
    preset: "high",
    fxOff: false,
    ssao: true,
    ssaoSamples: 11,
    motionBlur: true,
    shadowMapSize: 4096,
    depthOfField: true,
    bloomIntensity: 0.5,
    vignette: true,
    vignetteOffset: 0.1,
    vignetteDarkness: 1.1,
    filmGrain: true,
    chromaticAberration: true,
  },
};

/**
 * Build the "fx fully off" profile, every flag false, preset null.
 * The renderer treats this as "do not mount the EffectComposer at all".
 */
export function fxOffProfile(): QualityProfile {
  return {
    preset: null,
    fxOff: true,
    ssao: false,
    ssaoSamples: 0,
    motionBlur: false,
    shadowMapSize: 1024,
    depthOfField: false,
    bloomIntensity: 0,
    vignette: false,
    vignetteOffset: 0,
    vignetteDarkness: 0,
    filmGrain: false,
    chromaticAberration: false,
  };
}

/**
 * Resolve a `QualityFlag` (typically from `?quality=` and `?fx=`) to a
 * concrete profile. The `?fx=off` escape hatch takes priority over
 * everything.
 */
export function resolveQuality(
  flag: QualityFlag | undefined,
  hint: DeviceHint = {},
  fxFlag?: "off" | "on" | undefined,
): QualityProfile {
  if (fxFlag === "off") return fxOffProfile();
  if (flag === "off") return fxOffProfile();

  const preset =
    flag && flag !== "auto" ? flag : autoResolve(hint);

  return PROFILES[preset];
}

/**
 * Auto-resolve a preset from device hints. Conservative mid-2026
 * heuristics:
 *
 *   - deviceMemory < 4 OR cores < 4 → low
 *   - deviceMemory >= 8 AND cores >= 8 AND !mobile → high
 *   - else → medium
 */
export function autoResolve(hint: DeviceHint): QualityPreset {
  const mem = hint.deviceMemory;
  const cores = hint.hardwareConcurrency;
  const mobile = hint.isMobile === true;

  // Low-spec gate.
  if ((mem !== undefined && mem < 4) || (cores !== undefined && cores < 4)) {
    return "low";
  }

  // High-spec gate (desktop only).
  if (
    !mobile &&
    mem !== undefined &&
    mem >= 8 &&
    cores !== undefined &&
    cores >= 8
  ) {
    return "high";
  }

  // Mobile is capped at medium even with strong hints.
  return "medium";
}

/**
 * Parse a query-string into a `QualityFlag` + an `fx` override. Pure
 *, accepts the search string (with or without leading `?`).
 */
export function parseQualityFromSearch(
  search: string,
): { quality: QualityFlag; fx: "off" | "on" | undefined } {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const q = (params.get("quality") ?? "auto") as QualityFlag;
  const fxRaw = params.get("fx");
  const fx: "off" | "on" | undefined =
    fxRaw === "off" ? "off" : fxRaw === "on" ? "on" : undefined;

  // Validate quality.
  const valid: QualityFlag[] = ["low", "medium", "high", "auto", "off"];
  const quality = (valid.includes(q) ? q : "auto") as QualityFlag;
  return { quality, fx };
}

/**
 * Read the current document's URL + navigator hints and return a
 * full profile. SSR-safe: returns the medium profile when `window` is
 * unavailable.
 */
export function resolveCurrentQuality(
  win: {
    location?: { search?: string };
    navigator?: {
      deviceMemory?: number;
      hardwareConcurrency?: number;
      userAgent?: string;
    };
  } = typeof window !== "undefined" ? (window as unknown as never) : {},
): QualityProfile {
  if (!win.location || !win.navigator) return PROFILES.medium;
  const { quality, fx } = parseQualityFromSearch(win.location.search ?? "");
  const ua = win.navigator.userAgent ?? "";
  const isMobile = /Mobi|Android/i.test(ua);
  return resolveQuality(
    quality,
    {
      deviceMemory: win.navigator.deviceMemory,
      hardwareConcurrency: win.navigator.hardwareConcurrency,
      isMobile,
    },
    fx,
  );
}
