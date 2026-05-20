"use client";

/**
 * TeamAtom, one team-sphere in the molecule.
 *
 * v2 (flag spheres): the main sphere is a flag-textured PBR sphere
 * driven by `FlagSphereMaterial`. The country's flag wraps around the
 * equatorial band (poles tinted dark navy so they don't read as flat
 * caps), and a small vertex-shader displacement gives a subtle "flag
 * rippling in the wind" effect.
 *
 * A "rim glow" back-side sphere picks up the stage palette colour
 * (gold/silver/bronze/etc) so the viewer can still read final-stage
 * classification at a glance. Atoms on the highlighted path (champion's
 * road to gold, or selected team's road) gain a brighter gold rim and a
 * slightly amplified wave so the trail reads as one connected object.
 */

import { useRef, useState } from "react";
import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { useNodeHoverGlow } from "@/lib/motion";
import type { FinalStage, MoleculeNode } from "@/lib/molecule/layout";
import { PALETTE } from "@/lib/molecule/layout";

import { FlagSphereMaterial } from "./FlagSphereMaterial";

export interface TeamAtomProps {
  node: MoleculeNode;
  flagEmoji: string | null;
  selected: boolean;
  hovered: boolean;
  /** True when this atom sits on the currently-highlighted path. */
  onPath?: boolean;
  /**
   * v5, true if this instance is the *opponent's* terminal node on the
   * active path (where they got knocked out). Draws a red `⨯` glyph
   * above the team-code label.
   */
  isPathKnockoutPoint?: boolean;
  /**
   * v5.1, true if this instance is an opponent atom on the active path
   * (i.e. the team-the-path-holder played at some stage). The atom gets
   * a silver "VS" rim badge above the label and a silver halo so the
   * eye picks it out as "this is one of the opponents on the gold
   * trail". The path-team itself is excluded.
   */
  isPathOpponent?: boolean;
  /**
   * v5, true when no team is currently selected. We only render the
   * non-path "this team dropped out here" chevron + rank chip in this
   * mode, so they don't compete with the gold path highlight.
   */
  noSelection?: boolean;
  /** Caller's reduce-motion preference. False disables wave displacement. */
  motionEnabled?: boolean;
  onClick: (code: string) => void;
  onPointerEnter: (code: string) => void;
  onPointerLeave: (code: string) => void;
}

// Hex string → THREE.Color cache so we don't re-parse every frame.
const colourCache = new Map<string, THREE.Color>();
function toColour(hex: string): THREE.Color {
  let c = colourCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colourCache.set(hex, c);
  }
  return c;
}

const PATH_GOLD = "#fbbf24";
/**
 * v5.1, silver rim used for opponent atoms on the active path. Distinct
 * from the gold of the path team so the eye reads "us vs them" at a
 * glance.
 */
const PATH_OPPONENT_SILVER = "#cbd5e1";

function rimColourFor(
  stage: FinalStage,
  onPath: boolean,
  isPathOpponent: boolean,
): string {
  if (onPath) return PATH_GOLD;
  if (isPathOpponent) return PATH_OPPONENT_SILVER;
  return PALETTE[stage];
}

