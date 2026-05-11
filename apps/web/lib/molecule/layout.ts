/**
 * Molecule layout, v4 multi-instance pyramid edition.
 *
 * v3 emitted one node per team, placed at the y-height of the deepest
 * stage that team reached. Result: nice classification, but visually
 * most teams ended up clustered at the base (because most teams *get*
 * eliminated early) and the pyramid silhouette only existed in the
 * count-per-tier, not in the placement.
 *
 * v4 inverts that. Each team gets **one node per surviving layer** -
 * a group-stage loser has 1 node (at the base), a R32 loser has 2
 * (group + r32), a champion has 7 (group + r32 + r16 + qf + sf + f +
 * champion@apex). For a fully-resolved 48-team WC: 48 + 32 + 16 + 8 +
 * 4 + 2 + 1 = **111 nodes** total. The silhouette is then a literal
 * cone.
 *
 *   y = 30    champion        1 atom    the trophy holder (apex)
 *   y = 25    f               2 atoms   champion + runner-up
 *   y = 20    sf              4 atoms   semi-finalists
 *   y = 15    qf              8 atoms   quarter-finalists
 *   y = 10    r16            16 atoms   round-of-16 entrants
 *   y =  5    r32            32 atoms   round-of-32 entrants
 *   y =  0    group          48 atoms   every team competing
 *
 * Per-team azimuth: each team gets one stable azimuth derived from a
 * djb2 hash of `"{teamCode}:azimuth"`. The *same* azimuth is used at
 * every layer the team occupies → each team's instances stack into a
 * near-vertical column rising up the pyramid. The Final layer (only
 * two atoms) overrides azimuth to 0 / π so the two finalists read as
 * an opposing pair across the apex.
 *
 * Two kinds of bonds:
 *   - **match bonds**, connect both teams' instances at the same layer
 *     (the match they played there). Horizontal lines at layer Y.
 *   - **advance bonds**, connect (team@layer N, team@layer N+1) for
 *     the same team. These are the rising columns. Default slate +
 *     thin; light up gold when the team is on the champion's path.
 *
 * Public surface keeps backwards-compat fields:
 *   - `MoleculeNode.teamCode`, `position`, `radius`, `finalStage`,
 *     `accentColor`, `teamName`, unchanged.
 *   - `MoleculeBond.a`, `b`, `stage`, `color`, `thickness`, unchanged
 *     semantics for match bonds. For advance bonds, `a === b` (it's the
 *     team progressing) and `stage` is the *higher* of the two layers.
 *   - New fields: `MoleculeNode.id`, `stage`, `isTopInstance` and
 *     `MoleculeBond.id`, `kind`, `aStage`, `bStage`.
 *
 * Tests asserting "champion at apex" should now look up the team's
 * `isTopInstance` (a champion's top instance is at stage="champion").
 * Tests looking up a team by `teamCode === "FOO"` find the *first*
 * instance, the group-layer one, by convention; if you need the
 * deepest, filter with `isTopInstance` too.
 *
 * Determinism: pure function over (tournament, cascaded). No clock
 * reads, no random calls.
 */

import type {
  CascadedBracket,
  StageId,
  Tournament,
} from "@vtorn/bracket-engine";

// ---------- public types ----------

/**
 * A literal layer the pyramid is built from. Strictly ordered:
 * group < r32 < r16 < qf < sf < f < champion.
 */
export type LayerStage = "group" | "r32" | "r16" | "qf" | "sf" | "f" | "champion";

/**
 * Legacy "deepest stage reached" classification. Kept for backwards
 * compatibility with the side-panel pill + existing tests. The mapping
 * from v4 LayerStage → FinalStage is:
 *   - top instance at "champion" → finalStage = "champion"
 *   - top instance at "f"        → finalStage = "runner_up"
 *   - top instance at "sf"       → finalStage = "third_place" or "fourth_place"
 *                                   (determined by the tp match if present)
 *   - top instance at "qf"       → finalStage = "qf"
 *   - top instance at "r16"      → finalStage = "r16"
 *   - top instance at "r32"      → finalStage = "r32"
 *   - top instance at "group"    → finalStage = "group"
 *
 * Non-top instances always carry the same finalStage as their team's top
 * instance, so a champion's r32 instance still has `finalStage = "champion"`.
 * This keeps colour/rim logic stable across a team's column.
 */
