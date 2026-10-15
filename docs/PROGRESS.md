# Progress log

Short, public-safe notes on what shipped. Internal briefs and metrics
stay out of this file.

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