export function TeamAtom(props: TeamAtomProps) {
  const {
    node,
    flagEmoji,
    selected,
    hovered,
    onPath = false,
    isPathKnockoutPoint = false,
    isPathOpponent = false,
    noSelection = false,
    motionEnabled = true,
    onClick,
    onPointerEnter,
    onPointerLeave,
  } = props;
  const groupRef = useRef<THREE.Group>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  /**
   * Material ref for the hover ring, the gold halo that fades in around
   * the atom on pointer-enter. We tween its `opacity` via the shared
   * `useNodeHoverGlow` hook so the ring rides the 200ms power2.out
   * curve the rest of the motion grammar uses. The material is created
   * inline below; the ref points to it through Three's render graph.
   */
  const hoverRingMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const [pulse, setPulse] = useState(0);

  // Gold ring fades to 0.55 on hover and (more strongly) when selected;
  // stays at 0 otherwise so it doesn't compete with the stage rim.
  const hoverRingTarget = selected ? 0.65 : hovered ? 0.55 : 0;
  useNodeHoverGlow(hoverRingMatRef, hoverRingTarget);

  const rim = toColour(rimColourFor(node.finalStage, onPath, isPathOpponent));
  const isChampion = node.finalStage === "champion";

  // Slow scale pulse for the champion atom + hover/selected scale-up.
  useFrame((_, dt) => {
    if (!groupRef.current) return;
    const target =
      (selected ? 1.18 : hovered ? 1.08 : 1) *
      (isChampion ? 1 + 0.05 * Math.sin(pulse) : 1);
    setPulse((p) => p + dt * 2.2);
    const cur = groupRef.current.scale.x;
    const next = cur + (target - cur) * Math.min(1, dt * 8);
    groupRef.current.scale.setScalar(next);
    if (rimRef.current) rimRef.current.scale.setScalar(1.18);
  });

  // Rim halo carries the selection cue (size bump + outer glow ring); the
  // flag sphere itself gets only a whisper of emissive so the flag colours
  // shine through, not a gold filter. Tim 2026-05-11: "less of a filter,
  // so the flag really shines through."
  const rimOpacity = (selected ? 0.85 : hovered ? 0.6 : 1)
    * (onPath
        ? 0.6
        : isPathOpponent
          ? 0.55
          : isChampion
            ? 0.5
            : 0.32);
  const waveBoost = selected || hovered ? 1.6 : onPath ? 1.2 : 1;

  return (
    <group
      ref={groupRef}
      position={node.position as unknown as [number, number, number]}
    >
      {/* Rim halo, back-side sphere that picks up the stage palette colour.
       * onPath atoms get the gold rim treatment. */}
      <mesh ref={rimRef} scale={1.18}>
        <sphereGeometry args={[node.radius, 24, 24]} />
        <meshBasicMaterial
          color={rim}
          transparent
          opacity={rimOpacity}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Hover ring, a slightly larger back-side sphere drawn in gold.
       * Default opacity is 0; `useNodeHoverGlow` tweens it up to ~0.55
       * on hover and ~0.65 on selection via gsap.to, then back down on
       * exit. 200ms power2.out — same motion grammar as the cascade
       * pulse. Reduced motion snaps to the target without a tween. */}
      <mesh scale={1.32}>
        <sphereGeometry args={[node.radius, 24, 24]} />
        <meshBasicMaterial
          ref={hoverRingMatRef}
          color={PATH_GOLD}
          transparent
          opacity={0}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Main sphere, flag-wrapped, lit, with wind-wave displacement. */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onClick(node.teamCode);
        }}
        onPointerEnter={(e) => {
          e.stopPropagation();
          onPointerEnter(node.teamCode);
          if (typeof document !== "undefined") document.body.style.cursor = "pointer";
        }}
        onPointerLeave={(e) => {
          e.stopPropagation();
          onPointerLeave(node.teamCode);
          if (typeof document !== "undefined") document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[node.radius, 48, 32]} />
        <FlagSphereMaterial
          teamCode={node.teamCode}
          accent={node.accentColor}
          motionEnabled={motionEnabled}
          waveBoost={waveBoost}
          emissive={rim}
          emissiveIntensity={selected ? 0.12 : isChampion ? 0.07 : 0.04}
          isChampion={isChampion}
          onPath={onPath}
        />
      </mesh>

      {/* Flag emoji + team-code label, billboarded so it always faces the camera.
       * v5: stacks an optional rank chip below and a `⨯`/chevron above. */}
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <Html
          center
          position={[0, node.radius * 1.55, 0]}
          distanceFactor={18}
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div className="molecule-label-stack">
            {/* v5, red `⨯` glyph above the label for the path's knockout
             * points (the opponent's terminal instance on the active path). */}
            {isPathKnockoutPoint ? (
              <span
                className="molecule-label-ko"
                aria-label="knocked out here"
                title="knocked out here"
              >
                ✕
              </span>
            ) : null}
            {/* v5.1, silver "VS" chip on opponent atoms, names this team as
             * one of the gold path's opponents at a glance. Suppressed when
             * the team is already on the path itself (mutually exclusive). */}
            {isPathOpponent && !onPath ? (
              <span
                className="molecule-label-vs"
                aria-label="opponent on the gold path"
                title="opponent on the gold path"
              >
                VS
              </span>
            ) : null}
            <div
              className="molecule-label"
              data-stage={node.finalStage}
              data-on-path={onPath ? "true" : undefined}
              data-path-opponent={isPathOpponent && !onPath ? "true" : undefined}
              data-selected={selected ? "true" : undefined}
            >
              {flagEmoji ? <span className="molecule-label-flag" aria-hidden>{flagEmoji}</span> : null}
              <span className="molecule-label-code">{node.teamCode}</span>
            </div>
            {/* v5, rank chip + drop-out chevron on the TOP instance for
             * non-path teams. Hidden whenever a team is selected so the
             * gold path can breathe. Champions skip the chevron (they
             * didn't drop out anywhere). */}
            {noSelection && node.isTopInstance && node.finalStage !== "champion" ? (
              <span className="molecule-label-chevron" aria-hidden>▾</span>
            ) : null}
            {noSelection && node.isTopInstance && node.fifaRank !== null ? (
              <span
                className="molecule-label-rank"
                aria-label={`world rank ${node.fifaRank}`}
                data-stage={node.finalStage}
              >
                #{node.fifaRank}
              </span>
            ) : null}
          </div>
        </Html>
      </Billboard>
    </group>
  );
}
