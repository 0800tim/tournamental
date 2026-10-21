/**
 * Standings computer.
 *
 * Given a set of per-match predictions for a group (a pool, in rugby),
 * compute the predicted table and sort it. The arithmetic is data on the
 * tournament (`sport` or `standings_rules`, see `tournament.ts`):
 *
 *   - Football (the default, and the only rule before 0.3.0): 3-1-0,
 *     then score difference, score for, a head-to-head mini-table among
 *     the tied teams, then the user's tiebreaker pick.
 *   - Rugby union (World Rugby pool rules): 4-2-0 plus a bonus point
 *     for four or more tries and one for losing by seven or fewer; then
 *     the winner of the match between two tied teams, score difference,
 *     tries difference, score for, tries for, world ranking, then the
 *     user's tiebreaker pick.
 *
 * Points are always compared first. Each criterion in the chain only
 * applies to teams still level after the one before it, and once a
 * criterion separates some of a level block the teams still level start
 * the chain again from the first criterion (World Rugby's "the process
 * would repeat, starting at the first criterion"; FIFA re-applies its
 * head-to-head criteria to the remaining subset the same way). So the
 * chain is evaluated as nested blocks, the way the rule books describe it.
 *
 * "Score" is goals in football and match points in rugby. The row
 * fields keep their original `goalsFor` / `goalsAgainst` / `goalDiff`
 * names because a dozen UI and service files read them; a rugby
 * consumer reads them as points for, points against, points
 * difference. Tries have their own fields and are zero for football.
 *
 * Scores and tries only contribute when the user has actually entered
 * them. A blank score is a 0-0 contribution and a blank try count is no
 * tries, the same way the rule book treats "match not yet played". So a
 * group with every outcome picked but no scores ties a lot, and the
 * tiebreaker control becomes the user's lever.
 *
 * Pure / deterministic. No clock reads, no randomness.
 */

import type {
  Group,
  GroupFixture,
  GroupId,
  GroupTiebreaker,
  MatchPrediction,
  PoolPointsRule,
  StandingsRules,
  Team,
  TeamId,
  TiebreakCriterion,
  Tournament,
} from "./tournament.js";

// ---------- public types ----------

export interface GroupStanding {
  readonly teamCode: TeamId;
  readonly played: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  /** Goals for (football) or match points for (rugby). */
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDiff: number;
  /** Tries; always 0 for football. */
  readonly triesFor: number;
  readonly triesAgainst: number;
  readonly tryDiff: number;
  /** Bonus points included in `points`; always 0 for football. */
  readonly bonusPoints: number;
  readonly points: number;
}

/**
 * A tie that the criterion chain couldn't break. The UI surfaces a
 * tiebreaker control for each `TieGroup`. After the user supplies a
 * `GroupTiebreaker`, the standings re-sort using that ranking and the
 * tie disappears.
 */
export interface TieGroup {
  /** Positions (1-indexed) the tied teams occupy in the otherwise-sorted standings. */
  readonly positions: readonly number[];
  readonly teamCodes: readonly TeamId[];
}

// ---------- rule presets ----------

/** FIFA: 3-1-0; goal difference, goals for, head-to-head mini-table. */
export const FOOTBALL_STANDINGS_RULES: StandingsRules = {
  points: { win: 3, draw: 1, loss: 0 },
  tiebreak: ["score_diff", "score_for", "h2h_table"],
};

/**
 * World Rugby pool rules as applied at Rugby World Cup 2023 (Tournament
 * Rules, pool stage) and published for RWC 2027: 4-2-0, a bonus point
 * for four or more tries and one for losing by fewer than eight; ties
 * broken by the winner of the match between the two tied teams, then
 * points difference, tries difference, points scored, tries scored,
 * then the World Rugby ranking (as of 18 October 2027 for RWC 2027).
 * The best third-placed teams are ranked by points difference, points
 * scored, tries scored, then the ranking. A tournament whose chain
 * differs sets `standings_rules` in its data.
 */
export const RUGBY_UNION_STANDINGS_RULES: StandingsRules = {
  points: {
    win: 4,
    draw: 2,
    loss: 0,
    try_bonus: { min_tries: 4, points: 1 },
    losing_bonus: { max_margin: 7, points: 1 },
  },
  tiebreak: ["h2h_winner", "score_diff", "try_diff", "score_for", "try_for", "world_rank"],
  thirds_tiebreak: ["score_diff", "score_for", "try_for", "world_rank"],
};

