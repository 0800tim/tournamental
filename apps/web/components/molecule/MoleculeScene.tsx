"use client";

/**
 * MoleculeScene — the R3F canvas that draws the 3D tournament molecule.
 *
 * Reads:
 *   - The user's `Bracket` from localStorage (the same draft the
 *     `/world-cup-2026` page edits). We compute the cascade here rather
 *     than passing it down so this component can be mounted anywhere
 *     (e.g. a future share page).
 *
 * Renders:
 *   - <Canvas> with a fixed perspective camera, OrbitControls (touch +
 *     mouse rotate, no panning to keep the centre of mass in view),
 *     and slow idle auto-rotate that stops while the user is interacting.
 *   - One <TeamAtom> per team (48 total).
 *   - One <RoundBond> per match with both teams resolved.
 *   - <MoleculePanel> overlay (DOM, outside the Canvas) when a team is
 *     selected.
 *   - <MoleculeLegend> top-right overlay.
 *
 * Visual rig: dark navy bg + ACES filmic tone mapping (same conventions
 * as `MatchScene.tsx`). No fog — per Tim's stadium-scene call, this
 * type of presentation reads cleaner without atmospheric haze.
 *
 * Empty state: when the user has no knockout picks, we still render the
 * scene (48 group-stage atoms on the outer ring) but overlay a soft CTA
 * pointing them at `/world-cup-2026` to start picking. This way the
 * page is *always* alive — never a blank canvas.
 */

