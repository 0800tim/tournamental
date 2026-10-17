---
title: Remote branch triage
date: 2026-10-17
status: read only; nothing deleted, nothing closed
---

# Remote branch triage, 17 October 2026

Snapshot of `origin` after `git fetch --prune` on 17 October 2026, main at
e1e0eac9. Counts: 56 remote branches are fully merged into main and
171 are not. This report lists every unmerged branch with its last
commit date, author, how far ahead of and behind main it is, whether
main already carries its patches, which areas it touches and its
first commit subject. It recommends; it deletes nothing. The 9
Dependabot branches are listed on their own at the end.

"Covered by main" uses `git cherry`: a commit is patch-equivalent when
the same diff already exists on main under another hash (a squash
merge or a cherry-pick). "No equivalent patches" means the diff is not
on main as-is; it may still be superseded by later work, which is a
judgement call per branch.

## Summary

| Group | Branches | Suggested action |
| --- | --- | --- |
| Covered: every commit already on main as a patch-equivalent, or nothing ahead | 126 | Safe to delete after a glance at the subject |
| Partly covered: some commits patch-equivalent, the rest not | 1 | Check the remaining commits; most are May era and superseded |
| Stale: no equivalent patches, last commit before September 2026 | 31 | Review the subject; most are one or two commits from the May and June sprints, likely superseded by the rewrites that followed |
| Opened today by the agent (draft PRs #335 to #338) | 4 | Review and merge or close |
| Dependabot | 9 | See the burn-board item that verifies each one in a worktree |

By author: Tim Thomas 56, Tim 32, Clawd 30, Tim Atkins 15, dependabot[bot] 9, Growth Spurt 9, Tournamental MCP-Author Agent 5, Tim Edmunds 4, VTorn Builder 2, Tim Wood 1, Tim Anderson 1, Tim Norton 1, Tim Clarkson 1, VTorn Poll Forwarder Builder 1, VTourn Kickoff Lockout Agent 1, Tim Maslen 1, Stream Server Builder 1, Tim Watson 1.

By month of last commit: 2026-05 140, 2026-06 27, 2026-10 4.

Almost everything is from May and June 2026, before and during FWC
2026, from the parallel agent sprints. Main has moved 241 to 869
commits past those branches, so none of them merge cleanly any more;
anything worth keeping is better re-done from main than rebased.

## Recommendation

1. Delete the covered group in one pass (`git push origin --delete`).
2. Delete the partly covered and stale groups after reading each
   subject below; keep any branch whose idea is not yet on main by
   noting it in IDEAS.md first, then delete the branch anyway. A
   branch 800 commits behind main is a note, not code.
3. Leave the Dependabot branches to the verification item.

Nothing in this report has been acted on.

## Covered by main (126)

| Branch | Last commit | Author | Ahead / behind main | Covered by main? | Touches | First commit subject |
| --- | --- | --- | --- | --- | --- | --- |
| `feat/commentary-translations` | 2026-05-09 | Clawd | 1 / 848 | yes, all 1 patch-equivalent | data(11) | feat(commentary): improve broadcast translations + per-lang durations |
| `feat/marketing-site-v0-clean` | 2026-05-09 | Tim Thomas | 1 / 862 | yes, all 1 patch-equivalent | apps/marketing(28) pnpm-lock.yaml(1) | feat(marketing): apps/marketing - vtourn.com site v0.1 (11 pages) |
| `feat/rebrand-vtorn-to-vtourn` | 2026-05-09 | Clawd | 1 / 848 | yes, all 1 patch-equivalent | packages/avatar(6) apps/statsbomb-replay(6) infra(5) | refactor(brand): rebrand VTorn -> VTourn across docs, marketing, and user-facing copy |
| `feat/timeline-scrubber-and-fidelity` | 2026-05-09 | Tim Thomas | 1 / 863 | yes, all 1 patch-equivalent | apps/web(19) packages/spec-client(2) tasks(1) | feat(web): timeline scrubber, AR-FR replay file, real faces, scene lighting |
| `feat/wc2026-hype-landing` | 2026-05-09 | Clawd | 1 / 838 | yes, all 1 patch-equivalent | apps/web(21) sessions(1) prompts(1) | feat(web): WC2026 hype/marketing landing page on 2026wc.vtourn.com apex |
| `feat/wc2026-real-draw` | 2026-05-09 | Clawd | 1 / 849 | yes, all 1 patch-equivalent | data(4) apps/wc2026-data(4) packages/bracket-engine(2) | feat(data): replace WC2026 placeholders with real Final Draw composition |
| `feat/web-renderer` | 2026-05-09 | Tim Thomas | 1 / 864 | yes, all 1 patch-equivalent | apps/web(34) packages/spec-client(8) sessions(1) | feat(web): scaffold Next.js + R3F renderer with AR-FR demo |
| `docs/competitor-ux-dossier` | 2026-05-10 | Tim | 1 / 810 | yes, all 1 patch-equivalent | sessions(1) docs/36-vtourn-ux-spec.md(1) docs/35-competitor-ux-dossier.md(1) | docs(ux): competitor dossier + VTourn UX spec |
| `feat/admin-advertiser-ops` | 2026-05-10 | Tim | 1 / 810 | yes, all 1 patch-equivalent | apps/admin(22) | feat(admin): operators + advertisers dashboards with NZ-TAB compliance enforcement |
| `feat/admin-customer-360` | 2026-05-10 | Tim | 1 / 799 | yes, all 1 patch-equivalent | apps/admin(10) sessions(1) | feat(admin): customer-360 page with predictions ledger + CRM contact + revenue + clips |
| `feat/admin-dashboard` | 2026-05-10 | Clawd | 1 / 824 | yes, all 1 patch-equivalent | apps/admin(79) apps/api(2) sessions(1) | feat(admin): VTourn admin dashboard with magic-link auth + RBAC |
| `feat/affiliate-router-paytv` | 2026-05-10 | Clawd | 1 / 818 | yes, all 1 patch-equivalent | apps/affiliate-router(22) sessions(1) pnpm-lock.yaml(1) | feat(affiliate-router): add Fastify :3370 service with geo gating + audit log |
| `feat/clip-pipeline-auto-trigger` | 2026-05-10 | Tim Edmunds | 1 / 810 | yes, all 1 patch-equivalent | apps/clip-pipeline(10) sessions(1) pnpm-lock.yaml(1) | feat(clip-pipeline): auto-trigger on stream events + publisher dispatch |
| `feat/crm-bridge` | 2026-05-10 | Tim | 1 / 810 | yes, all 1 patch-equivalent | apps/crm-bridge(19) pnpm-lock.yaml(1) | feat(crm-bridge): apps/crm-bridge - GoHighLevel sync service on :3395 |
| `feat/crm-real-ghl-client` | 2026-05-10 | Tim | 1 / 798 | yes, all 1 patch-equivalent | apps/crm-bridge(8) sessions(1) .env.example(1) | feat(crm-bridge): real GoHighLevel client backend with retry + replay |
| `feat/fidelity-phase2-physics-director` | 2026-05-10 | Clawd | 1 / 834 | yes, all 1 patch-equivalent | apps/web(17) packages/ball-physics(9) packages/avatar(4) | feat(fidelity): Phase 2 - foot IK, ball physics, auto-director with goal slow-mo |
| `feat/game-service-leaderboards` | 2026-05-10 | Clawd | 1 / 817 | yes, all 1 patch-equivalent | apps/game(28) sessions(1) pnpm-lock.yaml(1) | feat(game): add bracket submission, settlement, leaderboards on :3360 |
| `feat/identity-humanness` | 2026-05-10 | Tim | 1 / 810 | yes, all 1 patch-equivalent | apps/identity(24) pnpm-lock.yaml(1) | feat(identity): apps/identity - OAuth link adapters + Humanness Score MVP on :3392 |
| `feat/kickoff-lockout-server` | 2026-05-10 | VTourn Kickoff Lockout Agent | 1 / 810 | yes, all 1 patch-equivalent | apps/wc2026-data(6) apps/game(5) pnpm-lock.yaml(1) | feat(game,wc2026-data): server-side kickoff lockout + real fixture-time wiring |
| `feat/marketing-light-mode-pass` | 2026-05-10 | Tim Edmunds | 1 / 803 | yes, all 1 patch-equivalent | apps/marketing(7) sessions(1) pnpm-lock.yaml(1) | style(marketing): full light-mode component pass + readability e2e spec |
| `feat/odds-chip-bracket-integration` | 2026-05-10 | Clawd | 1 / 834 | yes, all 1 patch-equivalent | apps/web(27) sessions(1) | feat(web): live odds chips + hover tooltips on bracket page |
| `feat/odds-ingest-service` | 2026-05-10 | Clawd | 1 / 827 | yes, all 1 patch-equivalent | apps/odds-ingest(26) sessions(1) pnpm-lock.yaml(1) | feat(odds-ingest): live W/D/L ingest service for the WC2026 bracket |
| `feat/push-notifications` | 2026-05-10 | Tim Edmunds | 1 / 806 | yes, all 1 patch-equivalent | apps/push-notifications(20) sessions(1) pnpm-lock.yaml(1) | feat(push-notifications): apps/push-notifications - Web Push + Telegram + SMS fan-out + kickoff scheduler |
| `feat/push-whatsapp-channel` | 2026-05-10 | Clawd | 1 / 798 | yes, all 1 patch-equivalent | apps/push-notifications(9) sessions(1) pnpm-lock.yaml(1) | feat(push-notifications): WhatsApp channel via Aiva gateway with auto-prefer policy |
| `feat/shared-aiva-client` | 2026-05-10 | Clawd | 1 / 792 | yes, all 1 patch-equivalent | packages/aiva-client(8) apps/push-notifications(4) apps/auth-sms(3) | feat(aiva-client): lift AivaSms+WhatsApp clients to packages/aiva-client and wire push-notifications |
| `feat/social-publisher` | 2026-05-10 | Tim | 1 / 810 | yes, all 1 patch-equivalent | apps/social-publisher(30) pnpm-lock.yaml(1) | feat(social-publisher): apps/social-publisher with 8 platform adapter stubs |
| `feat/social-publisher-whatsapp` | 2026-05-10 | Growth Spurt | 1 / 798 | yes, all 1 patch-equivalent | apps/social-publisher(9) | feat(social-publisher): WhatsApp adapter via Aiva gateway |
| `feat/stream-server` | 2026-05-10 | Stream Server Builder | 1 / 816 | yes, all 1 patch-equivalent | apps/stream-server(18) sessions(1) pnpm-lock.yaml(1) | feat(stream-server): add :4002 fan-out service with ring + back-pressure isolation |
| `feat/team-detail-page` | 2026-05-10 | Tim Edmunds | 1 / 810 | yes, all 1 patch-equivalent | apps/web(9) | feat(web): /team/[code] detail pages with hero flag + recent form + group context + squad |
| `feat/telegram-login-widget` | 2026-05-10 | Growth Spurt | 1 / 798 | yes, all 1 patch-equivalent | apps/auth-sms(10) apps/web(3) sessions(1) | feat(auth): Telegram Login Widget - phone-linked auth without SMS |
| `feat/tournament-bot-whatsapp` | 2026-05-10 | Clawd | 1 / 798 | yes, all 1 patch-equivalent | apps/tournament-bot(9) sessions(1) | feat(tournament-bot): WhatsApp parity via Aiva gateway with shared command dispatcher |
| `test/bracket-cascade-e2e` | 2026-05-10 | Clawd | 1 / 834 | yes, all 1 patch-equivalent | apps/web(12) sessions(1) | test(bracket): full cascade e2e - group → R32 → R16 → QF → SF → final |
| `chore/daily-2026-05-11-and-blog` | 2026-05-11 | Tim Wood | 1 / 772 | yes, all 1 patch-equivalent | sessions(2) apps/marketing(2) | chore: daily report 2026-05-11 + blog post 'Night shift' |
| `chore/final-public-scrub` | 2026-05-11 | Tim Atkins | 1 / 687 | yes, all 1 patch-equivalent | apps/marketing(2) sessions(1) docs/56-env-stubs-index.md(1) | chore: final pre-public-flip scrub of internal references |
| `chore/oss-readiness-final` | 2026-05-11 | Tim | 1 / 701 | yes, all 1 patch-equivalent | .github(4) docs/55-public-launch-checklist.md(1) SECURITY.md(1) | chore(release): final OSS readiness pass + flip-public checklist |
| `chore/parked-major-migrations` | 2026-05-11 | Tim Atkins | 1 / 689 | yes, all 1 patch-equivalent | IDEAS.md(1) | chore: park React 19 + vitest 4 + astro 5 migrations in IDEAS.md |
| `chore/scrub-aiva-domains` | 2026-05-11 | Tim | 1 / 708 | yes, all 1 patch-equivalent | docs/api(16) sessions(14) apps/wc2026-data(8) | chore(security): scrub aiva.nz from public surface before OSS flip |
| `docs/overnight-session-note` | 2026-05-11 | Tim Atkins | 1 / 684 | yes, all 1 patch-equivalent | sessions(1) | docs: overnight launch-readiness session note |
| `feat/api-portal` | 2026-05-11 | Tim Norton | 1 / 708 | yes, all 1 patch-equivalent | apps/marketing(7) docs/api(1) docs/53-api-portal.md(1) | feat(marketing,docs): aggregated API docs portal at /api with Scalar |
| `feat/bracket-mobile-gestures` | 2026-05-11 | Tim | 1 / 789 | yes, all 1 patch-equivalent | apps/web(4) sessions(1) | feat(web): mobile bracket gestures - pinch-zoom, sticky group headers, haptic on pick |
| `feat/build-on-tournamental-post` | 2026-05-11 | Tim | 1 / 701 | yes, all 1 patch-equivalent | apps/marketing(2) | feat(engineering): build-on-Tournamental walkthrough (npm + REST + MCP) |
| `feat/calls-blog-posts` | 2026-05-11 | Tim | 1 / 702 | yes, all 1 patch-equivalent | apps/marketing(4) sessions(1) | feat(marketing): four discipline-specific contributor-call blog posts |
| `feat/capacitor-native-shell` | 2026-05-11 | Tim | 1 / 786 | yes, all 1 patch-equivalent | apps/native(80) apps/web(6) apps/push-notifications(5) | feat(native): Capacitor iOS+Android shell with push, haptics, share |
| `feat/cicd-staging-prod-slots` | 2026-05-11 | VTorn Builder | 1 / 773 | yes, all 1 patch-equivalent | infra(31) docs/cicd(4) .github(3) | feat(infra): CI/CD with staging/prod slots - Sdeal-style atomic-swap deploy + cache-aware fast rebuilds |
| `feat/daily-report-automation` | 2026-05-11 | Tim | 1 / 789 | yes, all 1 patch-equivalent | tools(7) pnpm-workspace.yaml(1) pnpm-lock.yaml(1) | feat(tools): daily progress-report automation script + cron wrapper |
| `feat/desktop-nav-bar` | 2026-05-11 | Tim | 1 / 709 | yes, all 1 patch-equivalent | apps/web(14) sessions(1) | feat(web): desktop horizontal nav row in AppBar with auth chip |
| `feat/drips-bridge` | 2026-05-11 | Clawd | 1 / 789 | yes, all 1 patch-equivalent | apps/drips-bridge(18) sessions(1) pnpm-lock.yaml(1) | feat(drips-bridge): contributor revenue-split scaffold + mock Drips client |
| `feat/engineering-blog` | 2026-05-11 | Tim | 1 / 705 | yes, all 1 patch-equivalent | apps/marketing(6) docs/03-architecture.md(1) apps/web(1) | feat(marketing): engineering tech blog at /engineering + stack-at-a-glance starter post |
| `feat/legal-pages` | 2026-05-11 | Tim | 2 / 703 | yes, all 2 patch-equivalent | apps/web(119) apps/marketing(15) apps/game(15) | feat(legal): Terms, Privacy Policy, Cookie Notice + sign-up consent |
| `feat/marketing-blog` | 2026-05-11 | Clawd | 1 / 778 | yes, all 1 patch-equivalent | apps/marketing(18) sessions(1) pnpm-lock.yaml(1) | feat(marketing): /blog section + 3 inaugural posts + RSS |
| `feat/marketing-design-polish` | 2026-05-11 | Tim | 1 / 789 | yes, all 1 patch-equivalent | apps/marketing(16) sessions(1) | style(marketing): big design polish - motion + typography + brand shapes + footer |
| `feat/match-preview-5tab` | 2026-05-11 | Tim | 1 / 789 | yes, all 1 patch-equivalent | apps/web(16) sessions(1) | feat(web): /match/[id]/preview 5-tab page (Predict / H2H / Form / Lineup / Stats) |
| `feat/mcp-server-final` | 2026-05-11 | Tournamental MCP-Author Agent | 1 / 705 | yes, all 1 patch-equivalent | apps/mcp(21) sessions(1) docs/53-mcp-server.md(1) | feat(mcp): Tournamental Model Context Protocol server (v0.1) |
| `feat/mobile-overlays-deep-links` | 2026-05-11 | VTorn Builder | 1 / 775 | yes, all 1 patch-equivalent | apps/web(20) apps/marketing(4) sessions(1) | feat(web,marketing): mobile-first overlay/sheet system + deep-linkable cards + drawer polish |
| `feat/molecule-capture-share` | 2026-05-11 | Clawd | 1 / 717 | yes, all 1 patch-equivalent | apps/web(8) packages/social-cards(3) | feat(web): molecule capture-and-share for the WC 2026 pyramid |
| `feat/molecule-layer-labels-overlay` | 2026-05-11 | Tim | 1 / 721 | yes, all 1 patch-equivalent | apps/web(5) | feat(web): molecule layer-label overlay (CHAMPION → GROUP STAGE) |
| `feat/molecule-opp-labels` | 2026-05-11 | Tim | 1 / 718 | yes, all 1 patch-equivalent | apps/web(5) sessions(1) | feat(web): molecule v5.1, name the opponent on every gold-path stage |
| `feat/molecule-viral-share-landing` | 2026-05-11 | Tim | 1 / 716 | yes, all 1 patch-equivalent | apps/web(7) sessions(1) pnpm-lock.yaml(1) | feat(web): molecule viral-share landing, auto-open champion panel + DOM-faithful capture |
| `feat/mpr-enrichment` | 2026-05-11 | Tim | 1 / 782 | yes, all 1 patch-equivalent | apps/web(13) sessions(1) | feat(web): MatchPredictionRow enrichment - form dots + H2H pill + kit-coloured selection ring |
| `feat/news-aggregator` | 2026-05-11 | Clawd | 1 / 769 | yes, all 1 patch-equivalent | apps/news-aggregator(34) apps/marketing(8) apps/web(4) | feat(news-aggregator,marketing,web): /news section + RSS aggregator across 6 sources |
| `feat/npm-prep-clean` | 2026-05-11 | Tournamental MCP-Author Agent | 1 / 703 | yes, all 1 patch-equivalent | apps/web(118) apps/game(15) prompts(13) | chore(release): prep @tournamental/* npm packages for public publish |
| `feat/personal-api-keys` | 2026-05-11 | Tim Atkins | 1 / 701 | yes, all 1 patch-equivalent | apps/game(8) apps/web(5) sessions(1) | feat(game,web): self-service personal API keys at /profile/api-keys |
| `feat/player-profiles` | 2026-05-11 | Growth Spurt | 1 / 769 | yes, all 1 patch-equivalent | apps/web(14) apps/wc2026-data(6) sessions(1) | feat(web,wc2026-data): player profiles + Wikidata scraper for the 48 confirmed WC2026 teams |
| `feat/plugin-architecture` | 2026-05-11 | Tim | 1 / 708 | yes, all 1 patch-equivalent | packages/plugin-sdk(9) packages/plugins(5) sessions(1) | feat(plugin-sdk): ship plugin architecture for open-source contributors |
| `feat/press-releases-and-press-page` | 2026-05-11 | Tim | 1 / 721 | yes, all 1 patch-equivalent | apps/marketing(18) | feat(marketing,content): press collection, /press page, three launch press releases, press kit shell |
| `feat/save-share-molecule-preview` | 2026-05-11 | Tim Maslen | 1 / 711 | yes, all 1 patch-equivalent | apps/web(13) | feat(web): live molecule preview on save-share + big podium hero on /s/<guid> |
| `feat/social-publisher-real-apis` | 2026-05-11 | Tim | 1 / 789 | yes, all 1 patch-equivalent | apps/social-publisher(20) sessions(1) | feat(social-publisher): real Discord webhook + Telegram + Reddit OAuth adapters |
| `feat/starter-kit-iter-1` | 2026-05-11 | Tim Atkins | 1 / 683 | yes, all 1 patch-equivalent | examples(10) pnpm-workspace.yaml(1) pnpm-lock.yaml(1) | feat(devx): starter-kit iteration 1, AGENTS.md + devcontainer + examples |
| `feat/starter-kit-iter-2` | 2026-05-11 | Tim Atkins | 1 / 682 | yes, all 1 patch-equivalent | skills(5) .github(3) tools(1) | feat(devx): starter-kit iter 2 - skills + labels + agent-task issue template |
| `feat/starter-kit-iter-3` | 2026-05-11 | Tim Atkins | 1 / 681 | yes, all 1 patch-equivalent | packages/create-tournamental-app(10) pnpm-lock.yaml(1) FUNDING.json(1) | feat(devx): starter-kit iter 3 - create-app scaffolder + FUNDING.json + weekly cron |
| `feat/wc2026-live-data` | 2026-05-11 | Tim | 1 / 789 | yes, all 1 patch-equivalent | apps/wc2026-data(14) sessions(1) pnpm-lock.yaml(1) | feat(wc2026-data): live-data scraper with SportRadar + API-Football adapters and mock provider |
| `feat/web-pwa-app-shell` | 2026-05-11 | Tim | 1 / 778 | yes, all 1 patch-equivalent | apps/web(45) sessions(1) docs/37-pwa-app-shell.md(1) | feat(web): FIFA-style PWA app shell - bottom nav, top app-bar, pill tabs, hero cards, installable manifest |
| `fix/drawer-test-alignment` | 2026-05-11 | Tim Atkins | 1 / 688 | yes, all 1 patch-equivalent | apps/web(3) | fix(web): align AppMenuDrawer with test expectations + in-app /syndicates |
| `fix/launch-qa-blockers` | 2026-05-11 | Tim Atkins | 1 / 686 | yes, all 1 patch-equivalent | apps/marketing(12) | fix(marketing): launch-QA blockers - home page render, dev toolbar, broken CTAs |
| `fix/profile-centering` | 2026-05-11 | Tim Atkins | 1 / 685 | yes, all 1 patch-equivalent | apps/web(1) | fix(web): center .vt-page-content on wide viewports |
| `fix/share-guid-real-bracket-lookup` | 2026-05-11 | Tim | 1 / 719 | yes, all 1 patch-equivalent | apps/web(9) apps/game(7) | fix(game,web): /s/[guid] resolves the user's REAL saved bracket (not a synthetic stub) |
| `fix/share-page-cascade-and-molecule` | 2026-05-11 | Tim | 1 / 716 | yes, all 1 patch-equivalent | apps/web(6) apps/game(3) sessions(1) | fix(game,web): /s/[guid] resolves champion + embeds live molecule |
| `fix/syndicates-index-and-env-stub-index` | 2026-05-11 | Tim Atkins | 1 / 696 | yes, all 1 patch-equivalent | apps/web(2) docs/56-env-stubs-index.md(1) | fix(web): /syndicates index page + pre-launch env-stub index |
| `fix/team-code-prerender` | 2026-05-11 | Clawd | 1 / 766 | yes, all 1 patch-equivalent | sessions(1) apps/web(1) apps/admin(1) | fix(web,admin): pin NODE_ENV=production for next build |
| `docs/ai-native-dev-blog` | 2026-05-12 | Tim Atkins | 1 / 679 | yes, all 1 patch-equivalent | apps/marketing(2) docs/57-agentic-development.md(1) | docs+blog: agentic development at Tournamental |
| `fix/bracket-tabs-sticky-offset` | 2026-05-12 | Tim Atkins | 1 / 680 | yes, all 1 patch-equivalent | apps/web(1) | fix(web): sticky bracket tabs no longer float mid-page |
| `chore/odds-ingest-pm2-config` | 2026-05-25 | Tim Thomas | 1 / 454 | yes, all 1 patch-equivalent | apps/odds-ingest(1) | chore(odds): pm2 config serves real Polymarket on :3341, mock off |
| `feat/embed-get-code-popup` | 2026-05-25 | Tim Thomas | 1 / 468 | yes, all 1 patch-equivalent | apps/web(3) | feat(embed): popup-driven "Get my code" + always-present code field |
| `feat/embed-inline-otp` | 2026-05-25 | Tim Thomas | 1 / 469 | yes, all 1 patch-equivalent | apps/web(4) sessions(1) | feat(embed): inline OTP sign-in for the widget (no popup, no cookies) |
| `feat/inbound-login-pool-slug` | 2026-05-25 | Tim Thomas | 1 / 465 | yes, all 1 patch-equivalent | apps/auth-sms(1) | feat(auth-sms): carry pool slug through inbound-login magic link |
| `feat/join-flow` | 2026-05-25 | Tim Thomas | 1 / 459 | yes, all 1 patch-equivalent | apps/web(3) | feat(join): full /s/[guid]/join flow (sign-in, onboarding, payment) + admin terms field |
| `feat/join-flow-base` | 2026-05-25 | Tim Thomas | 1 / 460 | yes, all 1 patch-equivalent | apps/web(5) apps/game(1) | feat(join): join_fee_terms_text field + /s/[guid]/join shell (base for join flow) |
| `feat/odds-polymarket-fix` | 2026-05-25 | Tim Thomas | 1 / 457 | yes, all 1 patch-equivalent | apps/odds-ingest(4) apps/web(3) | fix(odds): scrape real Polymarket match moneylines + fix web wire-shape |
| `feat/odds-proxy-server-url` | 2026-05-25 | Tim Thomas | 1 / 455 | yes, all 1 patch-equivalent | apps/web(2) | feat(odds): team group/winner proxy routes read server-only ODDS_API_URL |
| `fix/avatar-upload-dir` | 2026-05-25 | Tim Thomas | 1 / 466 | yes, all 1 patch-equivalent | apps/web(2) | fix(profile): write avatars to data/avatars so uploads are served |
| `fix/embed-whatsapp-login-keyword` | 2026-05-25 | Tim Thomas | 1 / 467 | yes, all 1 patch-equivalent | apps/web(1) | fix(embed): use bare "login" keyword for the WhatsApp deep-link |
| `fix/join-rank-ordinal` | 2026-05-25 | Tim Thomas | 1 / 458 | yes, all 1 patch-equivalent | apps/web(1) | fix(join): restore rank number in prize-rank label |
| `fix/odds-ingest-port-3340` | 2026-05-25 | Tim Thomas | 1 / 452 | yes, all 1 patch-equivalent | apps/odds-ingest(1) | fix(odds): run odds-ingest on 3340 (proxy port), off the odds.tournamental.com route |
| `chore/odds-ingest-3341-live` | 2026-05-26 | Tim Thomas | 1 / 450 | yes, all 1 patch-equivalent | apps/odds-ingest(1) | chore(odds): odds-ingest on 3341 (odds.tournamental.com live) |
| `feat/play-home-headline-copy` | 2026-05-29 | Tim Thomas | 1 / 416 | yes, all 1 patch-equivalent | apps/web(2) | feat(play-home): same headline + lede copy as marketing hero |
| `feat/pool-intro-edit` | 2026-05-29 | Tim Thomas | 1 / 422 | yes, all 1 patch-equivalent | apps/web(3) | feat(manage): make the pool intro (topic) editable from the dashboard |
| `feat/pools-playbook-and-hero` | 2026-05-29 | Tim Thomas | 1 / 421 | yes, all 1 patch-equivalent | apps/web(6) apps/marketing(1) | feat(marketing+pools): new hero copy + move playbook to /pools/playbook |
| `fix/bracket-flag-gap-and-border` | 2026-05-29 | Tim Thomas | 1 / 420 | yes, all 1 patch-equivalent | apps/web(1) | fix(bracket): close gap above flag + drop thin white halo on selected pick |
| `fix/drop-multipliers-and-polish-save-panel` | 2026-05-29 | Tim Thomas | 1 / 419 | yes, all 1 patch-equivalent | apps/web(8) | feat(bracket): drop multiplier UI, smarter avatar slot, balanced share CTAs |
| `fix/play-home-lede-overlap` | 2026-05-29 | Tim Thomas | 1 / 414 | yes, all 1 patch-equivalent | apps/web(2) | fix(play-home): stop the two lede paragraphs from overlapping |
| `chore/outreach-store-lists-12-countries` | 2026-05-31 | Tim Thomas | 1 / 411 | yes, all 1 patch-equivalent | tools(24) | feat(outreach): sporting-store cold-email lists for 12 WC2026 countries |
| `docs/contact-form-auto-submission-plan` | 2026-05-31 | Tim Thomas | 1 / 410 | yes, all 1 patch-equivalent | docs/68-contact-form-auto-submission-plan.md(1) | docs: contact-form auto-submission plan (Playwright MCP, human-gated) |
| `chore/hl-setup-state-2026-06-01` | 2026-06-01 | Tim Thomas | 1 / 394 | yes, all 1 patch-equivalent | data(2) | chore(hl): record Tournamental sub-account setup state |
| `chore/move-internal-docs-followup` | 2026-06-01 | Tim Thomas | 1 / 392 | yes, all 1 patch-equivalent | tools(2) docs/59-football-audience-outreach-playbook.md(1) LAUNCH-PLAYBOOK.md(1) | chore(docs): sweep 3 more outreach files into docs/internal |
| `chore/move-internal-docs-out-of-git` | 2026-06-01 | Tim Thomas | 1 / 393 | yes, all 1 patch-equivalent | tools(56) data(2) docs/INTERNAL-DOCS-POLICY.md(1) | chore(docs): move marketing + outreach + HL-campaign assets out of git |
| `docs/gmail-vs-highlevel-strategy` | 2026-06-01 | Tim Thomas | 1 / 405 | yes, all 1 patch-equivalent | docs/74-gmail-vs-highlevel-send-strategy.md(1) | docs: Gmail + HighLevel hybrid send strategy (replaces SmartLead) |
| `docs/highlevel-ui-setup-checklist` | 2026-06-01 | Tim Thomas | 1 / 401 | yes, all 1 patch-equivalent | docs/75-highlevel-ui-setup-checklist.md(1) | docs: HighLevel UI setup checklist (PIT scope blocker workaround) |
| `feat/autopick-preserve-existing-picks` | 2026-06-01 | Tim Thomas | 1 / 390 | yes, all 1 patch-equivalent | apps/web(2) | feat(bracket): auto-pick preserves existing picks by default |
| `feat/bracket-poster-share-card` | 2026-06-01 | Tim Thomas | 1 / 386 | yes, all 1 patch-equivalent | apps/web(4) | feat(share): printable bracket poster + download CTA on /s/<guid> |
| `feat/football-blast-72h-package` | 2026-06-01 | Tim Thomas | 1 / 406 | yes, all 1 patch-equivalent | tools(11) docs/73-playbook-academies.md(1) docs/72-playbook-media.md(1) | feat(outreach): 72-hour football blast package for WC2026 cold campaign |
| `feat/molecule-petri-modal` | 2026-06-01 | Tim Thomas | 1 / 389 | yes, all 1 patch-equivalent | apps/web(2) | feat(molecule): petri-dish modal on page load (empty + incomplete states) |
| `feat/share-landing-bracket-view` | 2026-06-03 | Tim Thomas | 1 / 354 | yes, all 1 patch-equivalent | apps/web(3) | feat(share-landing): read-only full bracket view + 'Manage my bracket' CTA for owner |
| `fix/share-guid-resolver-and-readonly-bracket` | 2026-06-03 | Tim Thomas | 1 / 351 | yes, all 1 patch-equivalent | apps/web(2) | fix(share): pool tile links use stable permalink + harden ReadOnlyBracket |
| `feat/leaderboard-mini-countdown` | 2026-06-05 | Tim Thomas | 1 / 255 | yes, all 1 patch-equivalent | apps/web(2) | feat(leaderboard): replace coarse N-days hero tile with mini D/H/M countdown |
| `feat/marketing-hero-headline` | 2026-06-05 | Tim Thomas | 1 / 241 | yes, all 1 patch-equivalent | apps/marketing(1) | feat(marketing): rewrite hero headline to 'We Game-ify the Tournament' |
| `feat/wordmark-tm` | 2026-06-05 | Tim Thomas | 1 / 247 | yes, all 1 patch-equivalent | apps/web(3) | feat(brand): add (TM) notice to appbar + drawer wordmark |
| `fix/cascade-banner-top-of-round` | 2026-06-05 | Tim Thomas | 2 / 258 | yes, all 2 patch-equivalent | apps/web(4) | fix(bracket): hoist cascade banner to top of round, keep details at bottom |
| `fix/picked-count-excludes-incomplete` | 2026-06-05 | Tim Thomas | 1 / 254 | yes, all 1 patch-equivalent | apps/web(4) | fix(bracket): only count a knockout as picked when both slots are resolved |
| `fix/remove-fullpage-ctas` | 2026-06-05 | Tim Thomas | 1 / 256 | yes, all 1 patch-equivalent | apps/web(2) | fix(overlay): remove dead full-page CTAs from team + match overlays |
| `i18n/nav-the-bet` | 2026-06-05 | Tim Thomas | 1 / 253 | yes, all 1 patch-equivalent | apps/web(22) | i18n(nav): add 'The Bet' translation across all 22 locales |
| `style/thirds-selected-and-bet-cta` | 2026-06-05 | Tim Thomas | 1 / 258 | yes, all 1 patch-equivalent | apps/web(2) | fix(bracket+bet): heavier gold ring on selected Top 8 3rds + dark text on bet CTA |
| `style/wordmark-archivo-black` | 2026-06-05 | Tim Thomas | 1 / 250 | yes, all 1 patch-equivalent | apps/web(4) | style(brand): swap appbar wordmark to Archivo Black (Pantone-adjacent) |
| `style/wordmark-saira-condensed` | 2026-06-05 | Tim Thomas | 1 / 249 | yes, all 1 patch-equivalent | apps/web(6) | style(brand): swap appbar wordmark to Saira variable, weight 300, sentence case |
| `style/wordmark-saira-sizes` | 2026-06-05 | Tim Thomas | 1 / 248 | yes, all 1 patch-equivalent | apps/web(1) | style(brand): wordmark size 1.7rem, FWC2026 sub 0.5em |
| `style/wordmark-tm-desktop-align` | 2026-06-05 | Tim Thomas | 1 / 245 | yes, all 1 patch-equivalent | apps/web(1) | style(brand): desktop TM vertical-align 0.8em (mobile stays 1.1em) |
| `style/wordmark-tm-polish` | 2026-06-05 | Tim Thomas | 1 / 246 | yes, all 1 patch-equivalent | apps/web(1) | style(brand): TM bigger, white, lifted higher above the baseline |

## Partly covered (1)

| Branch | Last commit | Author | Ahead / behind main | Covered by main? | Touches | First commit subject |
| --- | --- | --- | --- | --- | --- | --- |
| `chore/growth-spurt-rename` | 2026-05-25 | Tim Thomas | 3 / 465 | partly, 1 of 3 patch-equivalent | apps/web(30) apps/marketing(3) apps/auth-sms(1) | refactor(branding): Aiva -> Growth Spurt for the CRM/partner references |

## Stale, no equivalent patches (31)

| Branch | Last commit | Author | Ahead / behind main | Covered by main? | Touches | First commit subject |
| --- | --- | --- | --- | --- | --- | --- |
| `feat/avatar-pipeline` | 2026-05-09 | Tim Thomas | 2 / 869 | no equivalent patches; review | apps/web(17) packages/avatar(14) sessions(2) | docs(sessions): link PR #10 in avatar-builder session note |
| `feat/commentary` | 2026-05-09 | Tim Thomas | 4 / 863 | no equivalent patches; review | packages/commentary(10) tasks(9) apps/web(2) | docs(tasks): smooth-motion polish (#0040) and Suno ambience (#0041) |
| `feat/fidelity-phase1-mocap` | 2026-05-09 | Clawd | 4 / 839 | no equivalent patches; review | apps/web(31) packages/avatar(11) sessions(1) | test(fidelity): Phase-1 Playwright E2E + session note |
| `feat/per-match-predictions` | 2026-05-09 | Tim Thomas | 2 / 844 | no equivalent patches; review | apps/web(68) packages/bracket-engine(6) sessions(4) | feat(bracket): per-match predictions with computed standings + tiebreaker |
| `feat/social-distribution-kit` | 2026-05-09 | Clawd | 2 / 849 | no equivalent patches; review | packages/social-cards(32) prompts(20) apps/marketing(15) | fix(marketing): graceful skip if social-cards TS not loadable from node (CI build) |
| `feat/statsbomb-replay-arfr-2022` | 2026-05-09 | Tim Thomas | 5 / 869 | no equivalent patches; review | apps/statsbomb-replay(18) sessions(1) IDEAS.md(1) | docs(statsbomb-replay): README, IDEAS backlog entries, session note |
| `feat/auth-sms-whatsapp` | 2026-05-10 | Clawd | 4 / 827 | no equivalent patches; review | apps/auth-sms(23) apps/web(4) sessions(1) | fix(auth-sms): make pino-pretty dev-only so tests + prod don't import it |
| `feat/dm-otp-channel-expansion` | 2026-05-10 | Growth Spurt | 2 / 792 | no equivalent patches; review | apps/dm-otp(64) sessions(1) docs/22-deployment-and-tunnels.md(1) | chore(gitleaks): allowlist test fixtures using named secret/key constants |
| `feat/dm-otp-login` | 2026-05-10 | Tim | 1 / 798 | no equivalent patches; review | apps/dm-otp(31) sessions(1) pnpm-lock.yaml(1) | feat(dm-otp): user-initiated DM-OTP login across Telegram + WhatsApp + Messenger + Instagram |
| `feat/fidelity-phase3-stadium-crowd` | 2026-05-10 | Clawd | 2 / 820 | no equivalent patches; review | apps/web(28) sessions(1) pnpm-lock.yaml(1) | chore(web): bump postprocessing 6.36.4 → 6.39.1, @react-three/postprocessing 2.16.3 → 2.19.1 |
| `feat/telegram-syndicate-bots` | 2026-05-10 | Clawd | 2 / 829 | no equivalent patches; review | apps/tournament-bot(31) sessions(1) pnpm-lock.yaml(1) | fix(ci): allow better-sqlite3 native build via pnpm.onlyBuiltDependencies |
| `feat/vstamp-receipts` | 2026-05-10 | Clawd | 1 / 817 | no equivalent patches; review | apps/vstamp(27) sessions(1) pnpm-lock.yaml(1) | feat(vstamp): off-chain Merkle + Ed25519-signed prediction receipts |
| `fix/replay-clock-scoreboard-stats-hud` | 2026-05-10 | Clawd | 2 / 811 | no equivalent patches; review | apps/web(10) packages/spec-client(1) | test(e2e): add replay-hud Playwright spec gated on VTORN_RUN_REPLAY_HUD_E2E |
| `chore/rebrand-vtourn-to-tournamental` | 2026-05-11 | Clawd | 2 / 755 | no equivalent patches; review | apps/marketing(40) apps/web(38) apps/tournament-bot(22) | docs(sessions): rebrand sweep session note |
| `chore/safe-dep-bumps` | 2026-05-11 | Tim Atkins | 2 / 695 | no equivalent patches; review | pnpm-lock.yaml(1) packages/social-cards(1) apps/web(1) | chore(deps): pin @astrojs/sitemap at 3.2.1 - 3.7.2 needs astro 5 |
| `chore/tournamental-npm-prep` | 2026-05-11 | Tournamental MCP-Author Agent | 1 / 708 | no equivalent patches; review | apps/web(115) apps/game(14) prompts(13) | chore(release): prep @tournamental/* npm packages for public publish |
| `feat/analytics-tracking-layer` | 2026-05-11 | Tim Anderson | 1 / 744 | no equivalent patches; review | apps/web(13) apps/marketing(6) sessions(2) | feat(web,marketing,docs): GA4 + GTM dataLayer tracking layer |
| `feat/bracket-share-png-mp4-and-save-rename` | 2026-05-11 | Tim Clarkson | 3 / 756 | no equivalent patches; review | apps/web(24) packages/social-cards(16) sessions(1) | docs(sessions): finalise bracket-share PNG/MP4 + lock-rename session note |
| `feat/dm-poll-forwarder` | 2026-05-11 | VTorn Poll Forwarder Builder | 2 / 782 | no equivalent patches; review | apps/dm-poll-forwarder(23) sessions(1) pnpm-lock.yaml(1) | chore: merge main and regenerate lockfile |
| `feat/match-card-flag-bg-and-fixes` | 2026-05-11 | Clawd | 3 / 760 | no equivalent patches; review | apps/web(8) apps/marketing(2) docs/51-platform-vs-campaign-architecture.md(1) | feat(web,docs): bottom-nav on match-preview + share, platform-vs-campaign doc |
| `feat/mcp-server` | 2026-05-11 | Tournamental MCP-Author Agent | 1 / 708 | no equivalent patches; review | apps/mcp(21) sessions(1) pnpm-lock.yaml(1) | feat(mcp): Tournamental Model Context Protocol server (v0.1) |
| `feat/mcp-server-clean` | 2026-05-11 | Tournamental MCP-Author Agent | 1 / 708 | no equivalent patches; review | apps/mcp(21) sessions(1) docs/53-mcp-server.md(1) | feat(mcp): Tournamental Model Context Protocol server (v0.1) |
| `feat/otp-brute-force-protection` | 2026-05-11 | Tim Atkins | 2 / 701 | no equivalent patches; review | apps/auth-sms(8) apps/dm-otp(6) infra(3) | docs(sessions): mark OTP brute-force session as shipped (PR #177) |
| `feat/per-match-pick-popup` | 2026-05-11 | Clawd | 2 / 774 | no equivalent patches; review | apps/web(11) apps/game(5) sessions(1) | feat(web): MatchPickPopup component + team-page wiring + deep links |
| `feat/pr-triage-and-security-pipeline` | 2026-05-11 | Growth Spurt | 3 / 768 | no equivalent patches; review | apps/pr-triage-bot(21) apps/security-watchdog(19) .github(14) | fix(pr-triage-bot): fetch authorAssociation via gh api (not gh pr view --json) |
| `feat/share-card-and-viral-loop` | 2026-05-11 | Clawd | 3 / 756 | no equivalent patches; review | apps/web(14) packages/social-cards(5) sessions(1) | docs(session): mark share-card session PR-open + record outcome |
| `feat/user-registration-and-profiles` | 2026-05-11 | Tim Watson | 1 / 744 | no equivalent patches; review | apps/web(10) apps/game(7) sessions(1) | feat(game,web): user registration + rich progressive profiles |
| `feat/verified-pundit` | 2026-05-11 | Tim | 1 / 789 | no equivalent patches; review | packages/social-cards(12) apps/game(6) apps/web(5) | feat(game,web,social-cards): Verified-Pundit badge + endpoint + leaderboard surfaces |
| `feat/country-gated-pools` | 2026-05-29 | Tim Thomas | 1 / 422 | no equivalent patches; review | docs/68-country-gated-pools.md(1) | docs(syndicates): spec for country-gated public pools |
| `feat/bracket-poster-svg-rewrite` | 2026-06-03 | Tim Thomas | 1 / 382 | no equivalent patches; review | apps/web(1) | wip: bracket poster SVG rewrite (paused for share-landing bracket view) |
| `next15-dev` | 2026-06-05 | Tim Thomas | 10 / 258 | no equivalent patches; review | pnpm-lock.yaml(1) apps/web(1) apps/admin(1) | Merge main into next15-dev (PR #287) |


### Notes on the stale group

Read from each branch's commit list and a check of whether its main
directory exists on main today.

- **Agent sprint branches from 9 to 11 May 2026** (`feat/avatar-pipeline`,
  `feat/fidelity-phase1-mocap`, `feat/fidelity-phase3-stadium-crowd`,
  `fix/replay-clock-scoreboard-stats-hud`, `feat/statsbomb-replay-arfr-2022`,
  `feat/per-match-predictions`, `feat/per-match-pick-popup`,
  `feat/social-distribution-kit`, `feat/share-card-and-viral-loop`,
  `feat/bracket-share-png-mp4-and-save-rename`, `feat/match-card-flag-bg-and-fixes`,
  `feat/user-registration-and-profiles`, `feat/verified-pundit`,
  `feat/analytics-tracking-layer`, `chore/tournamental-npm-prep`,
  `chore/rebrand-vtourn-to-tournamental`, `chore/safe-dep-bumps`): each
  is one to four commits whose feature exists on main under a different
  history (the directories they build, `apps/web`, `packages/social-cards`,
  `apps/statsbomb-replay`, `apps/game`, are all on main and have moved
  on by 700 to 870 commits). Nothing to salvage. Delete.
- **Service branches whose app is on main** (`feat/auth-sms-whatsapp`,
  `feat/otp-brute-force-protection` (its own note says shipped in
  PR #177), `feat/dm-otp-channel-expansion`, `feat/dm-otp-login`,
  `feat/dm-poll-forwarder`, `feat/telegram-syndicate-bots`,
  `feat/vstamp-receipts`, `feat/mcp-server`, `feat/mcp-server-clean`,
  `feat/pr-triage-and-security-pipeline`): `apps/auth-sms`, `apps/dm-otp`,
  `apps/dm-poll-forwarder`, `apps/tournament-bot`, `apps/vstamp`,
  `apps/mcp` and `apps/pr-triage-bot` all exist on main. These were
  merged by squash or re-landed, so `git cherry` cannot see it. Delete.
- **`feat/commentary`** (9 May): the only branch whose package,
  `packages/commentary` (event-template commentary generator and TTS
  scheduler), is not on main at all. Four commits, three of them docs
  and chores. If commentary is still wanted for the renderer, the
  generator is the one thing worth lifting into a fresh branch from
  main; otherwise delete.
- **`chore/growth-spurt-rename`** (25 May, partly covered): one of three
  commits is on main. The other two (pool-page CTA renames and the pool
  slug in the magic link) are both visible on main in their current
  form, so the branch is superseded. Delete.
- **`feat/country-gated-pools`** (29 May): a single docs commit; the spec file is not on main; copy the one file into a docs PR if the idea is still wanted, then delete the branch.
- **`feat/bracket-poster-svg-rewrite`** (3 June): one WIP commit on one
  file, paused by its own message. Delete, or note the idea in IDEAS.md.
- **`next15-dev`** (5 June, 10 commits, Tim's): the Next 15 and React 19
  dev-only upgrade branch, last synced with main in PR #287. Main is now
  258 commits ahead and still on Next 14. Keep only if the upgrade is
  still planned; it will need redoing from main either way, so the
  branch is a reference, not a base.

## Opened today (4)

| Branch | Last commit | Author | Ahead / behind main | Covered by main? | Touches | First commit subject |
| --- | --- | --- | --- | --- | --- | --- |
| `docs/host-modes-runbook` | 2026-10-17 | Growth Spurt | 1 / 0 | no equivalent patches; review | sessions(1) docs/runbooks(1) | docs(runbooks): tournament host modes, from the code |
| `docs/refresh-entrypoints` | 2026-10-17 | Growth Spurt | 1 / 0 | no equivalent patches; review | sessions(1) README.md(1) CLAUDE.md(1) | docs(repo): refresh CLAUDE.md and README to the October 2026 state |
| `review/register-interest-security` | 2026-10-17 | Growth Spurt | 1 / 0 | no equivalent patches; review | apps/web(8) sessions(1) docs/reviews(1) | fix(web): harden register-interest, review write-up and tests |
| `test/archive-middleware-host-modes` | 2026-10-17 | Growth Spurt | 1 / 0 | no equivalent patches; review | apps/web(3) sessions(1) | test(web): cover host-mode routing, fix locale prefix bypass |

## Dependabot (9)

| Branch | Last commit | Author | Ahead / behind main | Covered by main? | Touches | First commit subject |
| --- | --- | --- | --- | --- | --- | --- |
| `dependabot/github_actions/actions/download-artifact-8` | 2026-05-17 | dependabot[bot] | 1 / 632 | no equivalent patches; review | .github(1) | chore(deps): Bump actions/download-artifact from 4 to 8 |
| `dependabot/github_actions/actions/github-script-9` | 2026-05-17 | dependabot[bot] | 1 / 632 | no equivalent patches; review | .github(1) | chore(deps): Bump actions/github-script from 8 to 9 |
| `dependabot/github_actions/actions/upload-artifact-7` | 2026-05-17 | dependabot[bot] | 1 / 632 | no equivalent patches; review | .github(3) | chore(deps): Bump actions/upload-artifact from 4 to 7 |
| `dependabot/github_actions/crazy-max/ghaction-github-labeler-6` | 2026-05-17 | dependabot[bot] | 1 / 632 | no equivalent patches; review | .github(1) | chore(deps): Bump crazy-max/ghaction-github-labeler from 5 to 6 |
| `dependabot/github_actions/google/osv-scanner-action-2.3.8` | 2026-05-17 | dependabot[bot] | 1 / 632 | no equivalent patches; review | .github(2) | chore(deps): Bump google/osv-scanner-action from 1.9.2 to 2.3.8 |
| `dependabot/npm_and_yarn/capacitor/android-8.3.4` | 2026-05-17 | dependabot[bot] | 1 / 632 | no equivalent patches; review | pnpm-lock.yaml(1) apps/native(1) | chore(deps): Bump @capacitor/android from 6.2.1 to 8.3.4 |
| `dependabot/npm_and_yarn/noble/curves-2.2.0` | 2026-05-17 | dependabot[bot] | 1 / 632 | no equivalent patches; review | pnpm-lock.yaml(1) apps/vstamp(1) | chore(deps): Bump @noble/curves from 1.9.7 to 2.2.0 |
| `dependabot/npm_and_yarn/undici-8.3.0` | 2026-05-17 | dependabot[bot] | 1 / 632 | no equivalent patches; review | pnpm-lock.yaml(1) apps/wc2026-data(1) apps/odds-ingest(1) | chore(deps): Bump undici from 6.25.0 to 8.3.0 |
| `dependabot/npm_and_yarn/fastify/cors-11.2.0` | 2026-06-03 | dependabot[bot] | 1 / 319 | no equivalent patches; review | pnpm-lock.yaml(1) apps/vstamp(1) apps/social-publisher(1) | chore(deps): Bump @fastify/cors from 10.1.0 to 11.2.0 |
