# RWC 2027 engine readiness

> Design note, 2026-10-20, no code. What Rugby World Cup 2027 needs from the bracket engine, the game service and the data layer that FIFA World Cup 2026 did not, read from `packages/bracket-engine/src` (`tournament.ts`, `standings.ts`, `score.ts`, `cascade.ts`), the picks and settlement routes in `apps/game`, `apps/wc2026-data`, and the rugby-union entry in `apps/web/lib/tournaments/registry.ts`. Each gap is sized S (hours), M (days) or L (a week or more). Growth and prize material is not here; it lives in the gitignored `docs/internal/`.

## The format, in the engine's words

RWC 2027 (registry: 24 teams, 52 matches, Australia, 1 October to 13 November 2027): six pools of four, 36 pool matches; the top two of each pool plus the four best third-placed teams go to a round of 16 (8 matches), then quarter-finals (4), semi-finals (2), a bronze final and the final. In the engine's vocabulary that is `groups` of four with `advancement.automatic_per_group = 2` and `wildcard_third = 4`, knockouts starting at stage `r16` with `group_position` and `best_third` (or a lookup-table) slots, and `tp` for the bronze final. The shape fits; the arithmetic inside the pools, the tiebreakers and the data do not.

## What already carries over

- **Stages.** `StageId` is `group | r32 | r16 | qf | sf | tp | f`. RWC uses all but `r32`; the bronze final is `tp`. `STAGE_MULTIPLIERS` and `BASE_POINTS` in `score.ts` already key on these, and the archive page's stage order from PR #343 does too.
- **Slot sources.** `KnockoutFixture` slots already express "winner of pool A", "runner-up of pool B", "best third ranked N from these pools", "winner of match X" and "loser of match X". The cascade resolves them with the player's `best_thirds` list when the pools are not settled and with actual standings when they are.
- **Knockout outcomes.** `apps/game/src/routes/picks.ts` already refuses `draw` on knockout stages (`outcome_not_allowed_for_stage`); rugby knockouts cannot end level either (extra time, sudden death, kicks), so the rule holds.
- **Team ids.** `TeamId` is a string; the 2026 fixtures already use football's trigrams, including `ENG` and `SCO` for unions with no ISO alpha-3 code, and the flags under `apps/web/public/flags/<code>.svg` are keyed the same way. Rugby's World Rugby codes are the same style (`ENG`, `SCO`, `WAL`, `IRE`, `TGA`, `FJI`, `SAM`, `GEO`, `JPN`, `ARG`, `RSA`, `NZL`, `AUS`, `FRA`).
- **Settlement.** `apps/wc2026-data/src/settlement-bridge.ts` posts home score, away score and winner to `POST /v1/match/:id/result`; nothing in it is football-specific. The game service's `matchResultBodySchema` takes `outcome`, scores, winner and stage.
- **Fixture JSON.** The untracked drafts in `packages/bracket-engine/data/rugby-league/` (RLWC 2026 women's and wheelchair) show the same `Tournament` JSON holding a two-pool rugby competition with `sf` and `f` only. They are evidence the shape generalises; they are not on `main`.

## The gaps

### 1. Pool table arithmetic: 4-2-0 with bonus points (M)

> **Done 2026-10-21** on `feat/engine-rugby-standings`: `Tournament.sport` and `standings_rules`, `MatchPrediction.homeTries` / `awayTries`, bonus points computed only when the inputs are present, `GroupStanding.bonusPoints` for the "with bonus points" label. The game service's pick and result schemas accept the try counts. The prediction UI does not ask for tries yet (gap 6, second half).

`standings.ts` computes `points: 3 * m.wins + m.draws` and tracks goals for and against. Rugby's pool table is 4 for a win, 2 for a draw, 0 for a loss, plus 1 bonus point for scoring four or more tries and 1 for losing by seven or fewer points. Two things are missing:

- a per-sport points rule: `{ win: 4, draw: 2, loss: 0 }` against football's `{ 3, 1, 0 }`, carried on the `Tournament` (a `scoring` or `sport` field) rather than hard-coded;
- the inputs the bonuses need. `MatchPrediction` carries `outcome` and optional `homeScore` and `awayScore`; the losing bonus can be derived from the scores when a player enters them (margin of seven or fewer), but the try bonus needs try counts (`homeTries`, `awayTries`) or a coarser per-pick flag ("four tries", yes or no) that a prediction UI can ask for. Without any of it, a predicted pool table is 4-2-0 only, which is wrong often enough to matter (bonus points decide pool places most tournaments).

Recommendation: add `tries` alongside `score` as optional prediction fields, compute both bonuses only when the inputs are present (the same stance the engine takes with goal counts today), and surface "with bonus points" in the standings panel so players know when it is being applied. The actual results path gets tries from the live provider (gap 7).

### 2. Rugby tiebreakers (M)

> **Done 2026-10-21** on the same branch: the chain is an ordered list of criteria on the tournament, each implemented once in `standings.ts`; `RUGBY_UNION_STANDINGS_RULES` carries the RWC 2023 chain and `Team.world_rank` (optional, `ranked_at` alongside) feeds the last criterion. `compareStandingsAcrossGroups` ranks thirds by the same rules for gap 3. Still to confirm: the published RWC 2027 regulations, which were not found online on 2026-10-21; if the chain differs, the tournament data sets `standings_rules` and no code changes.

The engine sorts points, then goal difference, then goals for, then head-to-head between tied teams, then the player's tiebreaker pick (`standings.ts`, `sortStandings` and `resolveBlock`). World Rugby's pool tiebreak for two tied teams is the winner of the match between them first, then points difference, then tries difference, then points scored, then tries scored, then World Rugby ranking at a fixed date; for three or more tied teams the same chain applies across the matches between them before falling back to the whole pool. The order differs from football's and it needs tries and a ranking date.

Recommendation: make the tiebreak chain data on the `Tournament` (an ordered list of criteria names) and implement each criterion once; the player's tiebreaker pick stays the last resort, as it is now. `Team.fifa_rank` becomes `world_rank` with a `ranked_at` date so the last criterion can be real.

### 3. Round of 16 from six pools (S to M)

> **Done 2026-10-21** on `feat/rwc-2027-fixtures`: World Rugby fixes the round of 16 by the combination of pools whose thirds qualify (fifteen rows, published with the schedule), so the data carries the table as `annex_c_assignments` and the four R16 slots are `annex_c_third` slots. The cascade now takes the thirds count from `advancement.wildcard_third` instead of FIFA's eight. `compareStandingsAcrossGroups` ranks thirds by the rugby chain (points difference, points scored, tries scored, ranking of 18 October 2027) but is not wired yet: `ThirdsPicker.tsx` and `browser-swarm/cascade.ts` still rank thirds by the football order, which drops tries scored for rugby (gap 6, second half).

`advancement.wildcard_third = 4` and `best_third` slots already express "the four best thirds". The question is how World Rugby places them. If the regulations fix the R16 bracket by the qualifying pools' combination (as FIFA's Annex C does), the engine's `annex_c_assignments` table and `annex_c_third` slot kind handle it with a new, much smaller table (the combinations of four pools out of six). If the regulations simply rank the four thirds and slot them by rank, the existing `best_third` slot with `rank` and `eligible_groups` is enough and the only work is ranking thirds by the rugby criteria (gap 2 applies: points, then points difference, then tries, then ranking). Either way the eight R16 fixtures, their kickoffs and venues come from the data package (gap 6). Confirm which rule applies from the published competition regulations before building.

