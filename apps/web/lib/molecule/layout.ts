/**
 * Molecule layout — pure, deterministic, no R3F deps.
 *
 * Given a tournament + a (possibly partial) `CascadedBracket`, compute the
 * 3D positions of every team-atom and the bond (edge) list connecting
 * teams that played each other.
 *
 * Geometry: concentric spherical-cap rings centred on origin.
 *
 *   Ring 0 (origin)     — predicted champion.
 *   Ring 1 (r=4)        — runner-up + 3rd-place winner.
 *   Ring 2 (r=8)        — losing semi-finalist that did NOT win 3rd place.
 *                         (Always 1 team — the 3rd-place playoff loser.)
 *   Ring 3 (r=12)       — QF losers (4 teams).
 *   Ring 4 (r=17)       — R16 losers (8 teams).
 *   Ring 5 (r=22)       — R32 losers (16 teams).
 *   Ring 6 (r=28)       — group-stage eliminated (the rest, 16 teams for
 *                          the FIFA 2026 12×4 format with 8 best-thirds
 *                          advancing).
 *
 * Each ring lays its members evenly around the y-axis, with a slight tilt
 * (theta jitter from a deterministic per-team seed) so the molecule reads
 * three-dimensional from any orbit angle rather than as a flat disc.
 *
 * Bond list: every match in the tournament that has a resolved (predicted
 * or actual) home + away team-id contributes one bond. Group bonds are
 * thin grey; R32→F bonds escalate in colour + thickness. The champion's
 * "trophy arc" — the final bond — gets the gold tier.
 *
 * Determinism: same (tournament, cascaded) → same layout. No clock reads,
 * no random calls. The "jitter" uses a stable string-hash per team code.
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

// Radius (size of the team sphere) by final stage reached.
const NODE_RADIUS: Record<FinalStage, number> = {
  champion: 2.0,
  runner_up: 1.6,
  third_place: 1.4,
  fourth_place: 1.2,
  qf: 1.05,
  r16: 0.9,
  r32: 0.78,
  group: 0.65,
};

// Ring radius from origin.
const RING_RADIUS: Record<FinalStage, number> = {
  champion: 0,
  runner_up: 4.2,
  third_place: 4.2,
  fourth_place: 8.0,
  qf: 12.0,
  r16: 17.0,
  r32: 22.0,
  group: 28.0,
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
 * matching ring.
 *
 * If a team isn't found in any knockout's resolved slots, they're
 * treated as group-stage eliminated and placed on the outermost ring.
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

      // Both teams "appear" in this stage. A loser settles at this stage;
      // a winner moves on (we'll set their deeper stage from the next match).
      // For final-stage classification:
      //   - loser of stage X → final stage = X (e.g. r32 loss → "r32")
      //   - winner of final → champion
      //   - loser of final → runner_up
      //   - winner of tp → third_place
      //   - loser of tp → fourth_place
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
          // No winner picked yet — still record both as having reached the final.
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
        // r32 / r16 / qf / sf — the loser is "out at this stage".
        // The winner's "deeper stage" will be set by their next match.
        // sf loser falls into the tp pool (handled by the next-round tp match above).
        const stageFor: Record<"r32" | "r16" | "qf" | "sf", FinalStage> = {
          r32: "r32",
          r16: "r16",
          qf: "qf",
          // SF losers are 4th-place candidates until tp resolves them; if
          // no tp winner is known yet, they sit as fourth_place tier.
          sf: "fourth_place",
        };
        const fs = stageFor[k.stage as "r32" | "r16" | "qf" | "sf"];
        if (homeIsLoser && home) setIfDeeper(home, fs);
        if (awayIsLoser && away) setIfDeeper(away, fs);

        // Also record that the winner of this stage *at least* reached
        // the next round — without overriding deeper info from later
        // matches. Use the next-stage label as a placeholder.
        const nextStage: Record<"r32" | "r16" | "qf" | "sf", FinalStage> = {
          r32: "r16",
          r16: "qf",
          qf: "fourth_place", // SF participant (loser default; tp/f match upgrades)
          sf: "runner_up", // F participant
        };
        if (winner) setIfDeeper(winner, nextStage[k.stage as "r32" | "r16" | "qf" | "sf"]);
      }
    }

    // Final: identify champion + runner-up + bronze codes for the legend / panels.
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

  // 2. Group teams by final stage so we can lay them out per-ring.
  const byStage = new Map<FinalStage, string[]>();
  for (const [code, fs] of finalStageByTeam) {
    if (!byStage.has(fs)) byStage.set(fs, []);
    byStage.get(fs)!.push(code);
  }
  // Sort each ring deterministically by team code so the layout is stable.
  for (const arr of byStage.values()) arr.sort();

  // 3. Place each team on its ring.
  const nodes: MoleculeNode[] = [];

  const placeRing = (
    fs: FinalStage,
    teams: readonly string[],
    yLift: number,
  ): void => {
    const radius = RING_RADIUS[fs];
    const nodeRadius = NODE_RADIUS[fs];
    const accent = colourFor(fs);
    const count = Math.max(1, teams.length);

    teams.forEach((code, i) => {
      // Even angular spacing + per-team jitter for depth.
      const baseAngle = (i / count) * Math.PI * 2;
      const jitterAngle = (stableHash01(code) - 0.5) * (Math.PI / 6);
      const angle = baseAngle + jitterAngle;
      // y-tilt jitter so the molecule reads 3D rather than as a flat disc.
      const yJitter = (stableHash01(code + ":y") - 0.5) * 4;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      const y = yLift + yJitter;
      const kit = teamKitPrimary(tournament, code);
      nodes.push({
        teamCode: code,
        teamName: teamName(tournament, code),
        position: [x, y, z],
        radius: nodeRadius,
        finalStage: fs,
        accentColor: kit ?? accent,
      });
    });
  };

  // Champion at origin (slightly lifted for visual prominence).
  placeRing("champion", byStage.get("champion") ?? [], 2.5);
  // Runner-up + 3rd-place share the same ring *radius* (both `RING_RADIUS.runner_up`
  // / `RING_RADIUS.third_place` resolve to 4.2 above) but each node carries its
  // own `finalStage` classification + colour. We place them as separate rings
  // so the panel/legend mapping stays honest.
  placeRing("runner_up", byStage.get("runner_up") ?? [], 1.0);
  placeRing("third_place", byStage.get("third_place") ?? [], 1.0);
  placeRing("fourth_place", byStage.get("fourth_place") ?? [], 0.5);
  placeRing("qf", byStage.get("qf") ?? [], 0);
  placeRing("r16", byStage.get("r16") ?? [], 0);
  placeRing("r32", byStage.get("r32") ?? [], 0);
  placeRing("group", byStage.get("group") ?? [], 0);

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

export const RING_RADII_TEST_ONLY: Readonly<Record<FinalStage, number>> = RING_RADIUS;
export const NODE_RADII_TEST_ONLY: Readonly<Record<FinalStage, number>> = NODE_RADIUS;

/** True if `node` sits on the outermost (group-loser) ring within tolerance. */
export function isOnGroupRing(node: MoleculeNode, tol = 0.001): boolean {
  const r = Math.hypot(node.position[0], node.position[2]);
  return Math.abs(r - RING_RADIUS.group) < tol + 1; // allow small jitter
}

/** True if `node` is at the molecule centre (champion). */
export function isAtOrigin(node: MoleculeNode, tol = 0.001): boolean {
  const r = Math.hypot(node.position[0], node.position[2]);
  return r < tol + 0.001;
}
