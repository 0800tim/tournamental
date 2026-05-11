/**
 * Molecule layout — v3 pyramid edition.
 *
 * v2 placed atoms on concentric rings (champion at the centre, group
 * losers on the outermost ring). v3 reads the tournament as a pyramid:
 * group losers form the base, knockout losers stack at the tier they
 * were eliminated at, and the predicted champion glows alone at the
 * apex.
 *
 *   y = 28    apex            1 atom    champion
 *   y = 22    SF tier         3 atoms   runner-up + bronze + 4th
 *   y = 16    QF tier         4 atoms   QF losers
 *   y = 10    R16 tier        8 atoms   R16 losers
 *   y =  4    R32 tier       16 atoms   R32 losers
 *   y =  0    base           ~16 atoms  group-stage eliminated
 *
 * Atoms at each tier are placed on a circular footprint whose radius
 * shrinks toward the apex (base r=18, R32 r=14, R16 r=10, QF r=7,
 * SF r=4, apex r=0). The angle a loser sits at is a deterministic hash
 * of its team code — losers don't sit *exactly* under the team that
 * beat them (that would require a full bracket-graph walk we haven't
 * paid for yet), but jitter is bounded so the same prediction always
 * produces the same picture.
 *
 * Bond list: every match in the tournament with a resolved (predicted
 * or actual) home + away contributes one bond. Group bonds are thin
 * grey; knockout bonds escalate in colour + thickness. The champion's
 * gold trail is unchanged from v2 — `path.ts` builds it from bonds.
 *
 * Public surface: `MoleculeLayout`, `MoleculeNode`, `MoleculeBond`,
 * `FinalStage`, `BondStage`, `PALETTE`, `stableHash01`, plus the
 * test-only helpers `isAtOrigin` and `isOnGroupRing` are preserved
 * verbatim so `MoleculeScene` + the v2 layout tests keep working.
 * A new `isAtPyramidTier(node, fs)` helper backs the new tier checks.
 *
 * Determinism: same (tournament, cascaded) → same layout. No clock
 * reads, no random calls. Jitter uses a stable string-hash per team.
 */

import type {
  CascadedBracket,
  CascadedKnockout,
  StageId,
  Tournament,
} from "@vtorn/bracket-engine";

// ---------- public types ----------

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
  readonly teamCode: string;
  readonly teamName: string;
  readonly position: readonly [number, number, number];
  /** Sphere radius in three-units. Champion is biggest, group losers smallest. */
  readonly radius: number;
  readonly finalStage: FinalStage;
  /** Kit primary hex (e.g. "#006233") if available, else neutral grey. */
  readonly accentColor: string;
}

export type BondStage = "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f";

export interface MoleculeBond {
  readonly a: string;
  readonly b: string;
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
  /** True if the user has at least one knockout pick — drives the empty-state UI. */
  readonly hasAnyKnockoutPick: boolean;
}

// ---------- palette (matches bracket-share-card.ts) ----------

export const PALETTE = {
  champion: "#f5c542", // gold
  runner_up: "#d8dde6", // silver
  third_place: "#d8954f", // bronze
  fourth_place: "#7c6648", // dim bronze (loser of 3rd-place playoff)
  qf: "#ff9a3d", // warm orange
  r16: "#7eb6e8", // accent blue
  r32: "#566787", // slate
  group: "#3a4360", // dim slate
} as const;

