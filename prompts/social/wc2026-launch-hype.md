# WC2026 launch hype — copy templates

> Surface: X / Threads / LinkedIn / Telegram broadcast / Discord.
> Event: `landing_page_live` (one-time campaign), then daily countdown
> ticks until 2026-06-11.

These templates promote the WC2026 hype landing at
`https://2026wc.vtourn.com/`. The landing serves the bracket builder, the
syndicate signup form, and the tournament dashboard preview. Schedule
hourly through the publisher (`apps/social-publisher`, doc 27).

---

## X / Threads — launch announcement

```
33 days until the world predicts the World Cup.

VTourn is the open-source bracket game for the 2026 FIFA World Cup.
48 teams. 104 matches. Free to play. Earlier picks score bigger.

Lock yours: 2026wc.vtourn.com
```

Hashtags: `#FIFAWorldCup2026 #WorldCup26 #VTourn`.
Card: `og/landing/hero-countdown.png` (generated server-side from the
hero section, captures the live countdown at render time).

## X / Threads — daily countdown tick

> Schedule: daily at 09:00 in user's locale, from `T-30d` to `T-1d`.

```
{{countdown.days}} days until kickoff.

{{stats.picks_locked_total}} picks already locked. {{stats.syndicates_total}} syndicates.

Get yours in early — multiplier drops to 1.0× at kickoff:
2026wc.vtourn.com
```

## X — early-lock multiplier nudge (T-21d)

```
A locked Senegal-to-the-quarters pick today scores 4.2×.
At kickoff it scores 1.0×.

This is the only window. Lock the contrarian picks:
2026wc.vtourn.com/world-cup-2026
```

## LinkedIn — office syndicate angle

```
The 2026 World Cup is 33 days out. Best office sweepstakes you'll
run all year — in 90 seconds:

1. Open 2026wc.vtourn.com
2. Reserve your office syndicate name
3. Email the link to the floor

Free. No login. Open source. Every desk gets a country, the leaderboard
runs itself, and the prize pool is whatever you make of it.
```

## Telegram broadcast — 7-day warning

```
🏆 ONE WEEK to FIFA WC 2026 kickoff.

VTourn is the bracket-prediction game built for the tournament.
48 teams, 104 matches, free to play, free to syndicate.

Lock your bracket here → 2026wc.vtourn.com
Run an office pool here → 2026wc.vtourn.com#syndicates

We open the live tournament dashboard at the first whistle, June 11.
```

## Discord — server announcement

```
**:soccer: VTourn WC2026 is live :soccer:**

Predict every match of the 2026 FIFA World Cup.
- Free to play, free to syndicate
- Open source, Apache 2.0
- Earlier picks → bigger multiplier
- {{countdown.days}} days to kickoff

Try the bracket builder: <https://2026wc.vtourn.com/world-cup-2026>
Run a syndicate: <https://2026wc.vtourn.com#syndicates>
```

---

## CTA conventions

- Apex CTA: `https://2026wc.vtourn.com/` (host-rewritten to the landing).
- Bracket builder: `https://2026wc.vtourn.com/world-cup-2026`.
- Syndicate anchor: `https://2026wc.vtourn.com/#syndicates` (deep-link
  to the syndicate form section — see `apps/web/app/world-cup-2026/landing/page.tsx`).
- UTM: `?utm_source={{platform}}&utm_campaign=wc2026-launch&utm_content={{template_id}}`.

## Optimal posting times

- Launch announcement: a single send across all surfaces, T-33d.
- Daily countdown tick: from T-30d, daily, 09:00 local.
- Early-lock nudge: T-21d, T-14d, T-7d, T-3d, T-24h.
- Pre-kick reminder: T-2h.
- Live tournament: pivot to the per-match templates in this directory.

## Variables

Pulled from `prompts/social/_variables.md` (countdown.days, stats.\*,
cta.\*, tournament.\*) — the publisher fills these at render time.