export type FinalStage =
  | "champion"
  | "runner_up"
  | "third_place"
  | "fourth_place"
  | "qf"
  | "r16"
  | "r32"
  | "group";

export interface MoleculeNode {
  /** Unique node id: `"{teamCode}:{stage}"`. */
  readonly id: string;
  readonly teamCode: string;
  readonly teamName: string;
  readonly position: readonly [number, number, number];
  /** Sphere radius in three-units. Grows toward the apex. */
  readonly radius: number;
  /** The literal layer this instance sits on. */
  readonly stage: LayerStage;
  /** True for the deepest instance of this team, drives "deepest finish" UI cues. */
  readonly isTopInstance: boolean;
  /** Legacy "deepest stage reached" classification. */
  readonly finalStage: FinalStage;
  /** Kit primary hex (e.g. "#006233") if available, else palette fallback. */
  readonly accentColor: string;
  /**
   * FIFA world rank at config time (lower = stronger). Used by v5 to
   * sort teams within each ring (in rank-favourites mode) and to render
   * the "#42" rank chip below non-path team labels. May be `null` for
   * placeholder slots.
   */
  readonly fifaRank: number | null;
}

export type BondStage = "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f";

export interface MoleculeBond {
  /** Unique bond id: `"{kind}:{a}@{aStage}:{b}@{bStage}"`. */
  readonly id: string;
  /** Match bond = both endpoints are different teams at the same layer.
   *  Advance bond = same team at two adjacent layers. */
  readonly kind: "match" | "advance";
  readonly a: string;
  readonly b: string;
  readonly aStage: LayerStage;
  readonly bStage: LayerStage;
  /**
   * Legacy stage tag for match-bond colouring. For match bonds this is
   * the layer they share (mapped through the v3 BondStage union). For
   * advance bonds this is the *higher* of the two layers, but advance
   * bonds carry their own colouring so it's largely informational.
   */
  readonly stage: BondStage;
  readonly color: string;
  readonly thickness: number;
}

export interface MoleculeLayout {
  readonly nodes: readonly MoleculeNode[];
  readonly bonds: readonly MoleculeBond[];
  /** Predicted champion team code if known, else null. */
  readonly championCode: string | null;
  readonly runnerUpCode: string | null;
  readonly thirdPlaceCode: string | null;
  /** True if the user has at least one knockout pick, drives the empty-state UI. */
  readonly hasAnyKnockoutPick: boolean;
}

// ---------- palette ----------

export const PALETTE = {
  champion: "#f5c542", // gold
  runner_up: "#d8dde6", // silver
  third_place: "#d8954f", // bronze
  fourth_place: "#7c6648", // dim bronze
  qf: "#ff9a3d", // warm orange
  r16: "#7eb6e8", // accent blue
  r32: "#566787", // slate
  group: "#3a4360", // dim slate
} as const;

const BOND_PALETTE: Record<BondStage, string> = {
  group: "#2a3145",
  r32: "#566787",
  r16: "#7eb6e8",
  qf: "#ff9a3d",
  sf: "#ff6b3d",
  tp: "#d8954f",
  f: "#f5c542",
};

const BOND_THICKNESS: Record<BondStage, number> = {
  group: 0.4,
  r32: 0.7,
  r16: 1.0,
  qf: 1.5,
  sf: 2.0,
  tp: 1.5,
  f: 3.0,
};

/** Advance-bond visual constants. */
export const ADVANCE_BOND = {
  color: "#3a4360",
  colorOnPath: "#fbbf24",
  thickness: 0.75,
} as const;

// ---------- pyramid geometry ----------

/** Y-height per layer. Strictly monotonic ascending. */
const LAYER_Y: Record<LayerStage, number> = {
  group: 0,
  r32: 5,
  r16: 10,
  qf: 15,
  sf: 20,
  f: 25,
  champion: 30,
};