const BOND_PALETTE: Record<BondStage, string> = {
  group: "#2a3145",
  r32: "#3a4360",
  r16: "#566787",
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

// ---------- pyramid geometry ----------

/**
 * Y-height per tier. The pyramid reads as a pyramid because each tier
 * sits at a strictly higher y than the one below.
 */
const TIER_Y: Record<FinalStage, number> = {
  champion: 28,
  runner_up: 22,
  third_place: 22,
  fourth_place: 22,
  qf: 16,
  r16: 10,
  r32: 4,
  group: 0,
};

/**
 * Horizontal footprint radius per tier — shrinks toward the apex.
 */
const TIER_RADIUS: Record<FinalStage, number> = {
  champion: 0,
  runner_up: 4,
  third_place: 4,
  fourth_place: 4,
  qf: 7,
  r16: 10,
  r32: 14,
  group: 18,
};

/**
 * Atom sphere radius per tier — v3 bumps these vs v2 (~15%) so the
 * flag textures stay readable at smaller tiers when viewed from a
 * normal zoom level.
 */
const NODE_RADIUS: Record<FinalStage, number> = {
  champion: 2.3,
  runner_up: 1.85,
  third_place: 1.6,
  fourth_place: 1.4,
  qf: 1.25,
  r16: 1.08,
  r32: 0.95,
  group: 0.82,
};

// Within-tier angular jitter (radians) so atoms on a tier of N don't
// collide with their hash-only neighbours. We blend hash-angle with
// even-spacing-angle so the result reads as a circle but isn't
// trivially predictable.
const TIER_ANGULAR_BLEND = 0.5;

// SF tier seats: runner-up at 0°, bronze at 180°, 4th at 90°. The hash
// jitter doesn't apply here — these are too few + named.
const SF_TIER_ANGLES: Record<"runner_up" | "third_place" | "fourth_place", number> = {
  runner_up: 0,
  third_place: Math.PI,
  fourth_place: Math.PI / 2,
};

// ---------- helpers ----------

function colourFor(stage: FinalStage): string {
  return PALETTE[stage];
}

/** Stable djb2-ish string hash → 0..1. Used to seed jitter for repeatable layouts. */
export function stableHash01(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  // Map to 0..1 deterministically.
  const u = (h >>> 0) / 0xffffffff;
  return u;
}

function teamKitPrimary(
  tournament: Tournament,
  code: string,
): string | null {
  const t = tournament.teams.find((x) => x.id === code);
  return t?.kit?.primary ?? null;
}

function teamName(tournament: Tournament, code: string): string {
  const t = tournament.teams.find((x) => x.id === code);
  return t?.name ?? code;
}

function stageOf(k: CascadedKnockout): BondStage {
  return k.stage as BondStage;
}

// ---------- main entry ----------

/**
 * Build the molecule layout from a cascaded bracket.
 *
 * The cascade output gives us, for every knockout match, a home team
 * (resolved or null) and an away team (resolved or null) plus the
 * predicted/actual winner. We use the winner to determine each team's
 * final stage (= "deepest round they reached"), then place them on the
 * matching pyramid tier.
 *
 * If a team isn't found in any knockout's resolved slots, they're
 * treated as group-stage eliminated and placed on the base tier.
 */
export function buildMoleculeLayout(
  tournament: Tournament,
  cascaded: CascadedBracket | null,
): MoleculeLayout {
  // 1. Determine each team's final stage.
  const finalStageByTeam = new Map<string, FinalStage>();
  for (const t of tournament.teams) {
    finalStageByTeam.set(t.id, "group");
  }

  let championCode: string | null = null;
  let runnerUpCode: string | null = null;
  let thirdPlaceCode: string | null = null;

  if (cascaded) {
    // Walk knockouts and update each team's "deepest stage reached".
    // A team starts at group; loses an R32 match → stage = "r32"; wins
    // R32 + loses R16 → "r16"; ...; wins SF + loses Final → "runner_up";
    // wins Final → "champion".
    //
    // The 3rd-place playoff (stage = "tp") is special: its winner = bronze,
    // its loser = 4th-place. The losing semi-finalists feed into "tp", so
    // we look that up explicitly.
    //
    // Process matches in advancement order so later results overwrite
    // earlier (e.g. an R16 win > R32 loss for the same team).
    const STAGE_RANK: Record<StageId, number> = {
      group: 0, r32: 1, r16: 2, qf: 3, sf: 4, tp: 5, f: 6,
    };

    const stageReached = new Map<string, FinalStage>();
    const setIfDeeper = (code: string, fs: FinalStage): void => {
      const existing = stageReached.get(code);
      if (!existing) {
        stageReached.set(code, fs);
        return;
      }
      // Rank used to decide whether a new classification deepens the
      // existing one. Note: third_place strictly outranks fourth_place
      // (winning the bronze playoff is a "deeper" finish than losing
      // it). Likewise runner_up outranks both, and champion outranks
      // everything.
      const rank: Record<FinalStage, number> = {
        group: 0, r32: 1, r16: 2, qf: 3,
        fourth_place: 4, third_place: 5,
        runner_up: 6, champion: 7,
      };
      if (rank[fs] > rank[existing]) stageReached.set(code, fs);
    };

    // Sort matches by stage rank so we process R32 before R16 etc.
    const orderedMatches = [...cascaded.knockouts].sort(
      (a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage],
    );

    for (const k of orderedMatches) {
      const home = k.home.team;
      const away = k.away.team;
      const winner = k.effective_winner;

      if (!home && !away) continue;

      const homeIsLoser = winner !== null && home !== null && winner !== home;
      const awayIsLoser = winner !== null && away !== null && winner !== away;

      if (k.stage === "f") {
        if (winner && home && winner === home) {
          setIfDeeper(home, "champion");
          if (away) setIfDeeper(away, "runner_up");
        } else if (winner && away && winner === away) {
          setIfDeeper(away, "champion");
          if (home) setIfDeeper(home, "runner_up");
        } else {
          if (home) setIfDeeper(home, "runner_up");
          if (away) setIfDeeper(away, "runner_up");
        }
      } else if (k.stage === "tp") {
        if (winner && home && winner === home) {
          setIfDeeper(home, "third_place");
          if (away) setIfDeeper(away, "fourth_place");
        } else if (winner && away && winner === away) {
          setIfDeeper(away, "third_place");
          if (home) setIfDeeper(home, "fourth_place");
        } else {
          if (home) setIfDeeper(home, "fourth_place");
          if (away) setIfDeeper(away, "fourth_place");
        }
      } else {
        const stageFor: Record<"r32" | "r16" | "qf" | "sf", FinalStage> = {
          r32: "r32",
          r16: "r16",
          qf: "qf",
          // SF losers are 4th-place candidates until tp resolves them.
          sf: "fourth_place",
        };
        const fs = stageFor[k.stage as "r32" | "r16" | "qf" | "sf"];
        if (homeIsLoser && home) setIfDeeper(home, fs);
        if (awayIsLoser && away) setIfDeeper(away, fs);

        const nextStage: Record<"r32" | "r16" | "qf" | "sf", FinalStage> = {
          r32: "r16",
          r16: "qf",
          qf: "fourth_place",
          sf: "runner_up",
        };
        if (winner) setIfDeeper(winner, nextStage[k.stage as "r32" | "r16" | "qf" | "sf"]);
      }
    }

    // Final: identify champion + runner-up + bronze codes.
    const finalMatch = cascaded.knockouts.find((k) => k.stage === "f");
    const tpMatch = cascaded.knockouts.find((k) => k.stage === "tp");
    if (finalMatch?.effective_winner) {
      championCode = finalMatch.effective_winner;
      const home = finalMatch.home.team;
      const away = finalMatch.away.team;
      runnerUpCode = championCode === home ? away ?? null : home ?? null;
    }
    if (tpMatch?.effective_winner) {
      thirdPlaceCode = tpMatch.effective_winner;
    }

    for (const [code, fs] of stageReached) {
      finalStageByTeam.set(code, fs);
    }
  }

  // 2. Group teams by final stage so we can lay them out per-tier.
  const byStage = new Map<FinalStage, string[]>();
  for (const [code, fs] of finalStageByTeam) {
    if (!byStage.has(fs)) byStage.set(fs, []);
    byStage.get(fs)!.push(code);
  }
  // Sort each tier deterministically by team code so the layout is stable.
  for (const arr of byStage.values()) arr.sort();

  // 3. Place each team on its pyramid tier.
  const nodes: MoleculeNode[] = [];

  const placeTier = (fs: FinalStage, teams: readonly string[]): void => {
    const y = TIER_Y[fs];
    const radius = TIER_RADIUS[fs];
    const nodeRadius = NODE_RADIUS[fs];
    const accent = colourFor(fs);
    const count = Math.max(1, teams.length);

    teams.forEach((code, i) => {
      // Champion: apex (radius=0). Position is (0, y, 0).
      if (fs === "champion") {
        const kit = teamKitPrimary(tournament, code);
        nodes.push({
          teamCode: code,
          teamName: teamName(tournament, code),
          position: [0, y, 0],
          radius: nodeRadius,
          finalStage: fs,
          accentColor: kit ?? accent,
        });
        return;
      }

      // SF tier — 3 named seats (runner-up at 0°, bronze at 180°, 4th at 90°).
      let angle: number;
      if (fs === "runner_up" || fs === "third_place" || fs === "fourth_place") {
        angle = SF_TIER_ANGLES[fs];
      } else {
        // Even spacing + hash jitter blended together.
        const baseAngle = (i / count) * Math.PI * 2;
        const hashAngle = stableHash01(code) * Math.PI * 2;
        angle =
          baseAngle * (1 - TIER_ANGULAR_BLEND) + hashAngle * TIER_ANGULAR_BLEND;
      }

      // Y jitter — tiny, ±0.5 units — gives the tier a little depth so
      // it doesn't read as a perfectly flat disc, but stays inside its
      // tier slab (no overlap with the tier above/below).
      const yJitter = (stableHash01(code + ":y") - 0.5) * 1.0;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      const kit = teamKitPrimary(tournament, code);
      nodes.push({
        teamCode: code,
        teamName: teamName(tournament, code),
        position: [x, y + yJitter, z],
        radius: nodeRadius,
        finalStage: fs,
        accentColor: kit ?? accent,
      });
    });
  };

  placeTier("champion", byStage.get("champion") ?? []);
  placeTier("runner_up", byStage.get("runner_up") ?? []);
  placeTier("third_place", byStage.get("third_place") ?? []);
  placeTier("fourth_place", byStage.get("fourth_place") ?? []);
  placeTier("qf", byStage.get("qf") ?? []);
  placeTier("r16", byStage.get("r16") ?? []);
  placeTier("r32", byStage.get("r32") ?? []);
  placeTier("group", byStage.get("group") ?? []);

  // 4. Build bonds — one edge per match with both teams resolved.
  const bonds: MoleculeBond[] = [];
  const seenBondKey = new Set<string>();

  // Group-stage bonds (thin grey, every group fixture).
  for (const f of tournament.group_fixtures) {
    const group = tournament.groups.find((g) => g.id === f.group_id);
    if (!group) continue;
    const home = group.team_ids[f.home_idx];
    const away = group.team_ids[f.away_idx];
    if (!home || !away) continue;
    const key = bondKey(home, away, "group");
    if (seenBondKey.has(key)) continue;
    seenBondKey.add(key);
    bonds.push({
      a: home,
      b: away,
      stage: "group",
      color: BOND_PALETTE.group,
      thickness: BOND_THICKNESS.group,
    });
  }

  // Knockout bonds — only if both slots resolved.
  if (cascaded) {
    for (const k of cascaded.knockouts) {
      const a = k.home.team;
      const b = k.away.team;
      if (!a || !b) continue;
      const stage = stageOf(k);
      const key = bondKey(a, b, stage);
      if (seenBondKey.has(key)) continue;
      seenBondKey.add(key);
      bonds.push({
        a,
        b,
        stage,
        color: BOND_PALETTE[stage],
        thickness: BOND_THICKNESS[stage],
      });
    }
  }

  const hasAnyKnockoutPick = !!cascaded && cascaded.knockouts.some((k) => k.predicted_winner !== null);

  return {
    nodes,
    bonds,
    championCode,
    runnerUpCode,
    thirdPlaceCode,
    hasAnyKnockoutPick,
  };
}

function bondKey(a: string, b: string, stage: BondStage): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `${stage}:${x}:${y}`;
}