import { useEffect, useMemo, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import { loadDraft, localUserId } from "@/lib/bracket/storage";
import {
  buildMoleculeLayout,
  type FinalStage,
  type MoleculeLayout,
  type MoleculeNode,
} from "@/lib/molecule/layout";
import {
  cascade,
  type Bracket,
  type CascadedBracket,
  type Tournament,
} from "@vtorn/bracket-engine";

import { MoleculeLegend } from "./MoleculeLegend";
import { MoleculePanel } from "./MoleculePanel";
import { RoundBond } from "./RoundBond";
import { TeamAtom } from "./TeamAtom";

import "./molecule.css";

export interface MoleculeSceneProps {
  readonly tournament: Tournament;
  /**
   * When set, the scene uses this bracket instead of reading from
   * localStorage. Used by the consensus-bracket toggle.
   */
  readonly bracketOverride?: Bracket | null;
}

function emptyBracket(): Bracket {
  return {
    bracketId: "",
    matchPredictions: {},
    groupTiebreakers: {},
    knockoutPredictions: {},
    version: 2,
  };
}

/**
 * Run the same multi-pass cascade resolver the BracketBuilder uses so the
 * molecule reflects the user's full knockout tree (each round can only
 * resolve its slots once the previous round has winners).
 */
function resolveCascade(
  tournament: Tournament,
  bracket: Bracket,
  userId: string,
): CascadedBracket {
  const legacy = bracketToCascadeInput(tournament, bracket, userId);
  let result = cascade(tournament, legacy);
  for (let pass = 0; pass < 6; pass += 1) {
    const knockouts = Object.values(bracket.knockoutPredictions)
      .map((p) => {
        const k = result.knockouts.find((x) => x.id === p.matchId);
        if (!k) return null;
        const team = p.outcome === "home_win" ? k.home.team : k.away.team;
        return team ? { match_id: p.matchId, winner: team } : null;
      })
      .filter((x): x is { match_id: string; winner: string } => x !== null);
    const before = result.knockouts.filter((k) => k.effective_winner).length;
    result = cascade(tournament, { ...legacy, knockouts });
    const after = result.knockouts.filter((k) => k.effective_winner).length;
    if (after === before) break;
  }
  return result;
}

/** Inner R3F component — placed inside <Canvas>. */
function MoleculeWorld({
  layout,
  selected,
  hovered,
  onSelect,
  onHover,
  flagEmojiByTeam,
}: {
  layout: MoleculeLayout;
  selected: string | null;
  hovered: string | null;
  onSelect: (code: string | null) => void;
  onHover: (code: string | null) => void;
  flagEmojiByTeam: ReadonlyMap<string, string>;
}) {
  const nodeByCode = useMemo(() => {
    const m = new Map<string, MoleculeNode>();
    for (const n of layout.nodes) m.set(n.teamCode, n);
    return m;
  }, [layout.nodes]);

  return (
    <>
      {/* Click on the empty backdrop deselects. */}
      <mesh
        position={[0, 0, -50]}
        onPointerMissed={() => onSelect(null)}
      >
        <planeGeometry args={[0.001, 0.001]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {layout.bonds.map((bond, i) => {
        const a = nodeByCode.get(bond.a);
        const b = nodeByCode.get(bond.b);
        if (!a || !b) return null;
        const highlighted = selected !== null && (bond.a === selected || bond.b === selected);
        return (
          <RoundBond
            key={`${bond.stage}:${bond.a}:${bond.b}:${i}`}
            bond={bond}
            from={a}
            to={b}
            highlighted={highlighted}
          />
        );
      })}

      {layout.nodes.map((node) => (
        <TeamAtom
          key={node.teamCode}
          node={node}
          flagEmoji={flagEmojiByTeam.get(node.teamCode) ?? null}
          selected={selected === node.teamCode}
          hovered={hovered === node.teamCode}
          onClick={onSelect}
          onPointerEnter={onHover}
          onPointerLeave={(c) => {
            if (hovered === c) onHover(null);
          }}
        />
      ))}
    </>
  );
}

/**
 * IdleRotator — applies a gentle y-axis rotation to the *camera anchor*
 * while the user is not interacting. We don't rotate the scene itself
 * (that would fight OrbitControls); instead we let drei's
 * `autoRotate` on the controls do the work. This component just toggles
 * autoRotate on/off based on a pointer-down timer.
 */
function IdleAutoRotateBridge({ controls }: { controls: React.RefObject<unknown> }) {
  const { gl } = useThree();
  const [lastInteract, setLastInteract] = useState(() => Date.now());
  useEffect(() => {
    const dom = gl.domElement;
    const bump = () => setLastInteract(Date.now());
    dom.addEventListener("pointerdown", bump);
    dom.addEventListener("wheel", bump, { passive: true });
    dom.addEventListener("touchstart", bump, { passive: true });
    return () => {
      dom.removeEventListener("pointerdown", bump);
      dom.removeEventListener("wheel", bump);
      dom.removeEventListener("touchstart", bump);
    };
  }, [gl]);
  useFrame(() => {
    const c = controls.current as { autoRotate?: boolean } | null;
    if (!c) return;
    const idleMs = Date.now() - lastInteract;
    c.autoRotate = idleMs > 1800;
  });
  return null;
}

export function MoleculeScene({ tournament, bracketOverride }: MoleculeSceneProps) {
  const [userIdLocal, setUserIdLocal] = useState<string>("ssr_user");
  const [bracket, setBracket] = useState<Bracket>(emptyBracket);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const controlsRef = useState<React.MutableRefObject<unknown>>(() => ({ current: null }))[0];

  useEffect(() => {
    if (bracketOverride) {
      setBracket(bracketOverride);
      return;
    }
    if (typeof window === "undefined") return;
    const id = localUserId();
    setUserIdLocal(id);
    const draft = loadDraft(tournament.id, id);
    if (draft) setBracket(draft);
  }, [tournament.id, bracketOverride]);

  const cascaded = useMemo<CascadedBracket>(
    () => resolveCascade(tournament, bracket, userIdLocal),
    [tournament, bracket, userIdLocal],
  );

  const layout = useMemo(
    () => buildMoleculeLayout(tournament, cascaded),
    [tournament, cascaded],
  );

  // Stage-by-team map for the side panel pill.
  const finalStageByTeam = useMemo(() => {
    const m = new Map<string, FinalStage>();
    for (const node of layout.nodes) m.set(node.teamCode, node.finalStage);
    return m;
  }, [layout.nodes]);

  const flagEmojiByTeam = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tournament.teams) {
      if (t.flag_emoji) m.set(t.id, t.flag_emoji);
    }
    return m;
  }, [tournament.teams]);

  const hoveredOrSelected = hovered ?? selected;
  const hoveredNode = hoveredOrSelected
    ? layout.nodes.find((n) => n.teamCode === hoveredOrSelected) ?? null
    : null;

  return (
    <div className="molecule-root" data-has-picks={layout.hasAnyKnockoutPick ? "true" : "false"}>
      <Canvas
        className="molecule-canvas"
        shadows={false}
        dpr={[1, 2]}
        camera={{ position: [0, 22, 48], fov: 38, near: 0.1, far: 500 }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <color attach="background" args={["#0a0e1a"]} />
        <ambientLight intensity={0.55} color="#ffffff" />
        <hemisphereLight args={["#8aa0c8", "#0a0e1a", 0.45]} />
        <directionalLight position={[20, 30, 15]} intensity={0.95} color="#fff5d0" />
        <directionalLight position={[-25, -10, -20]} intensity={0.35} color="#7eb6e8" />

        <MoleculeWorld
          layout={layout}
          selected={selected}
          hovered={hovered}
          onSelect={setSelected}
          onHover={setHovered}
          flagEmojiByTeam={flagEmojiByTeam}
        />

        <OrbitControls
          ref={(c) => {
            controlsRef.current = c;
          }}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.7}
          minDistance={18}
          maxDistance={120}
          minPolarAngle={Math.PI * 0.18}
          maxPolarAngle={Math.PI * 0.82}
          autoRotate
          autoRotateSpeed={0.35}
        />
        <IdleAutoRotateBridge controls={controlsRef} />
      </Canvas>

      <MoleculeLegend />

      {!layout.hasAnyKnockoutPick ? (
        <div className="molecule-empty-state" role="status">
          <h2 className="molecule-empty-title">Your molecule is still in the petri dish.</h2>
          <p className="molecule-empty-body">
            Pick at least one knockout match to see your tournament molecule
            crystallise — group winners cluster on the outer ring, your
            predicted champion sits at the heart.
          </p>
          <a href="/world-cup-2026" className="molecule-empty-cta">
            Open bracket →
          </a>
        </div>
      ) : null}

      {/* Hover tooltip — desktop only. */}
      {hoveredNode && hoveredNode.teamCode !== selected ? (
        <div className="molecule-tooltip" role="tooltip">
          <span className="molecule-tooltip-flag" aria-hidden>
            {flagEmojiByTeam.get(hoveredNode.teamCode) ?? "·"}
          </span>
          <span className="molecule-tooltip-name">{hoveredNode.teamName}</span>
          <span className="molecule-tooltip-stage">
            {finalStageLabel(hoveredNode.finalStage)}
          </span>
        </div>
      ) : null}

      <MoleculePanel
        teamCode={selected}
        tournament={tournament}
        cascaded={cascaded}
        finalStageByTeam={finalStageByTeam}
        flagEmojiByTeam={flagEmojiByTeam}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function finalStageLabel(fs: FinalStage): string {
  switch (fs) {
    case "champion":
      return "predicted to win it all";
    case "runner_up":
      return "predicted to reach the final";
    case "third_place":
      return "predicted bronze";
    case "fourth_place":
      return "predicted 4th";
    case "qf":
      return "out in QF";
    case "r16":
      return "out in R16";
    case "r32":
      return "out in R32";
    case "group":
      return "out in group stage";
  }
}
