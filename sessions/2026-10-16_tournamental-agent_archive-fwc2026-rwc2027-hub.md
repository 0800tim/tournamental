# 2026-10-16 · Tournamental agent · FWC 2026 archive, play hub, platform marketing, RWC 2027 plan

status: in-progress
branch: feat/archive-fwc2026-rwc2027-hub
brief: docs/briefs/2026-10-15-archive-fwc2026-and-rwc2027-index.md (on disk, not in git)
plan: docs/briefs/2026-10-15-plan-archive-hub-marketing.md (on disk, not in git)

## Plan

1. Archive the finished FIFA World Cup 2026 app read-only at
   fwc2026.tournamental.com (same Next process, host-routed), counts as
   percentages or ranks only, no live CTAs.
2. Turn play.tournamental.com into a hub while no tournament is active:
   Rugby World Cup 2027 hero, register-interest form that stores to
   game.db and HighLevel, previous-tournament cards.
3. Rewrite tournamental.com around the platform with an Archive
   Tournaments menu and the RWC 2027 card.
4. RWC 2027 growth plan, calendar, market map and packs in the internal
   (gitignored) folder docs/internal/rwc2027/.

## Decisions

- Tournament registry (`apps/web/lib/tournaments/registry.ts`) decides
  host behaviour: active -> play serves it; none active -> play is the
  hub; archived -> own hostname in read-only mode. Flipping a status is
  the only change needed to take the next tournament live.
- Archive mode is a request header set by middleware, surfaced as
  `<html data-archive>` plus a React context. Mutating requests on an
  archive host get 403. Blocked live-only paths 302 to the archive home.
- wc2026 and 2026wc now 301 to fwc2026 (they used to 301 to play).
- Register interest: SQLite row (migration 0017, idempotent DDL also
  run by the web app) plus HighLevel upsert tagged
  `register_interest`, `rwc2027_interest`, `tournament:rwc-2027`. Each
  signup gets a personal invite code (`/i/<code>` -> hub `?ref=`), the
  seed of the referral loop. No messages are sent by the app.
- Public engagement figures are percentages derived once from the
  production DB and hardcoded in the registry; raw counts stay internal.
- docs/briefs/ is now gitignored (it quotes internal metrics). The RWC
  2027 marketing material lives in docs/internal/rwc2027/ per
  docs/INTERNAL-DOCS-POLICY.md.
- Marketing OG card PNGs were already missing before this session
  (build-og-cards.mjs cannot import the TS social-cards package under
  plain node). Left as a follow-up; the RWC 2027 card is a static PNG.

## Done so far

- DNS CNAME fwc2026.tournamental.com -> tournamental tunnel; ingress
  added to ~/.cloudflared/config-tournamental.yml; tunnel restarted.
- Marketing site rewritten and rebuilt (live: dist is the nginx mount).
- Web app: registry, middleware, archive layer, hub, archive home,
  register-interest API, count and CTA patches.
- Internal: growth plan, nations market map, marketing calendar, lead
  list templates and sourcing guide.

## Next steps

- Build + restart tournamental-web, verify on live hosts, screenshots.
- Review passes (copy, mobile, a11y, SEO), then PR.
- Packs per audience under docs/internal/rwc2027/packs/.