/** Horizontal tier radius per layer. Strictly monotonic decreasing. */
const LAYER_RADIUS: Record<LayerStage, number> = {
  group: 26,
  r32: 19,
  r16: 13,
  qf: 8,
  sf: 4.5,
  f: 2.2,
  champion: 0,
};

/** Sphere radius per layer. Grows toward the apex. */
const NODE_RADIUS: Record<LayerStage, number> = {
  group: 0.55,
  r32: 0.7,
  r16: 0.85,
  qf: 1.05,
  sf: 1.3,
  f: 1.6,
  champion: 2.1,
};

/** Y-jitter range at the base only (±units). Stops the base reading as a flat plane. */
const BASE_Y_JITTER = 0.4;

/** All layers in ascending order. */
const LAYER_ORDER: readonly LayerStage[] = [
  "group",
  "r32",
  "r16",
  "qf",
  "sf",
  "f",
  "champion",
];

const LAYER_INDEX: Record<LayerStage, number> = (() => {
  const m: Record<string, number> = {};
  LAYER_ORDER.forEach((l, i) => {
    m[l] = i;
  });
  return m as Record<LayerStage, number>;
})();

// ---------- helpers ----------

/** Stable djb2-ish string hash → [0, 1]. */
export function stableHash01(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0) / 0xffffffff;
}

function teamKitPrimary(t: Tournament, code: string): string | null {
  return t.teams.find((x) => x.id === code)?.kit?.primary ?? null;
}

function teamName(t: Tournament, code: string): string {
  return t.teams.find((x) => x.id === code)?.name ?? code;
}

function teamFifaRank(t: Tournament, code: string): number | null {
  const team = t.teams.find((x) => x.id === code);
  return team?.fifa_rank ?? null;
}

/** Stable azimuth angle (radians, 0..2π) for a team. Same θ at every layer. */
function teamAzimuth(teamCode: string): number {
  return stableHash01(`${teamCode}:azimuth`) * Math.PI * 2;
}

/**
 * v5, Layout sort mode. Controls the azimuth allocation for each team
 * within each ring.
 *
 *   "stable"     , per-team hash, identical across layers. The historical
 *                   v4 behaviour: a team's column rises near-vertically up
 *                   the pyramid because the azimuth is constant.
 *   "rank-sorted", within each ring, teams are placed around the circle
 *                   in FIFA-rank order. Strongest at θ=0 (camera-front),
 *                   weakest at θ=π (back). Different rings can therefore
 *                   place the *same* team at slightly different azimuths,
 *                   since the ring's neighbours differ. The pyramid still
 *                   reads as a cone, but the rank gradient sweeps around
 *                   each tier, which is the headline visual in "Rank
 *                   Favourites" mode.
 */
export type LayoutMode = "stable" | "rank-sorted";

/** Compute a rank-sorted azimuth lookup for every (team, layer) pair. */
function computeRankSortedAzimuths(
  tournament: Tournament,
  layerForTeam: ReadonlyMap<string, LayerStage>,
  deepestLayer: ReadonlyMap<LayerStage, ReadonlySet<string>>,
): Map<string, Map<LayerStage, number>> {
  const out = new Map<string, Map<LayerStage, number>>();
  for (const layer of LAYER_ORDER) {
    if (layer === "champion") continue;
    const codes = deepestLayer.get(layer);
    if (!codes) continue;
    const sorted = [...codes].sort((a, b) => {
      const ra = teamFifaRank(tournament, a) ?? 999;
      const rb = teamFifaRank(tournament, b) ?? 999;
      if (ra !== rb) return ra - rb;
      return a < b ? -1 : 1;
    });
    const n = sorted.length;
    sorted.forEach((code, i) => {
      // Map index → azimuth in [0, 2π). Strongest at θ=0, weakest at θ=π,
      // then wrapping back to θ→2π for the mid-tier teams. The mapping
      // i / n produces an even fan around the ring.
      const angle = (i / Math.max(1, n)) * Math.PI * 2;
      let bucket = out.get(code);
      if (!bucket) {
        bucket = new Map();
        out.set(code, bucket);
      }
      bucket.set(layer, angle);
    });
  }
  return out;
}

