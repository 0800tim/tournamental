"use client";

/**
 * MoleculeScene, the R3F canvas that draws the 3D tournament molecule.
 *
 * v2 changes:
 *   - Atoms render as flag-wrapped spheres (see TeamAtom + FlagSphereMaterial).
 *   - The predicted champion's path-to-the-final (R32→R16→QF→SF→F) is
 *     highlighted in gold by default. Clicking another atom replaces the
 *     highlight with that team's path (toggleable via the side panel).
 *   - Group-stage bonds fade out during camera rotation / prolonged idle
 *     so the eye can find the gold trail.
 *   - A small floating "PATH TO GOLD" chip sits top-centre when the
 *     champion path is the active highlight.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import { useUser } from "@/lib/auth/useUser";
import { loadServerBracket } from "@/lib/bracket/api";
import { mergeBrackets } from "@/lib/bracket/merge";
import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import { loadDraft, localUserId, saveDraft } from "@/lib/bracket/storage";
import {
  buildMoleculeLayout,
  type BondStage,
  type FinalStage,
  type LayoutMode,
  type MoleculeLayout,
  type MoleculeNode,
} from "@/lib/molecule/layout";
import {
  buildPathAdvanceBondKeySet,
  buildPathAtomSet,
  buildPathBondKeySet,
  buildPathLoserAtTopInstance,
  derivePathToGold,
  type TeamPath,
} from "@/lib/molecule/path";
import {
  cascade,
  type Bracket,
  type CascadedBracket,
  type Tournament,
} from "@tournamental/bracket-engine";

import { MoleculeLayerLabels } from "./MoleculeLayerLabels";
import { MoleculeLegend } from "./MoleculeLegend";
import { MoleculePanel } from "./MoleculePanel";
import { RoundBond } from "./RoundBond";
import { TeamAtom } from "./TeamAtom";

import "./molecule.css";

export interface MoleculeSceneProps {
  readonly tournament: Tournament;
  readonly bracketOverride?: Bracket | null;
  /**
   * v5, layout mode for the molecule.
   *   "stable"     , per-team hash (v4 default; columns rise vertical).
   *   "rank-sorted", strongest at θ=0 around each ring. Used in "Rank
   *                   Favourites" mode so the contrast between your
   *                   picks and the rank consensus is visually stark.
   */
  readonly layoutMode?: LayoutMode;
  /**
   * v6.1, "viral share landing" follow-up (2026-05-11). When `true`
   * the side panel hides interactive affordances (close button, the
   * highlight-on-scene toggle) so the share-landing embed can render
   * the panel without implying edit-ability. The scene itself stays
   * fully interactive (rotate / zoom / select).
   */
  readonly readOnly?: boolean;
  /**
   * 2026-05-13: when `true`, skip the auto-select-the-champion effect
   * so the side panel doesn't open on mount. The save-share preview
   * uses this so the molecule renders cleanly next to its own podium
   * tile rather than overlapping the auto-opened panel.
   */
  readonly suppressAutoSelect?: boolean;
  /**
   * 2026-05-13: when `true`, hide the side-panel UI entirely. The
   * save-share preview pairs the molecule with its own podium card,
   * so the in-scene panel is redundant.
   */
  readonly hideSidePanel?: boolean;
  /**
   * 2026-05-14: override the team to auto-select on mount. The share
   * landing passes the server-resolved champion here so a stranger
   * viewing `/s/<guid>` lands on the actual predicted winner, not on
   * the rank-favourite fallback that the local cascade picks when a
   * stripped payload doesn't resolve a champion.
   */
  readonly initialSelectedTeam?: string | null;
  /**
   * 2026-05-14: when `true`, hide the stage legend (CHAMPION / FINAL /
   * SEMIS / …) that sits behind the molecule. The share landing uses
   * this so the molecule can claim full width without the column of
   * labels competing for visual attention.
   */
  readonly hideStageLegend?: boolean;
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