/**
 * The rules a tournament's pool tables use: an explicit
 * `standings_rules` first, then the preset for its `sport`, then
 * football. Rugby league has no preset here (the IRL chain has not been
 * checked against its regulations), so a rugby league tournament must
 * carry explicit rules.
 */
export function standingsRulesFor(tournament: Pick<Tournament, "sport" | "standings_rules">): StandingsRules {
  if (tournament.standings_rules) return tournament.standings_rules;
  switch (tournament.sport) {
    case undefined:
    case "football":
      return FOOTBALL_STANDINGS_RULES;
    case "rugby_union":
      return RUGBY_UNION_STANDINGS_RULES;
    case "rugby_league":
      throw new Error(
        "standingsRulesFor: a rugby_league tournament must set standings_rules (no preset)",
      );
  }
}

// ---------- helpers ----------

interface MutableStanding {
  teamCode: TeamId;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  triesFor: number;
  triesAgainst: number;
  bonusPoints: number;
}

function blank(teamCode: TeamId): MutableStanding {
  return {
    teamCode,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    triesFor: 0,
    triesAgainst: 0,
    bonusPoints: 0,
  };
}

function freeze(m: MutableStanding, rule: PoolPointsRule): GroupStanding {
  return {
    teamCode: m.teamCode,
    played: m.played,
    wins: m.wins,
    draws: m.draws,
    losses: m.losses,
    goalsFor: m.goalsFor,
    goalsAgainst: m.goalsAgainst,
    goalDiff: m.goalsFor - m.goalsAgainst,
    triesFor: m.triesFor,
    triesAgainst: m.triesAgainst,
    tryDiff: m.triesFor - m.triesAgainst,
    bonusPoints: m.bonusPoints,
    points: rule.win * m.wins + rule.draw * m.draws + rule.loss * m.losses + m.bonusPoints,
  };
}

function fixtureMatchId(f: GroupFixture): string {
  return String(f.match_no);
}

function teamForIdx(group: Group, idx: number): TeamId {
  return group.team_ids[idx] as TeamId;
}

/**
 * Apply one prediction to the running mutable standings. Outcome and
 * (optional) scores and tries all contribute. If scores are absent, the
 * match counts but contributes 0 for / 0 against and no losing bonus; if
 * tries are absent there is no try bonus.
 */
function applyPrediction(
  prediction: MatchPrediction,
  homeCode: TeamId,
  awayCode: TeamId,
  byCode: Map<TeamId, MutableStanding>,
  rule: PoolPointsRule,
): void {
  const home = byCode.get(homeCode);
  const away = byCode.get(awayCode);
  if (!home || !away) return;
  home.played += 1;
  away.played += 1;

  // Score counters: only when explicit scores are present.
  const hs = prediction.homeScore;
  const as = prediction.awayScore;
  const hasScores = typeof hs === "number" && typeof as === "number";
  if (hasScores) {
    home.goalsFor += hs;
    home.goalsAgainst += as;
    away.goalsFor += as;
    away.goalsAgainst += hs;
  }

  // Try counters: only when explicit try counts are present.
  const ht = prediction.homeTries;
  const at = prediction.awayTries;
  const hasTries = typeof ht === "number" && typeof at === "number";
  if (hasTries) {
    home.triesFor += ht;
    home.triesAgainst += at;
    away.triesFor += at;
    away.triesAgainst += ht;
    if (rule.try_bonus) {
      if (ht >= rule.try_bonus.min_tries) home.bonusPoints += rule.try_bonus.points;
      if (at >= rule.try_bonus.min_tries) away.bonusPoints += rule.try_bonus.points;
    }
  }

  switch (prediction.outcome) {
    case "home_win":
      home.wins += 1;
      away.losses += 1;
      if (hasScores && rule.losing_bonus && Math.abs(hs - as) <= rule.losing_bonus.max_margin) {
        away.bonusPoints += rule.losing_bonus.points;
      }
      return;
    case "away_win":
      home.losses += 1;
      away.wins += 1;
      if (hasScores && rule.losing_bonus && Math.abs(hs - as) <= rule.losing_bonus.max_margin) {
        home.bonusPoints += rule.losing_bonus.points;
      }
      return;
    case "draw":
      home.draws += 1;
      away.draws += 1;
      return;
  }
}