### 4. Knockout draws and the bronze final (S)

`tp` exists and `cascade.ts` resolves `knockout_loser` slots, so the bronze final is already expressible. Rugby knockouts resolve a level score by extra time, sudden death, then a kicking competition; the engine records `winner` and optional `method`, and `KnockoutResultRow.method` already allows `et` and `pens`. Add a `kicks` method label for the archive and match pages; nothing structural. The settlement schema's `stage` enum lacks `tp` (noted in the code review of PR #343), so a bronze final cannot be settled with its stage today: one-line fix.

### 5. Team ids, rankings and flags (S)

Keep the string ids and use World Rugby codes. Three details: `IRE` (rugby) is not `IRL` (football), and the flag is the IRFU flag, not the tricolour, so `apps/web/public/flags/IRE.svg` is a new asset; `TGA` and `FJI` need flags checked against what the 2026 set holds; the `Team` type's `fifa_rank` is read in a dozen places (`odds-consensus.ts`, auto-rank tiebreakers, the thirds picker) and should become `world_rank`. A canonical `teams.json` for the 24 unions with code, name, flag emoji, rank and a `union` field replaces `data/fifa-wc-2026/teams.json`.

### 6. A data package in place of `apps/wc2026-data` (L)

> **First half done 2026-10-21** on `feat/rwc-2027-fixtures`: `packages/bracket-engine/data/rwc-2027-fixtures.json` (24 teams with the 1 December 2025 ranking, 36 pool matches and 16 knockouts with UTC kickoffs and venues, checked against the official match list), generated by `scripts/generate-fixtures-rwc-2027.mjs`, loaded by `loadFixturesRwc2027()` or `loadFixtures("rwc-2027")`. Still to do: the 35 call sites that import `loadFixtures2026()` or the 2026 teams JSON, the flags (eleven of the 24 unions have none), market odds in place of the estimated `pre_tournament_implied_win`, and the rugby route family.