/** Inner R3F component, placed inside <Canvas>. */
function MoleculeWorld({
  layout,
  selected,
  hovered,
  onSelect,
  onHover,
  flagEmojiByTeam,
  pathBondKeys,
  pathAdvanceBondKeys,
  pathAtomSet,
  pathBondOrder,
  pathWinnerByMatchBondKey,
  pathLoserByTeam,
  pathBondStageLabel,
  pathOpponentByMatchBondKey,
  pathOpponentAtomCodes,
  pathTeamCode,
  motionEnabled,
  groupBondsVisible,
}: {
  layout: MoleculeLayout;
  selected: string | null;
  hovered: string | null;
  onSelect: (code: string | null) => void;
  onHover: (code: string | null) => void;
  flagEmojiByTeam: ReadonlyMap<string, string>;
  pathBondKeys: ReadonlySet<string>;
  pathAdvanceBondKeys: ReadonlySet<string>;
  pathAtomSet: ReadonlySet<string>;
  /** Map of bond-key → (index in path, totalPathLength) for pulse staggering. */
  pathBondOrder: ReadonlyMap<string, { index: number; total: number }>;
  /** v5, match-bond-key → winner's teamCode (for directional arrow). */
  pathWinnerByMatchBondKey: ReadonlyMap<string, string>;
  /** v5, teamCode of the loser at each path layer → bond stage (for `⨯` glyph). */
  pathLoserByTeam: ReadonlyMap<string, BondStage>;
  /** v5, match-bond-key → human-readable round label ("R32", "Final", …). */
  pathBondStageLabel: ReadonlyMap<string, string>;
  /**
   * v5.1, match-bond-key → the OPPONENT of the path team at that bond
   * (code + display name). Drives the "vs <name>" labels Tim asked for
   * so the opponent at every surviving stage is unmistakable.
   */
  pathOpponentByMatchBondKey: ReadonlyMap<
    string,
    { code: string; name: string }
  >;
  /** v5.1, all opponent team codes on the active path (used for atom rims). */
  pathOpponentAtomCodes: ReadonlySet<string>;
  /** v5.1, the team code the active path is FOR (the "us" side of "us vs them"). */
  pathTeamCode: string | null;
  motionEnabled: boolean;
  groupBondsVisible: boolean;
}) {
  // v4: nodes are identified by `${teamCode}:${stage}`. Bonds reference
  // their endpoints by team + stage so we resolve them precisely here.
  const nodeById = useMemo(() => {
    const m = new Map<string, MoleculeNode>();
    for (const n of layout.nodes) m.set(n.id, n);
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

      {layout.bonds.map((bond) => {
        const a = nodeById.get(`${bond.a}:${bond.aStage}`);
        const b = nodeById.get(`${bond.b}:${bond.bStage}`);
        if (!a || !b) return null;
        // Legacy bond-key is used for tests + the gold staircase lookups.
        const matchBondKey = `${bond.stage}:${bond.a}:${bond.b}`;
        const onPath =
          bond.kind === "match"
            ? pathBondKeys.has(matchBondKey)
            : pathAdvanceBondKeys.has(matchBondKey);
        const order = bond.kind === "match"
          ? pathBondOrder.get(matchBondKey)
          : undefined;
        const highlighted =
          selected !== null
          && (bond.kind === "match"
            ? bond.a === selected || bond.b === selected
            : bond.a === selected);
        const winnerCode =
          bond.kind === "match" && onPath
            ? pathWinnerByMatchBondKey.get(matchBondKey) ?? null
            : null;
        const opponentInfo =
          bond.kind === "match" && onPath
            ? pathOpponentByMatchBondKey.get(matchBondKey) ?? null
            : null;
        const opponentFlag =
          opponentInfo ? flagEmojiByTeam.get(opponentInfo.code) ?? null : null;
        const matchBadgeLabel =
          bond.kind === "match" && onPath
            ? pathBondStageLabel.get(matchBondKey) ?? null
            : null;
        return (
          <RoundBond
            key={bond.id}
            bond={bond}
            from={a}
            to={b}
            highlighted={highlighted}
            onPath={onPath}
            pathIndex={order?.index}
            pathLength={order?.total}
            motionEnabled={motionEnabled}
            groupBondsVisible={groupBondsVisible}
            winnerCode={winnerCode}
            opponentCode={opponentInfo?.code ?? null}
            opponentName={opponentInfo?.name ?? null}
            opponentFlag={opponentFlag}
            matchBadgeLabel={matchBadgeLabel}
          />
        );
      })}

      {layout.nodes.map((node) => {
        const koStage = pathLoserByTeam.get(node.teamCode);
        // The `⨯` glyph only renders on the loser's TOP instance, the
        // layer where they were actually eliminated. Other instances
        // (their group-base, lower-layer climbs) stay clean.
        const isPathKnockoutPoint =
          koStage !== undefined
          && node.isTopInstance
          && (koStage === node.stage
              || // tp losers terminate at sf, but the loss happened at the
                 // match's stage, which the cascade marks as sf for our purposes.
                 koStage === "tp");
        // v5.1: an opponent atom on the active path (champion played them
        // at this stage) gets a distinctive silver-ringed "opponent"
        // treatment so the eye can pick out "this is England, beaten in
        // the SF" without having to trace the bond. We light up only the
        // opponent's top instance to avoid double-rings on lower layers.
        const isPathOpponent =
          node.teamCode !== pathTeamCode
          && pathOpponentAtomCodes.has(node.teamCode)
          && node.isTopInstance;
        return (
          <TeamAtom
            key={node.id}
            node={node}
            flagEmoji={flagEmojiByTeam.get(node.teamCode) ?? null}
            selected={selected === node.teamCode}
            hovered={hovered === node.teamCode}
            onPath={pathAtomSet.has(node.teamCode)}
            isPathKnockoutPoint={isPathKnockoutPoint}
            isPathOpponent={isPathOpponent}
            noSelection={selected === null}
            motionEnabled={motionEnabled}
            onClick={onSelect}
            onPointerEnter={onHover}
            onPointerLeave={(c) => {
              if (hovered === c) onHover(null);
            }}
          />
        );
      })}
    </>
  );
}

/**
 * IdleAutoRotateBridge, toggles OrbitControls.autoRotate based on recent
 * interaction, and exposes both the interaction-timestamp and a
 * "currently rotating" flag to the parent via callback.
 */
function IdleAutoRotateBridge({
  controls,
  onInteractionState,
}: {
  controls: React.RefObject<unknown>;
  onInteractionState: (s: { idleMs: number; rotating: boolean }) => void;
}) {
  const { gl } = useThree();
  const [lastInteract, setLastInteract] = useState(() => Date.now());
  useEffect(() => {
    const dom = gl.domElement;
    const bump = () => setLastInteract(Date.now());
    dom.addEventListener("pointerdown", bump);
    dom.addEventListener("pointermove", bump);
    dom.addEventListener("wheel", bump, { passive: true });
    dom.addEventListener("touchstart", bump, { passive: true });
    dom.addEventListener("touchmove", bump, { passive: true });
    return () => {
      dom.removeEventListener("pointerdown", bump);
      dom.removeEventListener("pointermove", bump);
      dom.removeEventListener("wheel", bump);
      dom.removeEventListener("touchstart", bump);
      dom.removeEventListener("touchmove", bump);
    };
  }, [gl]);
  useFrame(() => {
    const c = controls.current as { autoRotate?: boolean } | null;
    const idleMs = Date.now() - lastInteract;
    const rotating = !!c && c.autoRotate === true;
    if (c) c.autoRotate = idleMs > 1800;
    onInteractionState({ idleMs, rotating });
  });
  return null;
}

export function MoleculeScene({
  tournament,
  bracketOverride,
  layoutMode = "stable",
  readOnly = false,
  suppressAutoSelect = false,
  hideSidePanel = false,
  initialSelectedTeam = null,
  hideStageLegend = false,
}: MoleculeSceneProps) {
  const [userIdLocal, setUserIdLocal] = useState<string>("ssr_user");
  const [bracket, setBracket] = useState<Bracket>(emptyBracket);
  const [selected, setSelected] = useState<string | null>(null);
  // Petri-dish modal: opens on mount when the bracket is empty or
  // incomplete, telling the user the molecule won't render fully
  // until all 104 matches are picked. Dismissable, but suppressed
  // entirely in read-only contexts (share-landing) where the viewer
  // isn't the bracket owner. Tim 2026-06-01.
  const [petriModalDismissed, setPetriModalDismissed] = useState<boolean>(false);
  const [hovered, setHovered] = useState<string | null>(null);
  /** Per-team toggle: when off, clicking this team does NOT replace the gold path. */
  const [highlightOverridesByTeam, setHighlightOverridesByTeam] = useState<
    Record<string, boolean>
  >({});
  const [groupBondsVisible, setGroupBondsVisible] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(true);
  /**
   * v6, "viral share landing", on first mount we auto-open the panel for
   * the predicted champion so the page lands on the exact pyramid+panel
   * composition Tim uses for socials. The flag is a one-shot, the user's
   * later clicks (including clicking the close button) win for the rest
   * of the session.
   */
  const autoSelectedRef = useRef(false);
  const controlsRef = useState<React.MutableRefObject<unknown>>(() => ({ current: null }))[0];
  const interactionRef = useRef<{ idleMs: number; rotating: boolean }>({ idleMs: 0, rotating: false });

  // Respect prefers-reduced-motion at mount.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMotionEnabled(!mq.matches);
    const handler = (e: MediaQueryListEvent) => setMotionEnabled(!e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  const auth = useUser();
  useEffect(() => {
    if (bracketOverride) {
      setBracket(bracketOverride);
      return;
    }
    if (typeof window === "undefined") return;
    // Mirror BracketBuilder: prefer the authed user id when signed in,
    // otherwise the per-browser guest id. Picks are persisted under the
    // same key on the bracket page, so reading the guest id alone would
    // miss a signed-in user's bracket and render the empty petri-dish
    // state even with a full 104-pick draft on disk.
    if (auth.loading) return;
    const authedId = auth.user?.id ?? null;
    const guestId = localUserId();
    const id = authedId ?? guestId;
    setUserIdLocal(id);
    const draft = loadDraft(tournament.id, id);
    if (draft) setBracket(draft);

    // Best-effort server hydration so a returning user on a fresh
    // device still sees their picks. Merges into whatever was on disk;
    // the merged result is written back so the next load is local-fast.
    let cancelled = false;
    void (async () => {
      const remote = await loadServerBracket({ userId: id, tournamentId: tournament.id });
      if (cancelled || !remote.ok) return;
      setBracket((current) => {
        const merged = mergeBrackets(current, remote.bracket, { tournament });
        saveDraft(tournament.id, merged, id);
        return merged;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tournament.id, bracketOverride, auth.loading, auth.user?.id]);

  const cascaded = useMemo<CascadedBracket>(
    () => resolveCascade(tournament, bracket, userIdLocal),
    [tournament, bracket, userIdLocal],
  );

  const layout = useMemo(
    () => buildMoleculeLayout(tournament, cascaded, layoutMode),
    [tournament, cascaded, layoutMode],
  );

  // v6, "viral share landing", auto-open the panel for the predicted
  // champion on first mount. If the bracket has no resolved champion
  // (empty / no knockout picks) we fall back to the rank-favourite team
  // (lowest world rank in the tournament) so the page is never blank on
  // first paint. This is one-shot, after the first auto-select fires
  // any later user click + close wins for the rest of the session.
  useEffect(() => {
    if (autoSelectedRef.current) return;
    // Save-share preview opts out so the molecule renders cleanly
    // alongside its own podium card rather than auto-opening the
    // champion-detail panel (which previously overlapped the scene).
    if (suppressAutoSelect) return;
    // Only auto-select once the bracket has hydrated, otherwise we'd
    // briefly open the rank-favourite panel and then snap to the user's
    // real champion when localStorage loads.
    if (typeof window === "undefined") return;
    // Mobile: skip auto-select so the user lands on the bare molecule.
    // Tapping an atom opens the panel + path chips; that's the
    // expand-on-tap contract Tim asked for on 2026-05-21.
    if (window.matchMedia?.("(max-width: 720px)").matches) {
      autoSelectedRef.current = true;
      return;
    }
    // `initialSelectedTeam` wins over the locally-cascaded champion:
    // the share landing passes the server-resolved code here so a
    // stranger viewer lands on the actual predicted winner even when
    // the trimmed payload doesn't cascade cleanly client-side.
    const explicit = initialSelectedTeam?.toUpperCase().trim() ?? null;
    if (explicit) {
      setSelected(explicit);
      autoSelectedRef.current = true;
      return;
    }
    const champion = layout.championCode;
    if (champion) {
      setSelected(champion);
      autoSelectedRef.current = true;
      return;
    }
    // No champion derivable, pick the strongest-ranked team as a safe
    // fallback so the panel + gold-path chip aren't empty.
    const fallback = [...tournament.teams]
      .filter((t) => typeof t.fifa_rank === "number")
      .sort((a, b) => (a.fifa_rank ?? 99) - (b.fifa_rank ?? 99))[0];
    if (fallback) {
      setSelected(fallback.id);
      autoSelectedRef.current = true;
    }
  }, [layout.championCode, tournament.teams, suppressAutoSelect, initialSelectedTeam]);

  // Stage-by-team map for the side panel pill. v4: every team has many
  // instances, but they all carry the same `finalStage`, so picking any
  // instance is fine, we use the top instance for clarity.
  const finalStageByTeam = useMemo(() => {
    const m = new Map<string, FinalStage>();
    for (const node of layout.nodes) {
      if (node.isTopInstance) m.set(node.teamCode, node.finalStage);
    }
    return m;
  }, [layout.nodes]);

  const flagEmojiByTeam = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tournament.teams) {
      if (t.flag_emoji) m.set(t.id, t.flag_emoji);
    }
    return m;
  }, [tournament.teams]);

  // Compute the *active* highlighted path. Priority:
  //   1. If a team is selected AND its highlight-override is ON, use that team's path.
  //   2. Otherwise, use the predicted champion's path.
  const championPath = useMemo<TeamPath>(
    () => derivePathToGold(cascaded, layout.championCode),
    [cascaded, layout.championCode],
  );

  const selectedOverridesAllowed =
    selected !== null && (highlightOverridesByTeam[selected] ?? true);

  const activePath = useMemo<TeamPath>(() => {
    if (selectedOverridesAllowed && selected) {
      return derivePathToGold(cascaded, selected);
    }
    return championPath;
  }, [cascaded, selected, selectedOverridesAllowed, championPath]);

  const pathBondKeys = useMemo(() => buildPathBondKeySet(activePath), [activePath]);
  const pathAdvanceBondKeys = useMemo(
    () => buildPathAdvanceBondKeySet(activePath),
    [activePath],
  );
  const pathAtomSet = useMemo(() => buildPathAtomSet(activePath), [activePath]);

  const pathBondOrder = useMemo(() => {
    const m = new Map<string, { index: number; total: number }>();
    activePath.bonds.forEach((b, i) => {
      m.set(`${b.stage}:${b.a}:${b.b}`, {
        index: i,
        total: activePath.bonds.length,
      });
    });
    return m;
  }, [activePath]);

  // v5: winner per match-bond on the active path → drives the directional arrow.
  const pathWinnerByMatchBondKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of activePath.bonds) {
      if (b.winner) m.set(`${b.stage}:${b.a}:${b.b}`, b.winner);
    }
    return m;
  }, [activePath]);

  // v5: human-readable round label per match-bond on path → drives the
  // floating match-badge pill.
  const pathBondStageLabel = useMemo(() => {
    const m = new Map<string, string>();
    const BADGE: Record<BondStage, string> = {
      group: "Group",
      r32: "R32",
      r16: "R16",
      qf: "QF",
      sf: "SF",
      tp: "Bronze",
      f: "Final",
    };
    for (const b of activePath.bonds) {
      m.set(`${b.stage}:${b.a}:${b.b}`, BADGE[b.stage]);
    }
    return m;
  }, [activePath]);

  // v5: opponent-loser per layer → drives the red `⨯` glyph above the
  // opponent's terminal instance node.
  const pathLoserByTeam = useMemo(
    () => buildPathLoserAtTopInstance(activePath),
    [activePath],
  );

  // Team-name lookup, used by the v5.1 "vs <NAME>" labels so the
  // opponent at every surviving stage is unmistakable. We pull names off
  // the top-instance nodes (canonical per team).
  const teamNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const node of layout.nodes) {
      if (node.isTopInstance) m.set(node.teamCode, node.teamName);
    }
    // Defensive fallback: if a code somehow only appears as a non-top
    // instance, surface its name too rather than blanking the badge.
    for (const node of layout.nodes) {
      if (!m.has(node.teamCode)) m.set(node.teamCode, node.teamName);
    }
    return m;
  }, [layout.nodes]);

  // v5.1: for every match bond on the active path, derive the OPPONENT
  // of the path team (the other endpoint). This lets each match-bond
  // badge render "vs <FLAG> <NAME>" pointing squarely at the team the
  // path-holder beat at that stage. Tim 2026-05-11: "I can't see where
  // they're facing England clearly", so we name the opponent on every
  // stage of the gold trail.
  const pathOpponentByMatchBondKey = useMemo(() => {
    const m = new Map<string, { code: string; name: string }>();
    const teamCode = activePath.teamCode;
    if (!teamCode) return m;
    for (const b of activePath.bonds) {
      const oppCode = b.a === teamCode ? b.b : b.a;
      m.set(`${b.stage}:${b.a}:${b.b}`, {
        code: oppCode,
        name: teamNameByCode.get(oppCode) ?? oppCode,
      });
    }
    return m;
  }, [activePath, teamNameByCode]);

  // v5.1: the set of opponent codes on the active path → drives the
  // silver "opponent" rim ring on those atoms' top instance.
  const pathOpponentAtomCodes = useMemo(() => {
    const s = new Set<string>();
    const teamCode = activePath.teamCode;
    if (!teamCode) return s;
    for (const b of activePath.bonds) {
      const opp = b.a === teamCode ? b.b : b.a;
      if (opp !== teamCode) s.add(opp);
    }
    return s;
  }, [activePath]);

  const hoveredOrSelected = hovered ?? selected;
  // v4: a team has many instances, surface the deepest one for tooltips
  // / chips so the stage label is meaningful.
  const hoveredNode = hoveredOrSelected
    ? layout.nodes.find((n) => n.teamCode === hoveredOrSelected && n.isTopInstance)
        ?? layout.nodes.find((n) => n.teamCode === hoveredOrSelected)
        ?? null
    : null;

  // v5: derive the hovered team's path so the tooltip can show their
  // R32/R16/QF opponents in a small list. Empty for group-stage outs.
  const hoveredPath = useMemo<TeamPath | null>(
    () => (hoveredOrSelected ? derivePathToGold(cascaded, hoveredOrSelected) : null),
    [cascaded, hoveredOrSelected],
  );
  const HOVER_STAGE_LABEL: Record<BondStage, string> = useMemo(
    () => ({
      group: "GROUP",
      r32: "R32",
      r16: "R16",
      qf: "QF",
      sf: "SF",
      tp: "BRONZE",
      f: "FINAL",
    }),
    [],
  );

  const championAtomNode = layout.championCode
    ? layout.nodes.find(
        (n) => n.teamCode === layout.championCode && n.stage === "champion",
      ) ?? layout.nodes.find((n) => n.teamCode === layout.championCode)
    : null;

  // v6.1, "viral share landing" follow-up (2026-05-11). The side
  // panel needs the runner-up + 3rd-place codes when the user is
  // viewing the predicted champion, so it can render the podium
  // peek row underneath the hero. Both come straight off the cascade
  // (final's loser; 3rd-place playoff winner). Compute once and
  // pass through; the panel handles the "is the selected team the
  // champion?" guard itself.
  const podiumPeek = useMemo(() => {
    const final = cascaded.knockouts.find((k) => k.stage === "f");
    const tp = cascaded.knockouts.find((k) => k.stage === "tp");
    const championCode = layout.championCode ?? null;
    const runnerUpCode = final
      ? final.effective_winner === final.home.team
        ? final.away.team
        : final.effective_winner === final.away.team
          ? final.home.team
          : null
      : null;
    const thirdPlaceCode = tp?.effective_winner ?? null;
    return { championCode, runnerUpCode, thirdPlaceCode };
  }, [cascaded.knockouts, layout.championCode]);

  const showPathChip =
    !selectedOverridesAllowed && championPath.bonds.length > 0 && !!championAtomNode;

  // Group-bond visibility: hide while orbit is auto-rotating, restore on interaction.
  function onInteractionState(s: { idleMs: number; rotating: boolean }) {
    interactionRef.current = s;
    const shouldShow = !s.rotating && s.idleMs < 5000;
    setGroupBondsVisible((prev) => (prev !== shouldShow ? shouldShow : prev));
  }

  const championTeamName = championAtomNode?.teamName ?? null;
  const championFlag = layout.championCode
    ? flagEmojiByTeam.get(layout.championCode) ?? null
    : null;

  function setHighlightOverride(code: string, on: boolean): void {
    setHighlightOverridesByTeam((prev) => ({ ...prev, [code]: on }));
  }

  return (
    <div
      className="molecule-root"
      data-has-picks={layout.hasAnyKnockoutPick ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
    >
      <Canvas
        className="molecule-canvas"
        shadows={false}
        dpr={[1, 2]}
        // v6 "viral share landing" framing: closer dolly-in (z=44 vs
        // v4's z=58) frames the pyramid taller in the canvas so the apex
        // sits near the top of the frame and the group-stage base hits
        // the bottom. Tim's brief calls this out as the share-image
        // framing, so we let the on-page composition match what gets
        // captured by default. The orbit target stays just below the
        // visual midpoint at y=14 (was y=15 in v4).
        camera={{ position: [0, 14, 44], fov: 40, near: 0.1, far: 500 }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          outputColorSpace: THREE.SRGBColorSpace,
          // Capture-and-share (PR #154): canvas.toDataURL() reads the
          // WebGL drawing buffer back to the CPU. By default the GL
          // context clears the buffer after every present, so readback
          // returns a blank PNG. preserveDrawingBuffer keeps it pinned
          // for one extra frame, the cost is a minor perf hit (one
          // extra GPU->CPU copy candidate per frame) which is fine for
          // this single-pane viewer.
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <color attach="background" args={["#15151a"]} />
        <ambientLight intensity={0.55} color="#ffffff" />
        <hemisphereLight args={["#8aa0c8", "#15151a", 0.45]} />
        <directionalLight position={[20, 30, 15]} intensity={0.95} color="#fff5d0" />
        <directionalLight position={[-25, -10, -20]} intensity={0.35} color="#7eb6e8" />

        <MoleculeWorld
          layout={layout}
          selected={selected}
          hovered={hovered}
          onSelect={setSelected}
          onHover={setHovered}
          flagEmojiByTeam={flagEmojiByTeam}
          pathBondKeys={pathBondKeys}
          pathAdvanceBondKeys={pathAdvanceBondKeys}
          pathAtomSet={pathAtomSet}
          pathBondOrder={pathBondOrder}
          pathWinnerByMatchBondKey={pathWinnerByMatchBondKey}
          pathLoserByTeam={pathLoserByTeam}
          pathBondStageLabel={pathBondStageLabel}
          pathOpponentByMatchBondKey={pathOpponentByMatchBondKey}
          pathOpponentAtomCodes={pathOpponentAtomCodes}
          pathTeamCode={activePath.teamCode || null}
          motionEnabled={motionEnabled}
          groupBondsVisible={groupBondsVisible}
        />

        <OrbitControls
          ref={(c) => {
            controlsRef.current = c;
          }}
          // v6: target a touch below the visual midpoint so the apex sits
          // near the top of the frame for the share composition.
          target={[0, 14, 0]}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.7}
          minDistance={22}
          maxDistance={140}
          // v4: tighter polar-angle band, don't let the user look
          // straight down (loses the pyramid silhouette) or too far
          // overhead (sees the base disc head-on).
          minPolarAngle={Math.PI * 0.25}
          maxPolarAngle={Math.PI * 0.62}
          autoRotate
          autoRotateSpeed={0.35}
        />
        <IdleAutoRotateBridge
          controls={controlsRef}
          onInteractionState={onInteractionState}
        />
      </Canvas>

      {hideStageLegend ? null : <MoleculeLayerLabels />}

      {hideStageLegend ? null : <MoleculeLegend />}

      {/* v5, small mode hint chip surfacing when the user toggled
       * "Rank Favourites" mode. Sits just below the PATH TO GOLD chip
       * so the two stack neatly. */}
      {layoutMode === "rank-sorted" ? (
        <div className="molecule-mode-hint" role="status" aria-live="polite">
          <span>↻</span>
          <span>Rings sorted by world rank</span>
        </div>
      ) : null}

      {/* "PATH TO GOLD" chip, visible when the default champion-path is the active highlight. */}
      {showPathChip ? (
        <div className="molecule-path-chip" role="status" aria-live="polite">
          <span className="molecule-path-chip-dot" aria-hidden />
          <span className="molecule-path-chip-label">PATH TO GOLD</span>
          {championFlag ? (
            <span className="molecule-path-chip-flag" aria-hidden>{championFlag}</span>
          ) : null}
          <span className="molecule-path-chip-team">{championTeamName}</span>
        </div>
      ) : null}

      {(() => {
        // Petri-dish modal. Two states:
        //   - empty (no group picks AND no knockout picks): the user
        //     hasn't started; nudge them into the bracket builder.
        //   - incomplete (some picks but < 104): tell them how many
        //     they have, how many remain, and link them back to finish.
        // No modal when the bracket is complete OR when the scene is
        // running in read-only mode (share landings show someone else's
        // bracket and the viewer can't go fill it in).
        if (readOnly) return null;
        const groupPicks = Object.keys(bracket.matchPredictions).length;
        // Tim 2026-06-05: cascade-aware knockout count. The raw
        // predictions map keeps picks for matches with one TBD side,
        // so it overstated "remaining" -- e.g. with 6 of 8 thirds
        // picked the modal would have read "0 remaining" but the
        // bracket isn't actually finishable until the thirds are in.
        const knockoutPicks = cascaded.knockouts.reduce(
          (n, k) =>
            n +
            (k.home.team !== null && k.away.team !== null && k.effective_winner !== null
              ? 1
              : 0),
          0,
        );
        const totalPicks = groupPicks + knockoutPicks;
        const totalRequired =
          tournament.group_fixtures.length + tournament.knockouts.length;
        const isComplete = totalPicks >= totalRequired;
        if (isComplete) return null;
        if (petriModalDismissed) return null;
        const isEmpty = totalPicks === 0;
        const remaining = Math.max(0, totalRequired - totalPicks);
        return (
          <div
            className="molecule-petri-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="molecule-petri-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPetriModalDismissed(true);
            }}
          >
            <div className="molecule-petri-modal">
              <button
                type="button"
                className="molecule-petri-modal-close"
                aria-label="Dismiss"
                onClick={() => setPetriModalDismissed(true)}
              >
                ×
              </button>
              <div className="molecule-petri-modal-icon" aria-hidden="true">
                🧫
              </div>
              <h2 id="molecule-petri-title" className="molecule-petri-modal-title">
                {isEmpty
                  ? "Your molecule is still in the petri dish."
                  : "Your molecule is incomplete."}
              </h2>
              <p className="molecule-petri-modal-body">
                {isEmpty ? (
                  <>
                    The 3D molecule comes alive once you've picked every match.
                    Group winners cluster on the outer ring; your predicted
                    champion sits at the heart. Pick all{" "}
                    <strong>{totalRequired}</strong> matches to see the full
                    crystallisation.
                  </>
                ) : (
                  <>
                    You've picked{" "}
                    <strong>
                      {totalPicks} of {totalRequired}
                    </strong>{" "}
                    matches. Pick the remaining{" "}
                    <strong>{remaining}</strong> to see your tournament molecule
                    fully crystallise.
                  </>
                )}
              </p>
              <div className="molecule-petri-modal-actions">
                <a href="/world-cup-2026" className="molecule-petri-modal-cta">
                  {isEmpty ? "Start my bracket →" : "Complete my bracket →"}
                </a>
                <button
                  type="button"
                  className="molecule-petri-modal-dismiss"
                  onClick={() => setPetriModalDismissed(true)}
                >
                  Keep exploring
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Hover tooltip, desktop only. */}
      {hoveredNode && hoveredNode.teamCode !== selected ? (
        <div className="molecule-tooltip" role="tooltip">
          <div className="molecule-tooltip-head">
            <span className="molecule-tooltip-flag" aria-hidden>
              {flagEmojiByTeam.get(hoveredNode.teamCode) ?? "·"}
            </span>
            <span className="molecule-tooltip-name">{hoveredNode.teamName}</span>
            <span className="molecule-tooltip-stage">
              {finalStageLabel(hoveredNode.finalStage)}
            </span>
          </div>
          {/* v5, mini opponent list (R32 → F), if the team played any
           * knockout matches. Group-stage outs hide this section. */}
          {hoveredPath && hoveredPath.bonds.length > 0 ? (
            <ul className="molecule-tooltip-opponents" aria-label="opponents">
              {hoveredPath.bonds.map((b) => {
                const opp =
                  b.a === hoveredNode.teamCode ? b.b : b.a;
                const won = b.winner === hoveredNode.teamCode;
                const result =
                  b.winner === null
                    ? "tbd"
                    : won
                      ? "won"
                      : "lost";
                return (
                  <li key={b.matchId} className="molecule-tooltip-opp" data-result={result}>
                    <span className="molecule-tooltip-opp-stage">{HOVER_STAGE_LABEL[b.stage]}</span>
                    <span className="molecule-tooltip-opp-vs">vs</span>
                    <span className="molecule-tooltip-opp-flag" aria-hidden>
                      {flagEmojiByTeam.get(opp) ?? "·"}
                    </span>
                    <span className="molecule-tooltip-opp-name">{opp}</span>
                    <span className="molecule-tooltip-opp-result">
                      {result === "tbd" ? "predicted" : result === "won" ? "won" : "lost"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {hideSidePanel ? null : (
        <MoleculePanel
          teamCode={selected}
          tournament={tournament}
          bracket={bracket}
          cascaded={cascaded}
          finalStageByTeam={finalStageByTeam}
          flagEmojiByTeam={flagEmojiByTeam}
          highlightOverrideOn={
            selected ? highlightOverridesByTeam[selected] ?? true : true
          }
          onHighlightOverrideChange={(on) => {
            if (selected) setHighlightOverride(selected, on);
          }}
          onClose={() => setSelected(null)}
          podiumPeek={podiumPeek}
          readOnly={readOnly}
        />
      )}
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