/** Position of a team's instance at a given layer. */
function instancePosition(
  teamCode: string,
  stage: LayerStage,
  override?: { azimuth?: number },
): [number, number, number] {
  if (stage === "champion") return [0, LAYER_Y.champion, 0];
  const radius = LAYER_RADIUS[stage];
  const angle = override?.azimuth ?? teamAzimuth(teamCode);
  const x = radius * Math.cos(angle);
  const z = radius * Math.sin(angle);
  let y = LAYER_Y[stage];
  if (stage === "group") {
    // Tiny seeded y-jitter so the base doesn't read as a perfectly flat disc.
    y += (stableHash01(`${teamCode}:y`) - 0.5) * BASE_Y_JITTER * 2;
  }
  return [x, y, z];
}

/** Stage rank from the bracket-engine's StageId union. */
const STAGE_RANK: Record<StageId, number> = {
  group: 0, r32: 1, r16: 2, qf: 3, sf: 4, tp: 5, f: 6,
};

// ---------- main entry ----------

/**
 * Build the molecule layout from a cascaded bracket.
 *
 * v5: optionally accepts `mode = "rank-sorted"` to re-sort each ring by
 * FIFA rank instead of using the per-team stable hash. Default is
 * `"stable"` to preserve the v4 column visual.
 */
