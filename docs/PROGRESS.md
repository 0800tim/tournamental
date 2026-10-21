# Progress log

Short, public-safe notes on what shipped. Internal briefs and metrics
stay out of this file.

## 2026-10-20 · Review round merged and deployed

- Twenty-seven draft PRs from the October review round merged in one
  pass and deployed: the hub form now has a global submission brake on
  top of the per-address limits, security headers on every page
  (framing blocked except for the embed routes and the archive host,
  with a report-only content security policy to watch before it is
  enforced), the admin console masks phone numbers and emails with an
  audited reveal, the archive shows round of 32 results and finished
  knockout rounds in order, the molecule consensus bracket carries the
  eight best third-placed teams through to the final, and the game
  service can settle a bronze final with the stage and method it was
  decided by.
- Accessibility pass on the hub form, countdown, drawer, dock and
  archive shell (focus order, announcements, labels).
- Workspace CI is green for the first time since June: the web, game,
  admin, news aggregator, auth and bot SDK test suites all pass, and
  every package typechecks against source.
- Design and review notes added under `docs/reviews/` and
  `docs/design/`: merge order, code review, register-interest review,
  retention and consent paper, incident runbooks, Dependabot
  verification, and the Rugby World Cup 2027 engine readiness note.

## 2026-10-16 · FWC 2026 archived, play becomes the hub, site rewritten

- **fwc2026.tournamental.com** now serves the FIFA World Cup 2026™ app as a
  read-only archive: final result, podium, engagement as percentages,
  final standings as ranks, every settled match. Sign-in, saves, joins
  and pool creation are closed on that host. `wc2026` and `2026wc`
  redirect there.
- **play.tournamental.com** is a hub while no tournament is active: the
  Rugby World Cup 2027™ hero, a register-interest form (stored locally
  and mirrored to the CRM, with a personal invite link per signup), and
  cards for previous tournaments. The tournament registry at
  `apps/web/lib/tournaments/registry.ts` decides which mode each host
  is in, so the next active tournament takes over play with a one-line
  change.
- **tournamental.com** is now about the platform (predictions, pools,
  bracket bot, leaderboards, verifiable picks) with an Archive
  Tournaments menu and a "Coming next: Rugby World Cup 2027" card.
  `/world-cup-2026` redirects to `/archive/fwc-2026`.
