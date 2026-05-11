"use client";

/**
 * RoundBond, one edge connecting two team atoms.
 *
 * v4: bonds come in two kinds -
 *   - **match bonds** (kind === "match"): two different teams at the
 *     same layer. Horizontal cylinder at the layer's Y, coloured by
 *     stage palette, scaling with stage rank.
 *   - **advance bonds** (kind === "advance"): the same team at two
 *     adjacent layers. Near-vertical cylinder rising from layer N to
 *     N+1. Default slate, thin (0.75) and low opacity. When the team
 *     is on the champion's path, the advance bond lights up gold -
 *     the headline "gold staircase" effect.
 *
 * Path-highlight: bonds that sit on the active highlight path render
 * in gold with 2× thickness and an emissive glow. A small pulse-sphere
 * travels along match bonds from rim → centre, completing one trip
 * every ~3s. Advance bonds don't get the travelling pulse (the path
 * already animates via the column rise, a second pulse-train would
 * over-egg it).
 *
 * Performance: ≤ ~96 match cylinders + ~75 advance cylinders + up to 5
 * pulse spheres. All low-poly. Within the 2022 mid-range Android budget.
 */

import { useMemo, useRef } from "react";
import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { MoleculeBond, MoleculeNode } from "@/lib/molecule/layout";

export interface RoundBondProps {
  bond: MoleculeBond;
  from: MoleculeNode;
  to: MoleculeNode;
  /** Generic "this bond is in focus", bumps opacity + glow. */
  highlighted?: boolean;
  /** True when this bond is on the currently-highlighted path (gold). */
  onPath?: boolean;
  /** Path-relative ordering (0 = first / rim, n-1 = last / centre). For pulse staggering. */
  pathIndex?: number;
  /** Total number of bonds in the path; needed to phase the pulse along the trail. */
  pathLength?: number;
  /** Caller's reduce-motion preference. False = no pulse. */
  motionEnabled?: boolean;
  /** Group bonds: opacity is tweened to 0 when this is false. */
  groupBondsVisible?: boolean;
  /**
   * v5, for path match bonds, the winner's teamCode. Used to point the
   * directional arrow from winner → loser (lerp factor 0.35 along the
   * cylinder). When `null`/`undefined`, no arrow is rendered.
   */
  winnerCode?: string | null;
  /**
   * v5.1, the OPPONENT of the path team at this bond. The match badge
   * renders "STAGE · vs <FLAG> <NAME>" so the opponent at every
   * surviving stage of the gold trail is unmistakable, replacing the
   * v5 two-flag badge that didn't name either side.
   */
  opponentCode?: string | null;
  opponentName?: string | null;
  opponentFlag?: string | null;
  /** v5, short stage label for the match badge ("R32", "QF", "Final", …). */
  matchBadgeLabel?: string | null;
}

const STAGE_BADGE_LABEL: Record<MoleculeBond["stage"], string> = {
  group: "Group",
  r32: "R32",
  r16: "R16",
  qf: "QF",
  sf: "SF",
  tp: "Bronze",
  f: "Final",
};

const PATH_GOLD = "#fbbf24";