`apps/wc2026-data` is a Python scraper for FIFA's schedule pages that emits `data/fifa-wc-2026/{fixtures,teams,players,host-cities}.json`, and `packages/bracket-engine/src/fixtures-loader.ts` exposes one function, `loadFixtures2026()`, that reads that one file. Thirty-five files in `apps/web` import it or the teams JSON directly, the game service builds its kickoff registry from it, and `apps/web/app/world-cup-2026/**` is the only route family. RWC 2027 needs:

- `data/rwc-2027/` with the 52 fixtures (pools, kickoffs in UTC with the Australian venues' zones noted, venues, slot sources for the R16), the 24 teams, the R16 placement table from gap 3, host cities, and `_meta.json` with sources and licence;
- a loader keyed by tournament id, `loadFixtures(tournamentId)`, with `loadFixtures2026()` kept as an alias while the 35 call sites move to the registry's current tournament (the chrome work in PR #357 gives them `routeBase` and `code`; the data should follow the same path);
- a scraper or hand-built source for World Rugby's schedule (their site is a JavaScript app; the match schedule is published as a PDF and on the site), with the same byte-deterministic output rule the 2026 package has;
- the rugby route family (`/rwc-2027/**`) the design note in PR #346 assumes, which is the bracket builder parameterised by the tournament: tabs from the tournament's stages (pool stage, R16, QF, SF, bronze, final), group cards for six pools, no round-of-32 grid, counts from the data (36 and 16, not 72 and 32). `BracketBuilder.tsx` and its neighbours carry the 2026 numbers in many places; this is the largest single item and belongs with the data package because both are "make the app read the tournament it is given".

### 7. Live results for rugby (M)

The 2026 live providers (`apps/wc2026-data/src/live/apifootball-provider.ts`, `sportradar-provider.ts`) are football feeds; API-Football has no rugby. Sportradar has a rugby union API, and ESPN's public scoreboard carries Rugby World Cup matches with scores and, in most feeds, try counts, which gap 1 needs. The settlement bridge stays as it is; a rugby provider that emits the same snapshot shape plus tries is the work. The results poller script that settles via the game service also sends `stage`, so gap 4's enum fix matters here.

### 8. Scoring model review (S, product call)

`score.ts` pays 50 for a pool outcome and 200 for an exact score, with stage multipliers up to 3.0 for the final. Exact rugby scores are rarely predicted; a margin band (win by 1 to 7, 8 to 14, 15 or more) is the natural rugby equivalent and would also feed the losing-bonus rule. This is a product decision, not an engine gap; the engine's `ScoreBreakdown` can take a new multiplier line without restructuring.

## Order of work

1. Data package skeleton for `data/rwc-2027/` with the 24 teams and the 52 fixtures as published, plus the loader keyed by tournament id (gap 6, first half). Everything else tests against it.
2. Per-sport points rule and the tries fields, with the bonus-point computation (gap 1), then the rugby tiebreak chain (gap 2). Both are pure functions with fixture tests, like the 2026 standings tests.
3. R16 placement per the regulations (gap 3), `tp` in the settlement enum and the `kicks` method (gap 4), `world_rank` and the three flags (gap 5).
4. The rugby route family and the parameterised bracket builder (gap 6, second half), which is where the chrome work in PR #357 and the design note in PR #346 meet the data.
5. A rugby live provider and a settlement rehearsal against the game service (gap 7).
6. The scoring model decision (gap 8), which can land any time before picks open.

Sizes add up to roughly three to four weeks of agent work with the bracket builder the long pole, before any marketing, pool or prize work. Steps 1 to 3 need no product decisions beyond confirming the R16 rule from the regulations; step 4 needs the route base confirmed (`/rwc-2027` in PR #357) and step 6 needs Tim.

## Needs Tim

The R16 placement rule is settled (fixed by pool combination, published with the schedule) and the pool tiebreak chain is in the data; what remains: decide the scoring model for rugby (exact score or margin bands); choose the live provider (Sportradar paid, ESPN public); say whether the untracked rugby-league fixture drafts should be committed now that the 2027 fixtures are the first non-football data the engine tests run against; approve the team id convention (FIFA-style trigrams shared with the flag assets, `IRE` for Ireland) and commission the eleven missing flags (CHI, HKG, ITA, GEO, ROU, FIJ, IRE, WAL, TGA, ZIM, SAM).
