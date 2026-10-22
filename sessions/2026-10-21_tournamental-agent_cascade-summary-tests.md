# 2026-10-21 · Tests for the share-page summariser

status: done

`apps/game/src/routes/bracket-cascade-summary.ts` (champion, runner-up,
bronze and the champion's path on the public share landing) had two
real bugs in its history and no direct tests; `bracket-by-guid.test.ts`
only checks the champion code through the route. New
`tests/bracket-cascade-summary.test.ts` drives the real 2026 fixtures:
a complete bracket resolves every knockout and names all three medals
with a five-win path; an incomplete group leaves the final unresolved
and an unknown match id is ignored; the multi-pass resolver is
deterministic; an unpicked third-place play-off leaves bronze null.
6 tests pass; game typecheck clean. Nothing merged or deployed.