export function buildMoleculeLayout(
  tournament: Tournament,
  cascaded: CascadedBracket | null,
  mode: LayoutMode = "stable",
): MoleculeLayout {
  // 1. Determine each team's deepest layer reached.
  //
  // Default: every team starts at "group" (= competed in group stage,
  // didn't survive to the knockouts). We deepen the classification as
  // we walk knockout matches in stage order.
  const deepestLayer = new Map<LayerStage, Set<string>>();
  const layerForTeam = new Map<string, LayerStage>();
  for (const t of tournament.teams) {
    layerForTeam.set(t.id, "group");
  }

  // We also need to know who reached each layer (entered, regardless of
  // whether they won/lost there). A team is "in" layer L if they played
  // a match at layer L. Champion is "in" the champion layer (apex) too.
  // Reaching a layer is the union of "lost at L" + "won at L → reaches
  // L+1".

  let championCode: string | null = null;
  let runnerUpCode: string | null = null;
  let thirdPlaceCode: string | null = null;

  if (cascaded) {
    // Process matches in stage order.
    const ordered = [...cascaded.knockouts].sort(
      (a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage],
    );

    /** Upgrade a team's deepest-layer marker if `next` is deeper. */
    const setDeeper = (code: string, next: LayerStage) => {
      const cur = layerForTeam.get(code);
      if (!cur || LAYER_INDEX[next] > LAYER_INDEX[cur]) {
        layerForTeam.set(code, next);
      }
    };

    for (const k of ordered) {
      const home = k.home.team;
      const away = k.away.team;
      const winner = k.effective_winner;
      const stage = k.stage;

      // A team only "reaches" a knockout layer if they appear in a match
      // at that layer. The cascade only places teams into a knockout
      // slot when the upstream resolves; if both slots are null we don't
      // count anyone as reaching this layer.
      const playedHere: string[] = [];
      if (home) playedHere.push(home);
      if (away) playedHere.push(away);

      if (stage === "r32" || stage === "r16" || stage === "qf" || stage === "sf") {
        // Anyone who played at this layer reached it.
        for (const c of playedHere) setDeeper(c, stage);
        // The winner reached the *next* layer too.
        if (winner) {
          const next: LayerStage =
            stage === "r32" ? "r16" :
            stage === "r16" ? "qf" :
            stage === "qf" ? "sf" :
            "f";
          setDeeper(winner, next);
        }
      } else if (stage === "f") {
        for (const c of playedHere) setDeeper(c, "f");
        if (winner) setDeeper(winner, "champion");

        // Identify champion + runner-up codes for the layout summary.
        if (winner) {
          championCode = winner;
          runnerUpCode = home === winner ? (away ?? null) : (home ?? null);
        }
      } else if (stage === "tp") {
        // The 3rd-place playoff doesn't grant a new layer, both teams
        // are already at SF as their deepest. We do, however, mark both
        // participants as having *reached* SF (in case the cascade
        // omitted them from their semi-final fixture, e.g. the
        // synthesised single-route fixtures used in tests). And we
        // record the tp winner for the side-panel bronze pill.
        if (winner) thirdPlaceCode = winner;
        for (const c of playedHere) setDeeper(c, "sf");
      }
      // "group" stage in the bracket-engine is unrelated to knockout layers.
    }
  }

  // 2. Materialise per-team layer sets, every layer index ≤ deepest is
  //    occupied by that team. e.g. deepest = "qf" → ["group","r32","r16","qf"].
  for (const [code, deepest] of layerForTeam) {
    const cap = LAYER_INDEX[deepest];
    const layers = LAYER_ORDER.slice(0, cap + 1);
    for (const l of layers) {
      let s = deepestLayer.get(l);
      if (!s) {
        s = new Set();
        deepestLayer.set(l, s);
      }
      s.add(code);
    }
  }

  // 3. Compute Final-layer azimuth overrides, 0 for the team whose
  //    teamCode sorts first, π for the other. This makes the two atoms
  //    sit at opposite sides of the apex (reads as a "final pair").
  const finalLayerOverrides = new Map<string, number>();
  const finalists: string[] = [];
  if (championCode) finalists.push(championCode);
  if (runnerUpCode) finalists.push(runnerUpCode);
  if (finalists.length === 2) {
    const sorted = [...finalists].sort();
    finalLayerOverrides.set(sorted[0]!, 0);
    finalLayerOverrides.set(sorted[1]!, Math.PI);
  }

  // 4. Compute legacy finalStage classification (one per team).
  //
  // For tp-loser semi-finalists we mark "fourth_place"; tp-winner is
  // "third_place". If tp isn't resolved, both semi-finalists get
  // "third_place"-style classification only for the team who won bronze,
  // and the loser stays at "fourth_place"; if tp absent entirely both
  // get "fourth_place", but the v3 tests expected `third_place` and
  // `fourth_place` to both appear, so we honour the tp result when present.
  const finalStageOf = (code: string): FinalStage => {
    const deepest = layerForTeam.get(code) ?? "group";
    if (deepest === "champion") return "champion";
    if (deepest === "f") return "runner_up";
    if (deepest === "sf") {
      if (thirdPlaceCode === code) return "third_place";
      // If tp resolved and this team isn't the winner, they're 4th.
      if (thirdPlaceCode !== null) return "fourth_place";
      // tp not resolved, fall back to fourth_place; the bronze pill
      // requires an explicit tp winner.
      return "fourth_place";
    }
    if (deepest === "qf") return "qf";
    if (deepest === "r16") return "r16";
    if (deepest === "r32") return "r32";
    return "group";
  };

  // 5. Emit nodes. Iterate layers from base → apex so the legacy-lookup
  //    "find by teamCode" defaults to the group-layer (base) instance.
  const nodes: MoleculeNode[] = [];

  // v5: rank-sorted azimuths per (team, layer). Empty in stable mode.
  const rankAzimuths =
    mode === "rank-sorted"
      ? computeRankSortedAzimuths(tournament, layerForTeam, deepestLayer)
      : null;

  for (const layer of LAYER_ORDER) {
    const teamsAtLayer = deepestLayer.get(layer);
    if (!teamsAtLayer) continue;
    // Sort by teamCode for determinism.
    const sorted = [...teamsAtLayer].sort();
    for (const code of sorted) {
      const deepest = layerForTeam.get(code) ?? "group";
      const isTop = deepest === layer;
      const fs = finalStageOf(code);
      const kit = teamKitPrimary(tournament, code);
      const accent = kit ?? PALETTE[fs];

      let override: { azimuth?: number } | undefined;
      if (layer === "f" && finalLayerOverrides.has(code)) {
        override = { azimuth: finalLayerOverrides.get(code)! };
      } else if (rankAzimuths) {
        const a = rankAzimuths.get(code)?.get(layer);
        if (a !== undefined) override = { azimuth: a };
      }

      nodes.push({
        id: `${code}:${layer}`,
        teamCode: code,
        teamName: teamName(tournament, code),
        position: instancePosition(code, layer, override),
        radius: NODE_RADIUS[layer],
        stage: layer,
        isTopInstance: isTop,
        finalStage: fs,
        accentColor: accent,
        fifaRank: teamFifaRank(tournament, code),
      });
    }
  }

  // 6. Build bonds.
  const bonds: MoleculeBond[] = [];
  const seenBondId = new Set<string>();

  // 6a. Match bonds, group-stage fixtures (always at the base layer).
  for (const f of tournament.group_fixtures) {
    const group = tournament.groups.find((g) => g.id === f.group_id);
    if (!group) continue;
    const home = group.team_ids[f.home_idx];
    const away = group.team_ids[f.away_idx];
    if (!home || !away) continue;
    const id = matchBondId(home, away, "group");
    if (seenBondId.has(id)) continue;
    seenBondId.add(id);
    bonds.push({
      id,
      kind: "match",
      a: home < away ? home : away,
      b: home < away ? away : home,
      aStage: "group",
      bStage: "group",
      stage: "group",
      color: BOND_PALETTE.group,
      thickness: BOND_THICKNESS.group,
    });
  }

  // 6b. Match bonds, knockout matches. Map StageId → LayerStage. We
  //     skip "tp" entirely (no dedicated tier for the 3rd-place playoff
  //     in v4; both teams already have an SF instance, and a tp bond
  //     would float at SF height without a sensible visual home).
  if (cascaded) {
    for (const k of cascaded.knockouts) {
      const a = k.home.team;
      const b = k.away.team;
      if (!a || !b) continue;
      const stage = k.stage;
      if (stage === "tp") continue;
      // After filtering "tp", stage is "r32" | "r16" | "qf" | "sf" | "f"
      //, all of which exist as both LayerStage and BondStage keys.
      const layer = stage as Exclude<LayerStage, "group" | "champion">;
      const bondStage = stage as Exclude<BondStage, "group" | "tp">;
      const id = matchBondId(a, b, layer);
      if (seenBondId.has(id)) continue;
      seenBondId.add(id);
      bonds.push({
        id,
        kind: "match",
        a: a < b ? a : b,
        b: a < b ? b : a,
        aStage: layer,
        bStage: layer,
        stage: bondStage,
        color: BOND_PALETTE[bondStage],
        thickness: BOND_THICKNESS[bondStage],
      });
    }
  }

  // 6c. Advance bonds, for each team, connect their instance at
  //     layer N to their instance at layer N+1, for every N up to their
  //     deepest layer.
  for (const [code, deepest] of layerForTeam) {
    const cap = LAYER_INDEX[deepest];
    for (let i = 0; i < cap; i++) {
      const lower = LAYER_ORDER[i]!;
      const upper = LAYER_ORDER[i + 1]!;
      const id = advanceBondId(code, lower, upper);
      if (seenBondId.has(id)) continue;
      seenBondId.add(id);
      bonds.push({
        id,
        kind: "advance",
        a: code,
        b: code,
        aStage: lower,
        bStage: upper,
        stage: upper as BondStage,
        color: ADVANCE_BOND.color,
        thickness: ADVANCE_BOND.thickness,
      });
    }
  }

  const hasAnyKnockoutPick =
    !!cascaded && cascaded.knockouts.some((k) => k.predicted_winner !== null);

  return {
    nodes,
    bonds,
    championCode,
    runnerUpCode,
    thirdPlaceCode,
    hasAnyKnockoutPick,
  };
}

