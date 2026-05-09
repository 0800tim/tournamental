/**
 * Phase-4 sweat / fatigue shader.
 *
 * Per `docs/27d-fidelity-phase4-magnus-mobile.md` § "Sweat / fatigue":
 *
 *   Per-player wetness coefficient that increases over match time.
 *   Applied as a normal-map blend on jersey + skin.
 *   Sweat at 0% at kickoff, 60% at full-time. Dirt decals on Slide
 *   Tackle. Cheap: shader-only, no extra geometry.
 *
 * The avatar package is renderer-host agnostic — this module ships
 * pure data + a tiny `MaterialLike` mutation surface. Renderer-side
 * GLSL injection is optional (we ship the shader chunk + uniforms but
 * the cheap default is property-only writes).
 *
 * Tests in `packages/avatar/test/sweat-shader.test.ts` cover the full
 * model without instantiating Three.
 */

export interface FatigueState {
  matchClockSec: number;
  minutesPlayed: number;
  /** Fatigue ∈ [0, 1]; auto-director uses this to bias substitutions. */
  fatigue: number;
  /** Sweat ∈ [0, 1]; visible at HIGH LOD only. */
  sweat: number;
  /** Set of jersey regions with a slide-tackle dirt decal. */
  dirtRegions: Set<DirtRegion>;
}

export type DirtRegion = "torso_front" | "torso_back" | "shorts" | "socks";

export interface FatigueOptions {
  /** Linear ramp duration. Default 90 (regulation). */
  fullTimeMinutes?: number;
  /** Sweat peak at full-time. Default 0.6. */
  sweatPeak?: number;
}

export function createFatigueState(): FatigueState {
  return {
    matchClockSec: 0,
    minutesPlayed: 0,
    fatigue: 0,
    sweat: 0,
    dirtRegions: new Set(),
  };
}

/** Advance fatigue + sweat by `dtSec` seconds of match clock. */
export function tickFatigue(
  state: FatigueState,
  dtSec: number,
  options: FatigueOptions = {},
): FatigueState {
  const fullTimeMin = options.fullTimeMinutes ?? 90;
  const sweatPeak = options.sweatPeak ?? 0.6;

  const next: FatigueState = {
    ...state,
    matchClockSec: state.matchClockSec + dtSec,
    minutesPlayed: state.minutesPlayed + dtSec / 60,
    dirtRegions: state.dirtRegions,
  } as FatigueState;

  next.fatigue = Math.max(0, Math.min(1, next.minutesPlayed / fullTimeMin));
  next.sweat = next.fatigue * sweatPeak;
  return next;
}

export function halfTimeBoost(state: FatigueState, recoveryFraction = 0.15): FatigueState {
  return {
    ...state,
    fatigue: Math.max(0, state.fatigue - recoveryFraction),
    sweat: Math.max(0, state.sweat - recoveryFraction * 0.6),
  };
}

export function addDirt(state: FatigueState, region: DirtRegion): FatigueState {
  if (state.dirtRegions.has(region)) return state;
  const next = new Set(state.dirtRegions);
  next.add(region);
  return { ...state, dirtRegions: next };
}

/** Subset of three.js material fields the sweat shader mutates. */
export interface MaterialLike {
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
}

/**
 * Apply sweat coefficient to a material. Higher sweat → lower
 * roughness, higher envMapIntensity (wet skin highlights).
 */
export function applySweatToMaterial(
  material: MaterialLike,
  sweat: number,
  baseRoughness = 0.65,
): void {
  const s = Math.max(0, Math.min(1, sweat));
  material.roughness = baseRoughness - s * 0.4;
  if (typeof material.envMapIntensity === "number") {
    material.envMapIntensity = 1 + s * 0.5;
  } else {
    material.envMapIntensity = 1 + s * 0.5;
  }
}

/** Apply a dirt overlay strength to a material. */
export function applyDirtToMaterial(
  material: MaterialLike,
  dirtStrength: number,
  baseRoughness = 0.7,
): void {
  const d = Math.max(0, Math.min(1, dirtStrength));
  material.roughness = baseRoughness + d * 0.25;
  if (typeof material.envMapIntensity === "number") {
    material.envMapIntensity = Math.max(0.6, 1 - d * 0.4);
  }
}

/** Sweat shader is HIGH-LOD only per the docs/27d budget. */
export function fatigueShaderEnabled(quality: string | undefined): boolean {
  return quality === "high";
}

/** Auto-director hook: should we suggest a sub? */
export function shouldSuggestSubstitution(state: FatigueState, threshold = 0.85): boolean {
  return state.fatigue >= threshold && state.minutesPlayed >= 60;
}

/** Bias score in [0, 1] for substitution decisions. */
export function fatigueSubstitutionBias(state: FatigueState): number {
  const f = state.fatigue;
  if (f < 0.7) return 0;
  return (f - 0.7) / 0.3;
}

/** GLSL fragment chunk for full normal-map shader integration. */
export const SWEAT_SHADER_FRAGMENT_CHUNK = /* glsl */ `
// Phase-4 sweat + dirt blend, injected after roughnessmap_fragment.
roughnessFactor *= (1.0 - 0.6 * uSweat);
roughnessFactor += 0.25 * uDirt;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.22, 0.18), uDirt * 0.55);
`;

export interface SweatUniforms {
  uSweat: { value: number };
  uDirt: { value: number };
}

export function createSweatUniforms(initialSweat = 0, initialDirt = 0): SweatUniforms {
  return {
    uSweat: { value: initialSweat },
    uDirt: { value: initialDirt },
  };
}