// ---------- core ----------

/**
 * Compute the standings for one group, applying each predicted match in
 * order. `fixtures` is the list of all group_fixtures from the tournament;
 * we filter to this group internally so callers can pass the whole list.
 *
 * Sort uses the tournament's rules (points, then its tiebreak chain).
 * Ties that survive the chain are returned alongside via
 * `detectTiesNeedingTiebreaker`. If the caller supplies a tiebreaker,
 * ties are resolved using `rankedTeams` as the final tiebreaker.
 */
export function computeGroupStandings(
  groupId: GroupId,
  tournament: Tournament,
  predictions: Record<string, MatchPrediction>,
  tiebreaker?: GroupTiebreaker,
): readonly GroupStanding[] {
  const ctx = contextFor(groupId, tournament, predictions, tiebreaker);
  if (!ctx) return [];
  return rankGroup(ctx).order;
}

interface RankContext {
  readonly group: Group;
  readonly fixtures: readonly GroupFixture[];
  readonly predictions: Record<string, MatchPrediction>;
  readonly teams: ReadonlyMap<TeamId, Team>;
  readonly rules: StandingsRules;
  readonly tiebreaker?: GroupTiebreaker;
}

function contextFor(
  groupId: GroupId,
  tournament: Tournament,
  predictions: Record<string, MatchPrediction>,
  tiebreaker?: GroupTiebreaker,
): RankContext | null {
  const group = tournament.groups.find((g) => g.id === groupId);
  if (!group) return null;
  return {
    group,
    fixtures: tournament.group_fixtures.filter((f) => f.group_id === groupId),
    predictions,
    teams: new Map(tournament.teams.map((t) => [t.id, t])),
    rules: standingsRulesFor(tournament),
    tiebreaker,
  };
}

interface Ranked {
  readonly order: readonly GroupStanding[];
  /** Blocks the chain and the user's tiebreaker could not separate. */
  readonly ties: readonly (readonly TeamId[])[];
}

function rankGroup(ctx: RankContext): Ranked {
  const byCode = new Map<TeamId, MutableStanding>();
  for (const t of ctx.group.team_ids) byCode.set(t, blank(t));
  for (const f of ctx.fixtures) {
    const pred = ctx.predictions[fixtureMatchId(f)];
    if (!pred) continue;
    applyPrediction(pred, teamForIdx(ctx.group, f.home_idx), teamForIdx(ctx.group, f.away_idx), byCode, ctx.rules.points);
  }
  const standings = ctx.group.team_ids.map((t) => freeze(byCode.get(t)!, ctx.rules.points));

  // Points first, always. Then the chain on each block still level.
  const byPoints = [...standings].sort((a, b) => b.points - a.points);
  const order: GroupStanding[] = [];
  const ties: (readonly TeamId[])[] = [];
  for (const block of runs(byPoints, (s) => [s.points])) {
    const r = rankBlock(block, ctx, 0);
    order.push(...r.order);
    ties.push(...r.ties);
  }
  return { order, ties };
}

/**
 * Apply criterion `depth` of the chain to a block of teams that are
 * level on everything before it. If the criterion separates the block,
 * each smaller block still level starts again at the first criterion;
 * if it separates nothing, the whole block moves to the next one. The
 * end of the chain is the user's pick.
 */
function rankBlock(block: readonly GroupStanding[], ctx: RankContext, depth: number): Ranked {
  if (block.length <= 1) return { order: block, ties: [] };
  const criterion = ctx.rules.tiebreak[depth];
  if (criterion === undefined) return resolveByTiebreaker(block, ctx.tiebreaker);

  const keys = keysFor(criterion, block, ctx);
  const sorted = [...block].sort((a, b) => compareKeys(keys.get(b.teamCode)!, keys.get(a.teamCode)!));
  const blocks = runs(sorted, (s) => keys.get(s.teamCode)!);
  if (blocks.length === 1) return rankBlock(block, ctx, depth + 1);
  const order: GroupStanding[] = [];
  const ties: (readonly TeamId[])[] = [];
  for (const sub of blocks) {
    const r = rankBlock(sub, ctx, 0);
    order.push(...r.order);
    ties.push(...r.ties);
  }
  return { order, ties };
}

