/**
 * Champion-path derivation — given a `CascadedBracket` and a team code,
 * return the ordered chain of knockout matches that team plays through
 * to reach (or be eliminated short of) the Final.
 *
 * Why this lives in its own module: the molecule view needs to highlight
 * the predicted champion's path-to-gold by default, and the team's path
 * when the user clicks any atom. Both call the same derivation; only the
 * starting team code differs.
 *
 * The chain is returned as ordered `(stage, bond)` pairs from earliest
 * to latest stage — R32 → R16 → QF → SF → F. A team that doesn't appear
 * in any knockout returns an empty list (group-stage out, no path).
 *
 * Determinism: pure function over its inputs; no clock reads, no random.
 */

import type { CascadedBracket, CascadedKnockout } from "@vtorn/bracket-engine";

import type { BondStage } from "./layout";

export interface PathBond {
  /** Stage of the bond — earlier stages come first in the array. */
  readonly stage: BondStage;
  /** Lexicographically-sorted (a, b) team-code pair, matching MoleculeBond. */
  readonly a: string;
  readonly b: string;
  /** Underlying match id from the cascade — useful for tests and tooltips. */
  readonly matchId: string;
}

export interface TeamPath {
  /** The team this path is for. */
  readonly teamCode: string;
  /** Ordered (R32 → F) list of bonds the team plays. May be empty. */
  readonly bonds: readonly PathBond[];
  /**
   * All team codes that appear *on* the path — i.e. the team itself plus
   * every opponent encountered. Useful for atom highlighting (gold rim).
   */
  readonly atomCodes: readonly string[];
  /** True if this team reaches (i.e. plays in) the Final match. */
  readonly reachesFinal: boolean;
  /** True if this team wins the Final match. */
  readonly winsFinal: boolean;
}

/**
 * Stage ordering for sort. Lower number = earlier in the bracket.
 * `tp` (3rd-place playoff) deliberately sits between sf and f, but is
 * excluded from a "path to gold" because the gold trail is to the final;
 * a bronze playoff is a parallel branch.
 */
const STAGE_ORDER: Record<BondStage, number> = {
  group: 0,
  r32: 1,
  r16: 2,
  qf: 3,
  sf: 4,
  tp: 5,
  f: 6,
};

const KNOCKOUT_STAGES: ReadonlySet<BondStage> = new Set([
  "r32",
  "r16",
  "qf",
  "sf",
  "f",
]);

function bondPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Derive the path of knockout matches a single team plays through the
 * tournament cascade. Matches are returned in stage order (earliest →
 * latest), including the final if the team reached it.
 *
 * `cascaded` may be `null` — e.g. when no bracket has been loaded yet.
 * In that case we return an empty path.
 *
 * The 3rd-place playoff ("tp") is *excluded* from the path-to-gold:
 * the gold trail represents the route to the trophy, not the consolation
 * branch. If the team played the tp match, the path stops at their SF
 * loss.
 */
export function derivePathToGold(
  cascaded: CascadedBracket | null,
  teamCode: string | null | undefined,
): TeamPath {
  if (!cascaded || !teamCode) {
    return {
      teamCode: teamCode ?? "",
      bonds: [],
      atomCodes: [],
      reachesFinal: false,
      winsFinal: false,
    };
  }

  // Only consider knockout matches where this team appears as home OR away
  // AND both slots are resolved (otherwise we can't draw a bond yet).
  const myMatches: CascadedKnockout[] = cascaded.knockouts.filter((k) => {
    if (!KNOCKOUT_STAGES.has(k.stage as BondStage)) return false;
    const a = k.home.team;
    const b = k.away.team;
    if (!a || !b) return false;
    return a === teamCode || b === teamCode;
  });

  if (myMatches.length === 0) {
    return {
      teamCode,
      bonds: [],
      atomCodes: [],
      reachesFinal: false,
      winsFinal: false,
    };
  }

  // Sort by stage order so the trail reads "R32 → R16 → ... → F".
  const sorted = [...myMatches].sort(
    (x, y) =>
      STAGE_ORDER[x.stage as BondStage] - STAGE_ORDER[y.stage as BondStage],
  );

  // Build path bonds + accumulate the atom codes (team + opponents).
  const bonds: PathBond[] = [];
  const atomSet = new Set<string>([teamCode]);
  let reachesFinal = false;
  let winsFinal = false;

  for (const k of sorted) {
    const home = k.home.team!;
    const away = k.away.team!;
    const stage = k.stage as BondStage;
    const [a, b] = bondPair(home, away);
    bonds.push({
      stage,
      a,
      b,
      matchId: k.id,
    });
    atomSet.add(home);
    atomSet.add(away);
    if (stage === "f") {
      reachesFinal = true;
      winsFinal = k.effective_winner === teamCode;
    }
  }

  return {
    teamCode,
    bonds,
    atomCodes: Array.from(atomSet),
    reachesFinal,
    winsFinal,
  };
}

/**
 * Build a lookup-set of bond keys for fast `isOnPath(bond)` checks in the
 * render loop. The key matches the same scheme used in `layout.ts`:
 * `"<stage>:<a>:<b>"` with team codes in lexical order. Only match
 * bonds are included here — for v4's gold staircase advance bonds, see
 * `buildPathAdvanceBondKeySet`.
 */
export function buildPathBondKeySet(path: TeamPath): Set<string> {
  const out = new Set<string>();
  for (const pb of path.bonds) {
    out.add(`${pb.stage}:${pb.a}:${pb.b}`);
  }
  return out;
}

type PathLayer = "group" | "r32" | "r16" | "qf" | "sf" | "f" | "champion";

/**
 * v4 — build a lookup-set of *advance* bond keys for the team's own
 * column rising up the pyramid. These have the form
 * `"<upperLayer>:<team>:<team>"`, matching the legacy `stage:a:b` key
 * scheme that `MoleculeScene` uses for bond lookups. An advance bond is
 * on-path iff its (team, upperLayer) appears in this set.
 *
 * The team reaches a layer L iff the path includes a match bond at L
 * (they played there). The champion additionally reaches layer
 * "champion" at the apex when `winsFinal` is true.
 */
export function buildPathAdvanceBondKeySet(path: TeamPath): Set<string> {
  const out = new Set<string>();
  if (!path.teamCode) return out;
  const layerOrder: PathLayer[] = ["group", "r32", "r16", "qf", "sf", "f", "champion"];
  const reachedLayers = new Set<PathLayer>(["group"]);
  for (const pb of path.bonds) {
    if (pb.stage === "r32" || pb.stage === "r16" || pb.stage === "qf"
      || pb.stage === "sf" || pb.stage === "f") {
      reachedLayers.add(pb.stage);
    }
  }
  if (path.winsFinal) reachedLayers.add("champion");
  for (let i = 0; i < layerOrder.length - 1; i++) {
    const upper = layerOrder[i + 1]!;
    if (reachedLayers.has(upper)) {
      out.add(`${upper}:${path.teamCode}:${path.teamCode}`);
    }
  }
  return out;
}

/**
 * Build a lookup-set of atom codes for fast `isOnPath(node)` checks.
 */
export function buildPathAtomSet(path: TeamPath): Set<string> {
  return new Set(path.atomCodes);
}