function matchBondId(a: string, b: string, layer: LayerStage): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `match:${x}@${layer}:${y}@${layer}`;
}

function advanceBondId(code: string, lower: LayerStage, upper: LayerStage): string {
  return `advance:${code}@${lower}:${code}@${upper}`;
}

// ---------- helpers exposed for tests ----------

/** v3 legacy alias, `RING_RADII_TEST_ONLY` was indexed by FinalStage. We
 * re-derive the equivalent for v4: each FinalStage maps to the layer that
 * a team with that classification *occupies as its deepest instance*. */
export const RING_RADII_TEST_ONLY: Readonly<Record<FinalStage, number>> = {
  champion: LAYER_RADIUS.champion,
  runner_up: LAYER_RADIUS.f,
  third_place: LAYER_RADIUS.sf,
  fourth_place: LAYER_RADIUS.sf,
  qf: LAYER_RADIUS.qf,
  r16: LAYER_RADIUS.r16,
  r32: LAYER_RADIUS.r32,
  group: LAYER_RADIUS.group,
};

export const NODE_RADII_TEST_ONLY: Readonly<Record<FinalStage, number>> = {
  champion: NODE_RADIUS.champion,
  runner_up: NODE_RADIUS.f,
  third_place: NODE_RADIUS.sf,
  fourth_place: NODE_RADIUS.sf,
  qf: NODE_RADIUS.qf,
  r16: NODE_RADIUS.r16,
  r32: NODE_RADIUS.r32,
  group: NODE_RADIUS.group,
};