/** Split an already-sorted list into maximal runs with equal keys. */
function runs<T>(sorted: readonly T[], key: (t: T) => readonly number[]): T[][] {
  const out: T[][] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && compareKeys(key(sorted[i]!), key(sorted[j]!)) === 0) j++;
    out.push(sorted.slice(i, j));
    i = j;
  }
  return out;
}

/** Lexicographic compare; higher is better everywhere in the chain. */
function compareKeys(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The sort key of each tied team under one criterion. Keys are arrays so
 * a criterion can be composite (the head-to-head mini-table is points,
 * then difference, then for). A criterion that cannot tell the teams
 * apart gives them all the same key and the chain moves on.
 */
function keysFor(
  criterion: TiebreakCriterion,
  block: readonly GroupStanding[],
  ctx: RankContext,
): Map<TeamId, readonly number[]> {
  const keys = new Map<TeamId, readonly number[]>();
  switch (criterion) {
    case "score_diff":
      for (const s of block) keys.set(s.teamCode, [s.goalDiff]);
      return keys;
    case "score_for":
      for (const s of block) keys.set(s.teamCode, [s.goalsFor]);
      return keys;
    case "try_diff":
      for (const s of block) keys.set(s.teamCode, [s.tryDiff]);
      return keys;
    case "try_for":
      for (const s of block) keys.set(s.teamCode, [s.triesFor]);
      return keys;
    case "world_rank":
      for (const s of block) {
        const team = ctx.teams.get(s.teamCode);
        const rank = team?.world_rank ?? team?.fifa_rank;
        // Lower rank is better, so negate; a team with no ranking sorts last.
        keys.set(s.teamCode, [typeof rank === "number" ? -rank : Number.NEGATIVE_INFINITY]);
      }
      return keys;
    case "h2h_winner": {
      // Only decides a tie between exactly two teams: the one that won
      // the match between them. A drawn or unpredicted match decides
      // nothing, and three or more tied teams move to the next criterion.
      for (const s of block) keys.set(s.teamCode, [0]);
      if (block.length !== 2) return keys;
      const [a, b] = [block[0]!.teamCode, block[1]!.teamCode];
      for (const f of ctx.fixtures) {
        const home = teamForIdx(ctx.group, f.home_idx);
        const away = teamForIdx(ctx.group, f.away_idx);
        const between = (home === a && away === b) || (home === b && away === a);
        if (!between) continue;
        const pred = ctx.predictions[fixtureMatchId(f)];
        if (!pred || pred.outcome === "draw") continue;
        const winner = pred.outcome === "home_win" ? home : away;
        keys.set(winner, [keys.get(winner)![0]! + 1]);
      }
      return keys;
    }
    case "h2h_table": {
      // Mini-table replaying only the matches between the tied teams,
      // ordered by points, score difference, score for.
      const tied = new Set(block.map((s) => s.teamCode));
      const mini = new Map<TeamId, MutableStanding>();
      for (const s of block) mini.set(s.teamCode, blank(s.teamCode));
      for (const f of ctx.fixtures) {
        const home = teamForIdx(ctx.group, f.home_idx);
        const away = teamForIdx(ctx.group, f.away_idx);
        if (!tied.has(home) || !tied.has(away)) continue;
        const pred = ctx.predictions[fixtureMatchId(f)];
        if (!pred) continue;
        applyPrediction(pred, home, away, mini, ctx.rules.points);
      }
      for (const s of block) {
        const m = freeze(mini.get(s.teamCode)!, ctx.rules.points);
        keys.set(s.teamCode, [m.points, m.goalDiff, m.goalsFor]);
      }
      return keys;
    }
  }
}

/**
 * End of the chain: the user's tiebreaker pick, else alphabetical. The
 * alphabetical fallback keeps the sort total (no throws, no null rows);
 * the block is reported as a tie unless the pick ranks every team in it
 * distinctly, so the UI can surface the control.
 */
function resolveByTiebreaker(block: readonly GroupStanding[], tiebreaker?: GroupTiebreaker): Ranked {
  const codes = block.map((s) => s.teamCode);
  const byCode = new Map(block.map((s) => [s.teamCode, s] as const));
  if (!tiebreaker) {
    const alphabetical = [...codes].sort();
    return { order: alphabetical.map((c) => byCode.get(c)!), ties: [alphabetical] };
  }
  const ranked = tiebreaker.rankedTeams;
  const ix = (c: TeamId): number => {
    const i = ranked.indexOf(c);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const order = [...codes].sort((a, b) => ix(a) - ix(b));
  const ranks = codes.map(ix);
  const resolved =
    ranks.every((r) => r !== Number.MAX_SAFE_INTEGER) && new Set(ranks).size === ranks.length;
  return { order: order.map((c) => byCode.get(c)!), ties: resolved ? [] : [order] };
}

/**
 * Identify ties that survived the tiebreak chain. The UI uses this to
 * surface a tiebreaker control. If `tiebreaker` was applied during sort,
 * those teams won't appear here.
 *
 * With tournament context (tournament, groupId, predictions) the chain
 * is re-run so only genuine ties are reported. Without it, every run of
 * adjacent rows level on points, score difference and score for is
 * reported, which over-reports for chains with further criteria.
 */
export function detectTiesNeedingTiebreaker(
  standings: readonly GroupStanding[],
  options?: {
    readonly tournament?: Tournament;
    readonly groupId?: GroupId;
    readonly predictions?: Record<string, MatchPrediction>;
    readonly tiebreaker?: GroupTiebreaker;
  },
): readonly TieGroup[] {
  if (options?.tournament && options.groupId && options.predictions) {
    const ctx = contextFor(options.groupId, options.tournament, options.predictions, options.tiebreaker);
    if (ctx) {
      const out: TieGroup[] = [];
      for (const tie of rankGroup(ctx).ties) {
        const positions: number[] = [];
        for (const c of tie) {
          const pos = standings.findIndex((s) => s.teamCode === c);
          if (pos !== -1) positions.push(pos + 1);
        }
        out.push({ positions: positions.sort((a, b) => a - b), teamCodes: tie });
      }
      return out;
    }
  }

  // No tournament context: every primary-metric tie is reported.
  const out: TieGroup[] = [];
  const primary = (s: GroupStanding): readonly number[] => [s.points, s.goalDiff, s.goalsFor];
  let i = 0;
  while (i < standings.length) {
    let j = i + 1;
    while (j < standings.length && compareKeys(primary(standings[i]!), primary(standings[j]!)) === 0) j++;
    if (j - i > 1) {
      const positions: number[] = [];
      for (let k = i; k < j; k++) positions.push(k + 1);
      out.push({ positions, teamCodes: standings.slice(i, j).map((s) => s.teamCode) });
    }
    i = j;
  }
  return out;
}

/**
 * Comparator for ranking rows from different groups against each other
 * (the best third-placed teams): points, then `rules.thirds_tiebreak`,
 * or the pool chain without its head-to-head criteria, which cannot
 * apply across groups. Returns a negative number when `a` ranks higher.
 * Pass `teams` when the chain includes `world_rank`.
 */
export function compareStandingsAcrossGroups(
  rules: StandingsRules,
  teams?: readonly Team[],
): (a: GroupStanding, b: GroupStanding) => number {
  const byId = new Map((teams ?? []).map((t) => [t.id, t]));
  const chain = rules.thirds_tiebreak ?? rules.tiebreak;
  const key = (s: GroupStanding): readonly number[] => {
    const k: number[] = [s.points];
    for (const c of chain) {
      switch (c) {
        case "score_diff":
          k.push(s.goalDiff);
          break;
        case "score_for":
          k.push(s.goalsFor);
          break;
        case "try_diff":
          k.push(s.tryDiff);
          break;
        case "try_for":
          k.push(s.triesFor);
          break;
        case "world_rank": {
          const t = byId.get(s.teamCode);
          const rank = t?.world_rank ?? t?.fifa_rank;
          k.push(typeof rank === "number" ? -rank : Number.NEGATIVE_INFINITY);
          break;
        }
        case "h2h_winner":
        case "h2h_table":
          break;
      }
    }
    return k;
  };
  return (a, b) => compareKeys(key(b), key(a));
}

/**
 * Convenience: are all group-stage matches in this group predicted?
 * Used by the UI to decide whether the standings panel is "complete" or a
 * partial/preview state.
 */
export function isGroupComplete(
  groupId: GroupId,
  tournament: Tournament,
  predictions: Record<string, MatchPrediction>,
): boolean {
  const groupFixtures = tournament.group_fixtures.filter((f) => f.group_id === groupId);
  return groupFixtures.every((f) => predictions[fixtureMatchId(f)] !== undefined);
}