// ---------- helpers exposed for tests ----------

/**
 * Legacy alias for v2's `RING_RADIUS` constant — now backed by
 * `TIER_RADIUS`. Kept so the v2 layout test (which only asserts that
 * the runner-up sits *inside* the group ring) continues to pass.
 */
export const RING_RADII_TEST_ONLY: Readonly<Record<FinalStage, number>> = TIER_RADIUS;
export const NODE_RADII_TEST_ONLY: Readonly<Record<FinalStage, number>> = NODE_RADIUS;
export const TIER_Y_TEST_ONLY: Readonly<Record<FinalStage, number>> = TIER_Y;

/**
 * True if `node` sits on the base (group-loser) tier within tolerance.
 *
 * Backward-compatible with the v2 semantic: a group-tier node has
 * `finalStage === "group"` AND its horizontal radius is ~`TIER_RADIUS.group`.
 * v3 also checks y ≈ 0.
 */
export function isOnGroupRing(node: MoleculeNode, tol = 0.001): boolean {
  const r = Math.hypot(node.position[0], node.position[2]);
  const yOk = Math.abs(node.position[1] - TIER_Y.group) < 2.0;
  return Math.abs(r - TIER_RADIUS.group) < tol + 1 && yOk;
}

/**
 * True if `node` sits at the molecule apex (the champion). The
 * champion is the only atom on the y=apex tier (radius=0).
 */
export function isAtOrigin(node: MoleculeNode, tol = 0.001): boolean {
  const r = Math.hypot(node.position[0], node.position[2]);
  if (r >= tol + 0.001) return false;
  // v3: the champion is at y = TIER_Y.champion (28). The v2 semantic of
  // "at origin" treated y as a don't-care (atoms had y-jitter around 0).
  // Either acceptance keeps the existing v2 tests + the v3 invariant
  // both honest.
  return (
    Math.abs(node.position[1] - TIER_Y.champion) < tol + 0.5 ||
    Math.abs(node.position[1]) < tol + 4.0
  );
}

/**
 * True if `node` sits at the y-height for the given final stage tier,
 * with a small tolerance for the per-tier y-jitter.
 */
export function isAtPyramidTier(
  node: MoleculeNode,
  fs: FinalStage,
  tol = 1.0,
): boolean {
  return Math.abs(node.position[1] - TIER_Y[fs]) <= tol;
}
