---
session: 2026-05-11 orchestrator launch-readiness sprint
status: in-progress (awaiting Tim's .env fill + DNS provisioning)
---

# Overnight launch-readiness sprint, 2026-05-11

Tim went away to provision API keys; this note summarises what
landed while he was away so he can pick up the right thread when
he's back.

## Merged today (PRs 173–184)

- **#173** chore(release): final OSS readiness pass + flip-public checklist (`docs/55`)
- **#174** feat(engineering): build-on-Tournamental walkthrough (npm + REST + MCP)
- **#175** feat(legal): Terms, Privacy Policy, Cookie Notice + sign-up consent
- **#176** feat(game,web): self-service personal API keys at `/profile/api-keys`
  - Token format `tnm_live_<32-char-base62>`, scrypt-at-rest, 11 new tests
- **#177** feat(security): two-layer OTP brute-force protection (app + Cloudflare WAF)
  - `infra/cloudflare/otp-protection.sh` script ready; needs `CLOUDFLARE_API_TOKEN` to run
- **#178** fix(web): `/syndicates` index page + pre-launch env-stub index (`docs/56`)
- **#179** chore(deps): safe slice of grouped dependabot bump (rapier 0.19, supabase-ssr 0.10, supabase-js 2.105, satori 0.26; dropped sitemap 3.7 — needs astro 5)
- **#180** chore: park React 19 + vitest 4 + astro 5 migrations in IDEAS
- **#181** fix(web): drawer test alignment — sub-items, external glyph, /save-share route. **All 1003 web tests now pass** (was 1000).
- **#182** chore: final pre-public-flip scrub (deleted MORNING_REPORT + STARTER-PROMPT, scrubbed remaining vtorn-*.aiva.nz dev URLs, depersonalised CLAUDE.md / IDEAS.md / docs/22)
- **#183** fix(marketing): launch-QA blockers — home-page render, dev toolbar, broken CTAs, missing heroes
- **#184** fix(web): centre `.vt-page-content` on wide viewports (profile page no longer left-aligned)

## Dependabot queue cleared

Triaged all 10 open PRs:
- 6 merged (#119 setup-python, #120 cache, #121 checkout, #122 create-pr, #123 setup-uv, #179)
- 4 closed with explicit deferred-migration reasoning (#21 r3f v9, #22 vitest 4, #23 drei v10, #24 react 19)
- Parked in IDEAS.md so they get picked up next sprint

## Live `.env` stubs created (gitignored)

26 stubbed env files across `apps/*` and top-level. Fill order
documented in `docs/56-env-stubs-index.md` (Tier 1 / Tier 2 / Tier 3).
**Tier 1 (required for kickoff):** top-level `.env` (Cloudflare /
GitHub / npm tokens), `apps/web/.env.production` (Supabase + GHL),
`apps/auth-sms/.env` (Aiva + BotFather + admin), `apps/identity/.env`,
`apps/crm-bridge/.env`, `apps/tournament-bot/.env`.

## Critical bug fixed: marketing home page half-render

The reveal-on-scroll script in `Layout.astro` pre-hid every
`<section>` at `opacity:0` and relied on IntersectionObserver to
unhide them. Slow networks, SEO crawlers, screenshot tools, and
the playwright launch-QA all saw only the hero + footer — a
4000px blank gap in between. Fixed so only below-fold sections
fade in; in-view sections render at full opacity immediately.

## Verified

- All 1003 web tests pass
- All 81 auth-sms + 79 dm-otp brute-force tests pass
- 110 social-cards tests pass (satori 0.26 verified)
- 16 MCP server tests pass; MCP server boots cleanly on stubbed env
- `pnpm -r typecheck` green across 36 packages
- `pnpm --filter @vtorn/marketing build` green (46 pages, sitemap clean)
- `pnpm --filter @vtorn/web build` green
- `gitleaks detect` zero findings across 360 commits / 925 MB
- 16 public surfaces return 200 (play.tournamental.com `/`, `/syndicates`,
  `/world-cup-2026`, `/world-cup-2026/save-share`, `/leaderboard`,
  `/profile`; tournamental.com `/`, `/legal/{terms,privacy,cookies}`,
  `/engineering`, `/engineering/2026-05-14-build-on-tournamental`,
  `/blog`, `/syndicates`, `/api`)
- 5 newly-generated blog hero SVGs return 200
- Astro dev toolbar no longer ships to production HTML

## Still on Tim's plate

### Hard launch blockers (you, the operator)

1. Fill **Tier 1 .env** values (Supabase keys, Aiva API key, Telegram bot token, Cloudflare API token, GHL keys).
2. Provision missing DNS subdomains in Cloudflare — flagged by QA as 48 console errors per play page:
   - `game.tournamental.com` (apps/game on :3360)
   - `odds.tournamental.com` (apps/odds-ingest on :3341)
   - `news.tournamental.com` (apps/news-aggregator on :3344)
3. Run `infra/cloudflare/otp-protection.sh` against the live zone (needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID`).
4. Walk the 8 legal-review TODOs from #175 (NZBN, mailbox provisioning, `/profile/data-export`, `/api/cookie-prefs`, NZPA s22, GDPR 6(1)(f), CGA NZD-100 cap, Wellington venue).

### Soft blockers (worth fixing pre-flip)

- Hardcoded **"demo smoke test final"** appears in some live cached state on `/save-share` — likely a DB-side bracket title needing a real seed.
- **Leaderboard** still shows synthetic-looking `@user_N` handles. Real data lands at kickoff; the fictitious-data banner already exists.
- **Two-button Sign-in confusion** on `/profile`: AuthChip pill + ProfilePage inline button. Functionally distinct (one in chrome, one in content) but reads as crowded.
- **"12,000+ syndicates running"** social-proof number in marketing footer — verify or downgrade copy.

### Park (post-launch)

- React 18 → 19 migration (drags r3f 9 + drei 10).
- vitest 2 → 4 migration.
- Astro 4 → 5 migration (unblocks `@astrojs/sitemap` 3.7+ bump).
- Remaining items from the visual QA's MEDIUM/LOW lists (typographic separators, `/leaderboards` vs `/leaderboard` plural, etc).

## Next steps

1. Tim fills Tier 1 .env values and runs `pm2 restart all`.
2. Tim runs the Cloudflare OTP-protection script + provisions the three missing subdomains.
3. We do one final visual QA pass on live URLs.
4. Repo flips private → public.
