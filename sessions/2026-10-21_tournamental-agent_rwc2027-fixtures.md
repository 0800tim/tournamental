# 2026-10-21 · RWC 2027 fixtures in the bracket engine

status: done
docs: docs/design/rwc2027-engine-readiness.md (gaps 3 and 6, first half)
stacked on: feat/engine-rugby-standings (PR #366)

## Plan

Step 1 of the readiness note's order of work: the data package
skeleton the rest of the rugby work tests against. 24 teams, 36 pool
matches, 16 knockouts, the round of 16 permutation table, a loader
keyed by tournament id, and a cascade test from pool picks to the final.

## Sources and checks

- Pools, dates, local kickoff times and venues: World Rugby's published
  schedule as transcribed on the English Wikipedia tournament and pool
  pages, then every one of the 52 matches checked (date, UTC kickoff,
  venue, slot labels) against the official list at
  rugbyworldcup.com/2027/en/matches (via the local Firecrawl). Zero
  differences. The two Pool C dates that differ between the Wikipedia
  tournament page and its Pool C page are resolved in favour of the
  official list (4 and 16 October).
- Pool tiebreak chain and bonus points: the tournament page's rules
  text, which the engine preset now matches, including the restart of
  the chain for teams still level and the 18 October 2027 ranking date.
- Round of 16 permutations: the tournament page's table; the test
  checks every row against the bracket constraints and that the four
  assigned pools are the four that qualified.

## Decisions

- Team ids: FIFA-style trigrams shared with the flag assets (ROU, TGA,
  FIJ, CHI, HKG), `IRE` for the all-island union. Eleven flags missing.
- `fifa_rank` and `world_rank` both hold the 1 December 2025 ranking so
  the dozen `fifa_rank` readers keep working until gap 5 renames them.
- `pre_tournament_implied_win` values are rough estimates and say so in
  `_meta`; replace with market odds before picks open.
- Match numbers are chronological (1 to 36) then knockout order, not
  World Rugby's numbering. The final's id is `final`, as in 2026.
- The cascade's Annex C path reads `advancement.wildcard_third` (4)
  instead of the FIFA constant 8.

## Outcome

- `packages/bracket-engine`: 121 tests pass (10 new in
  `test/fixtures-rwc-2027.test.ts`), tsc clean, generator output is
  byte-deterministic.

## Needs Tim

- Approve the team id convention and commission the eleven flags.
- Market odds for `pre_tournament_implied_win`; a ranking refresh on
  18 October 2027.
- The rugby-league fixture drafts: commit or drop.