export function RoundBond({
  bond,
  from,
  to,
  highlighted,
  onPath,
  pathIndex,
  pathLength,
  motionEnabled = true,
  groupBondsVisible = true,
  winnerCode = null,
  opponentCode = null,
  opponentName = null,
  opponentFlag = null,
  matchBadgeLabel = null,
}: RoundBondProps) {
  const { position, quaternion, length, midpoint, arrowPos, arrowFromWinner } = useMemo(() => {
    const a = new THREE.Vector3(...from.position);
    const b = new THREE.Vector3(...to.position);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    );
    // v5: arrow sits at lerp(winner→loser, 0.35), 35% of the way from
    // winner toward loser. Pointing FROM winner TO loser semantically.
    // Defaults to midpoint if we don't know the winner.
    const isFromWinner = winnerCode !== null && from.teamCode === winnerCode;
    const isToWinner = winnerCode !== null && to.teamCode === winnerCode;
    let aPos: THREE.Vector3 | null = null;
    if (isFromWinner) {
      aPos = a.clone().lerp(b, 0.35);
    } else if (isToWinner) {
      aPos = b.clone().lerp(a, 0.35);
    }
    return {
      position: mid,
      quaternion: q,
      length: len,
      midpoint: mid,
      arrowPos: aPos,
      arrowFromWinner: isFromWinner || isToWinner,
    };
  }, [from.position, to.position, from.teamCode, to.teamCode, winnerCode]);

  // Base thickness, bumped across the board, scaled by stage rank.
  const stageThicknessMult: Record<MoleculeBond["stage"], number> = {
    group: 0.055,
    r32: 0.08,
    r16: 0.1,
    qf: 0.13,
    sf: 0.16,
    tp: 0.13,
    f: 0.22,
  };
  // v4 advance bonds use a flat thin radius (already 0.75 from layout).
  // Match bonds keep their per-stage thickness multiplier.
  const isAdvance = bond.kind === "advance";
  const baseRadius = isAdvance
    ? bond.thickness * 0.18
    : bond.thickness * (stageThicknessMult[bond.stage] ?? 0.1);
  // v5: tone down the match-bond on-path bump to 1.4×, these are
  // horizontal and don't need the same emphasis as the vertical advance
  // columns. Advance bonds stay at 2.0× so the gold staircase still pops.
  const onPathRadiusMult = isAdvance ? 2.0 : 1.4;
  const radius = onPath ? baseRadius * onPathRadiusMult : baseRadius;

  // Colour + opacity.
  const colour = onPath ? PATH_GOLD : bond.color;
  const baseOpacity = (() => {
    if (onPath) return 0.95;
    if (highlighted) return 0.95;
    if (isAdvance) return 0.32; // low default so the gold staircase pops
    if (bond.stage === "group") return 0.22;
    if (bond.stage === "r32") return 0.45;
    return 0.65;
  })();

  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const pulseMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // Pre-compute pulse animation period (seconds) and phase offset per bond.
  const PULSE_PERIOD = 3.0;
  const pathLen = pathLength ?? 1;
  const stagger = pathIndex !== undefined ? pathIndex / Math.max(1, pathLen) : 0;

  // Tween group-bond opacity toward target each frame, animate pulse.
  useFrame((state, dt) => {
    if (matRef.current) {
      let target = baseOpacity;
      if (bond.stage === "group" && !groupBondsVisible) target = 0;
      const cur = matRef.current.opacity;
      matRef.current.opacity = cur + (target - cur) * Math.min(1, dt * 3);
    }

    if (onPath && !isAdvance && motionEnabled && pulseRef.current && pulseMatRef.current) {
      const t = (state.clock.elapsedTime % PULSE_PERIOD) / PULSE_PERIOD;
      const sliceWidth = 1 / Math.max(1, pathLen);
      const localStart = stagger;
      const localEnd = stagger + sliceWidth;
      let localT = -1;
      if (t >= localStart && t <= localEnd) {
        localT = (t - localStart) / sliceWidth;
      }
      if (localT >= 0 && localT <= 1) {
        // Pulse travels from outer-ring atom toward centre.
        const fromR = Math.hypot(from.position[0], from.position[2]);
        const toR = Math.hypot(to.position[0], to.position[2]);
        const startsAt = fromR > toR ? from.position : to.position;
        const endsAt = fromR > toR ? to.position : from.position;
        const px = startsAt[0] + (endsAt[0] - startsAt[0]) * localT;
        const py = startsAt[1] + (endsAt[1] - startsAt[1]) * localT;
        const pz = startsAt[2] + (endsAt[2] - startsAt[2]) * localT;
        pulseRef.current.position.set(px, py, pz);
        pulseMatRef.current.opacity = 0.95 * (1 - Math.abs(localT - 0.5) * 1.4);
        pulseRef.current.visible = true;
      } else {
        pulseRef.current.visible = false;
      }
    } else if (pulseRef.current) {
      pulseRef.current.visible = false;
    }
  });

  return (
    <>
      <mesh ref={meshRef} position={position} quaternion={quaternion}>
        <cylinderGeometry args={[radius, radius, length, 12, 1]} />
        <meshStandardMaterial
          ref={matRef}
          color={colour}
          emissive={colour}
          emissiveIntensity={
            onPath
              ? 0.9
              : highlighted
                ? 0.6
                : bond.stage === "f" || bond.stage === "sf" || bond.stage === "qf"
                  ? 0.35
                  : 0.1
          }
          roughness={0.45}
          metalness={0.25}
          transparent
          opacity={baseOpacity}
          depthWrite={!onPath && !highlighted}
        />
      </mesh>

      {/* Travelling pulse sphere, only on match path bonds, when motion is on. */}
      {onPath && !isAdvance ? (
        <mesh ref={pulseRef} visible={false}>
          <sphereGeometry args={[radius * 2.4, 14, 12]} />
          <meshBasicMaterial
            ref={pulseMatRef}
            color={PATH_GOLD}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      {/* v5: directional arrow glyph, winner → loser. Only on path match bonds.
       * Billboards toward the camera. Suppressed without a known winner. */}
      {onPath && !isAdvance && arrowPos && arrowFromWinner ? (
        <Billboard position={[arrowPos.x, arrowPos.y, arrowPos.z]} follow>
          <Html
            center
            distanceFactor={18}
            zIndexRange={[12, 0]}
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            <span
              className="molecule-match-arrow"
              aria-hidden
              data-stage={bond.stage}
            >
              ▶
            </span>
          </Html>
        </Billboard>
      ) : null}

      {/* v5.1: "vs <OPPONENT>" match badge. Names the opponent the path
       * team beat at this stage, so the eye can read the gold trail as
       * "<TEAM> beat ARG → BRA → FRA → GER → ENG → won it" without
       * tracing every bond. Sits above the midpoint, billboards. */}
      {onPath && !isAdvance && opponentCode && opponentName ? (
        <Billboard
          position={[midpoint.x, midpoint.y + 1.8, midpoint.z]}
          follow
        >
          <Html
            center
            distanceFactor={16}
            zIndexRange={[11, 0]}
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            <div className="molecule-match-badge" data-stage={bond.stage}>
              <span className="molecule-match-badge-round">
                {matchBadgeLabel ?? STAGE_BADGE_LABEL[bond.stage]}
              </span>
              <span className="molecule-match-badge-vs">vs</span>
              {opponentFlag ? (
                <span className="molecule-match-badge-flag" aria-hidden>
                  {opponentFlag}
                </span>
              ) : null}
              <span
                className="molecule-match-badge-opp"
                data-team={opponentCode}
              >
                {opponentName}
              </span>
            </div>
          </Html>
        </Billboard>
      ) : null}
    </>
  );
}
