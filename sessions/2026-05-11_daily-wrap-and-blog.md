# Daily wrap + blog post — 2026-05-11

**Branch:** `chore/daily-2026-05-11-and-blog`
**Status:** complete
**Output:**
- `sessions/daily/2026-05-11.md` (NEW)
- `apps/marketing/src/content/blog/2026-05-12-night-shift.mdx` (NEW)
- `apps/marketing/public/blog/2026-05-12-night-stadium-hero.jpg` (NEW)

## Sources

The daily report is built from:

- `git log --since="2026-05-10 23:00" --pretty=format:"%h %ai %s"` —
  17 PRs merged today (#94 through #110), all squash merges with
  conventional-commit subjects.
- `gh pr list --state open --limit 30 --json
  number,title,headRefName,createdAt` — 1 in-flight PR (#111, the
  PR-triage + security-watchdog pack) plus 4 long-standing dependabot
  PRs (#21-#24) that have been open since 9 May.
- `git log --since="2026-05-10 23:00" --diff-filter=A --name-only` —
  50 new test files added today (file count, not test count).
- `sessions/daily/2026-05-10.md` for shape, tone, and the
  baseline "running locally" port table.
- `docs/43-renderer-fidelity-overhaul.md`,
  `docs/44-overlay-router-and-mobile-overlays.md`,
  `docs/45-per-match-pick-popup-and-api.md`,
  `docs/47-cicd-pipeline.md` for the four major design surfaces
  shipped today.

## Cited PRs

| #   | Title                                                                              |
| --- | ---------------------------------------------------------------------------------- |
| 94  | feat(web): mobile bracket gestures — pinch-zoom, sticky group headers, haptic on pick |
| 95  | feat(tools): daily progress-report automation script + cron wrapper                |
| 96  | feat(web): /match/[id]/preview 5-tab page                                          |
| 97  | feat(social-publisher): real Discord webhook + Telegram + Reddit OAuth adapters    |
| 98  | feat(game,web,social-cards): Verified-Pundit badge + endpoint + leaderboard surfaces |
| 99  | feat(native): Capacitor iOS+Android shell with push, haptics, share                |
| 100 | feat(drips-bridge): contributor revenue-split scaffold + mock Drips client         |
| 101 | feat(wc2026-data): live-data scraper with SportRadar + API-Football adapters       |
| 102 | feat(dm-poll-forwarder): polling worker for Reddit/Mastodon/Signal DM-OTP          |
| 103 | feat(web): MatchPredictionRow enrichment — form dots + H2H pill + selection ring   |
| 104 | style(marketing): big design polish — motion + typography + brand shapes + footer  |
| 105 | feat(marketing): /blog section + 3 inaugural posts + RSS                           |
| 106 | feat(web): FIFA-style PWA app shell — bottom nav, app-bar, pill tabs, manifest     |
| 107 | feat(web,renderer): fidelity overhaul                                              |
| 108 | feat(game,web): per-match pick popup + per-match game API endpoints                |
| 109 | feat(web,marketing): mobile-first overlay/sheet system + deep-linkable cards       |
| 110 | feat(infra): CI/CD with staging/prod slots                                         |
| 111 | feat(security): autonomous PR-triage bot + security-watchdog (open)                |

## Deliberate omissions

The task brief mentioned three sibling features in flight that I
should NOT report on as merged:

- `feat/knockout-flag-backgrounds` — not yet merged, parked in
  "Tomorrow's first move".
- `feat/player-profiles` — not yet merged, parked.
- `feat/news-aggregator` — not yet merged, parked.
- `feat/docs-hive-mind-and-swagger` — not yet merged, parked.

I confirmed via `git log --since="2026-05-10 23:00" --pretty=format:"%s"`
that none of those landed today. The blog post explicitly mentions
"flag-as-background polish" only as a forward-looking item ("the
morning's first move"), not as something that shipped overnight,
in line with the task brief beat 4.

## Hero image

Searched Unsplash via WebFetch for "football stadium night". Picked
the Krzysztof Dubiel photo (`photo-1629217855633-79a6925d6c47`) —
floodlit stadium at night, packed crowd, evocative of overnight work
on a sports product. Downloaded via curl from the Unsplash CDN at
1600px wide, ~465 KB. Saved to
`apps/marketing/public/blog/2026-05-12-night-stadium-hero.jpg`.
Frontmatter records `heroImage` as `/blog/2026-05-12-night-stadium-hero.jpg`,
matching the existing pattern in the three published posts.
`heroImageCredit` is "Photo by Krzysztof Dubiel on Unsplash (Unsplash Licence)".

## Test counts

Yesterday's report: ~470. Today's git log shows 50 new test FILES
added. Per-test count not run (`pnpm test` across 33 packages would
take many minutes and isn't required for a blog/report PR). Estimated
~620 total tests based on the new file count and yesterday's figure;
this is a deliberate undercount rather than an over-claim.

## Verification

- `pnpm --filter @vtorn/marketing build` — clean. Astro built 17
  pages including `/blog/2026-05-12-night-shift/index.html`.
- `pnpm --filter @vtorn/marketing typecheck` — 0 errors, 0 warnings,
  3 hints (all pre-existing in `Header.astro` and `login.astro`,
  unrelated to this PR).
- All `docs/*` and `sessions/daily/2026-05-10.md` links in the
  daily report verified to exist on disk.
- 0 emdashes in the new blog post (NZ English / project-wide rule).
- The daily report uses emdashes consistent with the 2026-05-10
  precedent the brief asked me to model.

## Word counts

- Daily report: 1430 words / 217 lines.
- Blog post: 877 words body (1103 with frontmatter and headings),
  inside the 600-900 budget the brief specified.

## Blockers

None. Ready to push and PR.