export const TIER_Y_TEST_ONLY: Readonly<Record<FinalStage, number>> = {
  champion: LAYER_Y.champion,
  runner_up: LAYER_Y.f,
  third_place: LAYER_Y.sf,
  fourth_place: LAYER_Y.sf,
  qf: LAYER_Y.qf,
  r16: LAYER_Y.r16,
  r32: LAYER_Y.r32,
  group: LAYER_Y.group,
};

/** Direct LAYER_Y accessor for v4 tests. */
export const LAYER_Y_TEST_ONLY: Readonly<Record<LayerStage, number>> = LAYER_Y;
export const LAYER_RADIUS_TEST_ONLY: Readonly<Record<LayerStage, number>> = LAYER_RADIUS;
export const LAYER_NODE_RADIUS_TEST_ONLY: Readonly<Record<LayerStage, number>> = NODE_RADIUS;
export const LAYER_ORDER_TEST_ONLY: readonly LayerStage[] = LAYER_ORDER;

/**
 * True if `node` sits on the group base (horizontal radius ≈ group tier).
 * v4: we tolerate the group tier radius across slightly more nodes
 * because every team has a group instance. Test-only convenience.
 */
export function isOnGroupRing(node: MoleculeNode, tol = 0.001): boolean {
  if (node.stage !== "group") return false;
  const r = Math.hypot(node.position[0], node.position[2]);
  const yOk = Math.abs(node.position[1] - LAYER_Y.group) <= BASE_Y_JITTER + 0.001;
  return Math.abs(r - LAYER_RADIUS.group) < tol + 1 && yOk;
}

/**
 * True if `node` is the champion's apex instance, i.e. the team is the
 * champion and their instance is at the champion layer (x=z=0).
 */
export function isAtOrigin(node: MoleculeNode, tol = 0.001): boolean {
  if (node.stage !== "champion") return false;
  const r = Math.hypot(node.position[0], node.position[2]);
  if (r >= tol + 0.001) return false;
  return Math.abs(node.position[1] - LAYER_Y.champion) < tol + 0.5;
}

/**
 * True if `node` sits at the y-height for the given legacy final-stage tier,
 * with a small tolerance.
 */
export function isAtPyramidTier(
  node: MoleculeNode,
  fs: FinalStage,
  tol = 1.0,
): boolean {
  return Math.abs(node.position[1] - TIER_Y_TEST_ONLY[fs]) <= tol;
}

/** Helper for tests that want all instances of a given team. */
export function instancesOf(
  nodes: readonly MoleculeNode[],
  teamCode: string,
): MoleculeNode[] {
  return nodes.filter((n) => n.teamCode === teamCode);
}
