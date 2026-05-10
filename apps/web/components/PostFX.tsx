"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";

import type { QualityProfile } from "@/lib/quality";

export interface PostFXProps {
  /** Resolved quality profile from `lib/quality.ts`. */
  profile: QualityProfile;
}

/**
 * Phase-3 post-processing stack.
 *
 * Per `docs/27c-fidelity-phase3-stadium-crowd.md`:
 *   - Bloom on stadium lights (always on; intensity from profile).
 *   - Tone mapping: ACES (already set on the renderer in MatchScene).
 *   - Vignette: always on, *intensified* during goal-replay slow-mo.
 *   - Subtle film grain (medium / high).
 *   - Chromatic aberration (medium / high) — only really visible in
 *     the goal-replay vignette, but adds a hint of broadcast-tape
 *     texture to the whole frame.
 *
 * The Director writes `camera.userData.fx` and
 * `camera.userData.slowMoRate` every frame; this composer reads them
 * to drive the dynamic vignette / motion-blur uniforms during a
 * goal-replay cut.
 *
 * If `profile.fxOff` is true the caller does not mount this — that's
 * the `?fx=off` escape hatch.
 */
export function PostFX({ profile }: PostFXProps) {
  const { camera } = useThree();
  const vignetteRef = useRef<{ darkness: number; offset: number } | null>(null);
  // Track the vignette effect so we can mutate its uniforms during goal-replay.
  const vignetteEffectRef = useRef<unknown>(null);

  // Read camera.userData every frame; ramp the vignette darkness up
  // during a goal-replay slow-mo cut.
  useFrame((_, deltaRaw) => {
    // Clamp delta so a tab-stall doesn't snap the vignette.
    const dt = Math.min(deltaRaw, 1 / 30);
    const fx = (camera as THREE.PerspectiveCamera & { userData: { fx?: { vignette?: number; motionBlur?: number; slowMoRate?: number } } }).userData
      ?.fx;
    const target = fx && typeof fx.vignette === "number" ? fx.vignette : 0;
    const eff = vignetteEffectRef.current as { darkness?: number; offset?: number; uniforms?: Map<string, { value: number }> } | null;
    if (!eff) return;
    // The postprocessing Vignette effect exposes `darkness` + `offset`
    // as direct float properties on the effect instance.
    const baseDark = profile.vignetteDarkness;
    const baseOffset = profile.vignetteOffset;
    // Lerp toward profile values + bonus from director.
    const wantDark = baseDark + target * 0.6;
    const wantOff = baseOffset - target * 0.05;
    const cur = vignetteRef.current ?? { darkness: baseDark, offset: baseOffset };
    // Frame-rate-independent lerp factor: a fixed 0.2 was effectively
    // dt-dependent on a 60fps display. Use 1 - exp(-λ * dt) with λ ≈ 12
    // which behaves like the old 0.2 at 60fps but stays stable across
    // refresh rates and stalls.
    const k = 1 - Math.exp(-12 * dt);
    cur.darkness += (wantDark - cur.darkness) * k;
    cur.offset += (wantOff - cur.offset) * k;
    vignetteRef.current = cur;
    if (eff.uniforms) {
      const dark = eff.uniforms.get("darkness");
      if (dark) dark.value = cur.darkness;
      const off = eff.uniforms.get("offset");
      if (off) off.value = cur.offset;
    } else {
      if (typeof eff.darkness === "number") eff.darkness = cur.darkness;
      if (typeof eff.offset === "number") eff.offset = cur.offset;
    }
  });

  useEffect(() => {
    // Tag the canvas so e2e tests can confirm the composer is mounted
    // for a given quality profile.
    const canvas = (typeof document !== "undefined"
      ? document.querySelector("canvas")
      : null) as HTMLCanvasElement | null;
    if (canvas) {
      canvas.dataset.vtornFx = profile.fxOff ? "off" : profile.preset ?? "medium";
    }
  }, [profile]);

  if (profile.fxOff) {
    // Defensive — caller should already gate on this, but never let
    // the composer mount with an off profile.
    return null;
  }

  // Build the children array conditionally — EffectComposer's child
  // type is `ReactElement` (not nullable), so we filter null/undefined
  // before passing.
  const children = [
    <Bloom
      key="bloom"
      luminanceThreshold={0.85}
      luminanceSmoothing={0.4}
      intensity={profile.bloomIntensity}
      mipmapBlur
    />,
    profile.chromaticAberration ? (
      <ChromaticAberration
        key="ca"
        // The lib types still complain about `offset` shape; keep
        // it as a Vector2 instance to satisfy them.
        offset={new THREE.Vector2(0.0006, 0.0006)}
        radialModulation={false}
        modulationOffset={0}
      />
    ) : null,
    profile.filmGrain ? (
      <Noise
        key="noise"
        opacity={0.05}
        blendFunction={BlendFunction.OVERLAY}
      />
    ) : null,
    <Vignette
      key="vignette"
      ref={(el: unknown) => {
        vignetteEffectRef.current = el;
      }}
      offset={profile.vignetteOffset}
      darkness={profile.vignetteDarkness}
      eskil={false}
    />,
  ].filter(Boolean) as React.ReactElement[];

  return (
    <EffectComposer multisampling={profile.preset === "high" ? 4 : 0}>
      {children}
    </EffectComposer>
  );
}
