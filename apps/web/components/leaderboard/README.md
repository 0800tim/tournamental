# Draft leaderboards + syndicate visual system

This directory hosts the **mock-but-shippable** leaderboard component set that the marketing surfaces use until the real picks DB starts ingesting at tournament kickoff (2026-06-11).

It is intentionally _load-bearing_ for launch: every public surface that needs to look "alive" before there's real data to rank pulls from these primitives, and every such surface is honest about the placeholder state via the `<DraftPreviewBanner>` and `<DraftWatermark>` from `components/mock/`.

## Tenet: honest by default

Two non-negotiables, both enforced visually:

1. **Banner above every mock surface**, `<DraftPreviewBanner>` is a yellow pill above the card grid that reads "Preview data. Real leaderboards activate at kickoff (11 Jun 2026). Names, avatars, and points shown are illustrative." Dismissible per browser via the `tournamental:draft-banner-dismissed:v1` localStorage flag.
2. **Watermark behind every mock chart**, `<DraftWatermark>` wraps the chart and overlays a low-opacity "PREVIEW" SVG pattern at ~8% opacity, repeated at -30°.

You break the tenet by removing either one. Don't.

## Why DiceBear avataaars (and not realistic faces)

`lib/mock/avatar.ts` uses [DiceBear v9 avataaars](https://www.dicebear.com/styles/avataaars/), illustrated, cartoonish, _obviously_ not photographs. We chose this style on purpose:

- **Headshot generators (ThisPersonDoesNotExist, etc.) are deceptive at small sizes.** A photoreal face on a leaderboard row reads as "real user" by default, which violates the tenet.
- Avataaars produce a recognisable illustrated style that signals "placeholder" at a glance without needing extra copy.
- The endpoint is free, public, no API key, deterministic from a seed string.

Fallback: `initialsAvatarUrl(seed)` returns a coloured monogram when avataaars returns empty (single-character seeds).

## How to swap the mock data for real

The component shapes are stable. To go live with the real `/api/leaderboard` endpoint:

1. In `app/leaderboard/page.tsx`, replace the `mockLeaderboardMembers(null, 50)` call with the real `fetchLeaderboard()` (server-side, ideally, switch the route to a server component and pass `members` as a prop).
2. Drop the `<DraftPreviewBanner />` and the `<DraftWatermark>` wrappers from every page that consumed them.
3. Stop importing from `lib/mock/`. The `MockMember` interface is the contract, the real response should match it 1:1 (or you map at the boundary).
4. Delete `draftMark` defaults from `<Leaderboard>`, or pass `draftMark={false}` from the call site if you'd rather keep the prop for future preview uses.

That's it. No `<Leaderboard>` component changes required.

## Baked example syndicates

`lib/mock/syndicate.ts` ships six rich-shape syndicates so designers, PMs, and screenshots all reference the same set:

| Slug | Name | Owner | Members | Region | Vibe |
| --- | --- | --- | ---: | --- | --- |
| `magnus-pool` | Magnus's Pool | `@magnus_p` | 47 | Copenhagen, DK | Sky-blue + gold |
| `tackle-house` | The Tackle House | `@liam_w` | 128 | Manchester, UK | Bronze + emerald |
| `auckland-footy-bunch` | Auckland Footy Bunch | `@harry_w` | 22 | Auckland, NZ | Emerald + sky |
| `office-wc-2026` | Office WC 2026 | `@aaliyah_k` | 64 | Brooklyn, NY | Gold + flame |
| `futbol-club-familia` | Fútbol Club Familia | `@diego_r` | 38 | Buenos Aires, AR | Sky + silver |
| `london-pundits` | London Pundits | `@ellie_b` | 312 | London, UK | Silver + gold |

These are the syndicates parallel agent #67's `/s/[guid]` route should default-link to in dev.

## Components shipped

- `Leaderboard`, the polished social rank card.
- `PointsSparkline`, inline 60×20 SVG sparkline.
- `PicksDistributionChart`, horizontal stacked bar of pool picks per team.
- `StageProgressChart`, 2-series "you vs the pool" line chart.

And in `components/syndicate/`:

- `SyndicateHero`
- `SyndicateLeaderboardSection`
- `MembersGrid`
- `SyndicateTrophyShelf`
- `SyndicateActivityFeed`

## Determinism contract

The generators in `lib/mock/` are pure and seeded. `mockLeaderboardMembers("x", 50)` returns exactly the same shape on every call, in every process, under SSR + CSR. Tests in `__tests__/mock-leaderboard.test.ts` lock that contract.

If you change any generator output, expect snapshot churn, that's the trade for stability.
