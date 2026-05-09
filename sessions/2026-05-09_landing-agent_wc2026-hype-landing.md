# 2026-05-09 — wc2026 hype landing page

**Agent**: landing builder
**Branch**: `feat/wc2026-hype-landing` (rebased onto `origin/main`
including PR #40 TeamFlag, #41 rebrand, #42 /match redirect, #43
per-match predictions, #44 spec-client fix)
**Status**: ready-for-review

## Task

Tim asked for a host-aware hype/marketing landing page at `2026wc.vtourn.com/`
(and `wc2026.vtourn.com/`) covering the 2026 FIFA World Cup. Tournament starts
2026-06-11 — 33 days from today (2026-05-09). Must NOT replace
`/world-cup-2026` (the existing bracket builder).

Refs:
- task brief in agent prompt
- `docs/30-gamification-and-affiliate-spine.md`
- `docs/27-social-distribution-strategy.md`
- `docs/26-platform-strategy-and-syndicates.md`
- `data/fifa-wc-2026/teams.json` (48 teams)
- `data/fifa-wc-2026/fixtures.json` (104 matches)
- `apps/web/components/bracket/TeamFlag.tsx` (the flag-with-sparkle)

## What landed

1. New route `apps/web/app/world-cup-2026/landing/page.tsx` with 10
   sections — hero (with countdown + animated 48-flag background), live
   dashboard preview, 12-group teams grid (clickable team-detail drawer),
   how-it-works (3 steps + early-lock multiplier decay graphic),
   syndicate pre-signup form (3 kinds: friends/office/public), 4-tab
   leaderboards preview, first-12-matches schedule with `.ics` download
   per match, per-group winner-probability charts (synthetic from FIFA
   rank, labelled), open-source callout, full footer.
2. Extended `apps/web/middleware.ts` (which already redirected `/match/*`
   on the WC subdomains per PR #42) with an apex `/` rewrite that points
   `https://2026wc.vtourn.com/` and `https://wc2026.vtourn.com/` at the
   new landing while keeping `/world-cup-2026` (the bracket builder)
   untouched.
3. New API route `apps/web/app/api/syndicate/intent/route.ts` validates
   the form payload and writes one JSON file per signup under
   `data/pre-signups/` (gitignored) until `apps/api` ships.
4. Pure-CSS styling in `apps/web/app/world-cup-2026/landing/landing.css`.
   Dark ink + amber/emerald/flame palette matching
   `apps/marketing/tailwind.config.mjs`. All animations
   `prefers-reduced-motion` aware.
5. Tests:
   - Vitest: 20 new tests across `wc2026-landing.countdown.test.ts` and
     `wc2026-landing.groups.test.ts` covering countdown math + 12-group
     assembly + first-12 chronological matches + the synthetic group
     probabilities. Total vitest 88/88 pass.
   - Playwright e2e: `wc2026-landing.e2e.spec.ts` (7 tests covering 48
     flags, countdown positive, syndicate form 200, host-aware rewrite
     for `2026wc.vtourn.com` + `wc2026.vtourn.com`, other hosts pass
     through, bracket builder unaffected) and `wc2026-screenshots.e2e.spec.ts`
     (6 screenshots + an LCP/bundle measurement). Total e2e 16/16 pass.
6. Copy templates in `prompts/social/wc2026-launch-hype.md` for X /
   Threads / LinkedIn / Telegram / Discord launch + daily-countdown +
   early-lock-nudge.

## Performance

Captured via the `wc2026-screenshots.e2e.spec.ts` perf test against
`pnpm dev` on chromium @ 1440×900:

- LCP: **968 ms** (budget: < 2.5s) ✓
- Nav-to-networkidle: 1594 ms
- 55 responses, dev-mode total ~8 MB. Production gzipped budget < 250 KB
  JS will need re-measuring after a `next build` — the workspace's
  pre-existing pnpm/React duplicate causes the build to fail today
  (independent of this branch); flagged in the PR description so Tim
  can pick the fix up separately.

## Open items / deferred

- **Live odds** (Polymarket) — placeholders behind `<DataPlaceholder>`
  chips, deterministic synthetic data from FIFA rank for now. Wires up
  once docs/29 lands.
- **Real leaderboards** — preview rendering is sample data. Will swap to
  the live `/v1/leaderboards` feed once the game-service ships.
- **`pnpm build`** fails on this workspace today (pre-existing pnpm
  React-duplicate issue, reproducible on `origin/main` with `apps/web`
  unmodified). Dev mode + middleware + e2e all green. Production build
  fix is out of scope for this branch.
- **Pre-signup migration**: when `apps/api` ships, swap the
  `app/api/syndicate/intent/route.ts` write-to-disk for a `fetch` to
  the API and replay any captured JSON files (one-shot script).

## Files added / changed

```
apps/web/app/world-cup-2026/landing/page.tsx               NEW
apps/web/app/world-cup-2026/landing/landing.css            NEW
apps/web/app/world-cup-2026/landing/_lib/countdown.ts      NEW
apps/web/app/world-cup-2026/landing/_lib/groups.ts         NEW
apps/web/app/world-cup-2026/landing/_components/Countdown.tsx           NEW
apps/web/app/world-cup-2026/landing/_components/HeroFlagGrid.tsx        NEW
apps/web/app/world-cup-2026/landing/_components/TeamGroupGrid.tsx       NEW
apps/web/app/world-cup-2026/landing/_components/HowItWorks.tsx          NEW
apps/web/app/world-cup-2026/landing/_components/SyndicateSignup.tsx     NEW
apps/web/app/world-cup-2026/landing/_components/LeaderboardPreview.tsx  NEW
apps/web/app/world-cup-2026/landing/_components/UpcomingMatches.tsx     NEW
apps/web/app/world-cup-2026/landing/_components/GroupCharts.tsx         NEW
apps/web/app/world-cup-2026/landing/_components/OpenSourceCallout.tsx   NEW
apps/web/app/world-cup-2026/landing/_components/DataPlaceholder.tsx     NEW
apps/web/app/api/syndicate/intent/route.ts                 NEW
apps/web/middleware.ts                                     MOD (apex rewrite added)
apps/web/playwright.config.ts                              NEW
apps/web/__tests__/wc2026-landing.countdown.test.ts        NEW
apps/web/__tests__/wc2026-landing.groups.test.ts           NEW
apps/web/__tests__/e2e/wc2026-landing.e2e.spec.ts          NEW
apps/web/__tests__/e2e/wc2026-screenshots.e2e.spec.ts      NEW
apps/web/package.json                                      MOD (+@playwright/test, +test:e2e script)
data/pre-signups/README.md                                 NEW
prompts/social/wc2026-launch-hype.md                       NEW
sessions/2026-05-09_landing-agent_wc2026-hype-landing.md   NEW
.gitignore                                                 MOD (PII signups + Playwright outputs)
pnpm-lock.yaml                                             MOD
```
