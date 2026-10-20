# 2026-10-17, apps/web vitest suite repair

**Task**: burn round 5, repair the apps/web vitest suite (154 failures in 35 files on main at e1e0eac9).
**Branch**: `fix/web-vitest-suite` (worktree). Test files, two helpers, vitest config and one message key; no component or route code changed.

## Result

Full `vitest run` in apps/web: 406 files, 1196 tests, 1194 passed, 0 failed, 2 skipped. Before: 1213 tests, 154 failed. eslint clean on every changed file.

## What was wrong

- 91 failures: client components call `useTranslations` and no test mounted `NextIntlClientProvider`. Fixed with `__tests__/helpers/render.tsx`, a drop-in for Testing Library whose `render` mounts the English catalogue.
- 14 failures: async server components rendered as React children. `renderAsync()` in the same helper awaits the page first.
- A large share of the bracket failures: tests written in June assumed the tournament was in the future; the builder locks rows once the real clock passes a kickoff. `__tests__/helpers/clock.ts` pins `Date` to 1 May 2026.
- Three timeouts: the 104-row builder needs more than 5 s under jsdom. `testTimeout` is now 20 s.
- The rest: stale copy and selectors after months of product change (tab labels, dock labels, drawer sections, gold selection ring, Pools, auth-sms profile editor), one retired feature (auto-pick, removed 2026-06-28; its tests deleted), and a handful of mocks whose shape no longer matched (useUser, session, fonts for the OG route).

Per-file reasoning is in `apps/web/__tests__/REPAIR-NOTES-2026-10.md`.

## Open product issues (skipped with `// OPEN:`)

1. Lock copy regressed after the Lock to Save rename: `components/bracket/BracketBuilder.tsx` fallback "Lock in your bracket" and two strings on `app/odds/page.tsx`. The pool "Lock entries by country" strings are a different feature and want an allow-list in the guard.
2. The molecule global-prediction bracket stops at the round of 32: `lib/molecule/odds-consensus.ts` never sets best thirds, which the Annex C cascade needs.

## Needs Tim

Review and merge after PRs #335 and #336 (no file overlap; this branch adds the `apps/web/__tests__/helpers/` directory that later test PRs should use). No deploy needed: nothing in the build output changed except the one `en.json` key, which is harmless.
