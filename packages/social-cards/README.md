# @tournamental/social-cards

[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Framework-agnostic OG image, podium share card and bracket-reveal video
generator for Tournamental. Pure TS, runs in Node and any modern
server runtime that supports `satori`, `@resvg/resvg-js` and
`@napi-rs/canvas`.

Surface:

- `cards` -- satori-based card builders (bracket, goal-clip, leaderboard,
  badge, referral, tournament recap, pundit badge).
- `theme` -- shared palette, sizes and wordmark constants.
- `fonts` -- font loaders with locale-aware fallback (Inter, Noto Naskh
  Arabic, Noto Sans JP).
- `canvas` -- napi-rs canvas renderers for the champion-centric bracket
  share card and animated MP4 frames.
- `video` -- bracket-reveal video composer.

Full background:
[docs/14-clip-generation-and-social.md](https://github.com/0800tim/tournamental/blob/main/docs/14-clip-generation-and-social.md).

## Install

```bash
npm install @tournamental/social-cards
```

## 30-second example

```ts
import { promises as fs } from "node:fs";
import { generateOG, type CardInput } from "@tournamental/social-cards";

const input: CardInput = {
  kind: "goal-clip",
  data: {
    userHandle: "messi-fan",
    userId: "u_01HXP4...",
    tournamentName: "World Cup 2026",
    matchLabel: "ARG vs FRA",
    scorer: "Lionel Messi",
    scoreTeam0: 3,
    scoreTeam1: 2,
    team0Code: "ARG",
    team1Code: "FRA",
    minute: 78,
    predictedByUser: true,
  },
};

const { og, story } = await generateOG(input);
await fs.writeFile("goal-og.png", og.png);
await fs.writeFile("goal-story.png", story.png);
```

## Fonts

Tests and JSDL builders run font-free. Rasterisation (Satori plus resvg)
needs Inter, Noto Naskh Arabic and Noto Sans JP files. See
[fonts/README.md](./fonts/README.md) for sourcing instructions. The
`families` and `locale` helpers in `./fonts` pick the right face.

## Open source and contributor revenue

Tournamental is Apache-2.0 licensed. Contributors share platform revenue
through Drips Network. See
[docs/19-open-source-and-contributor-revenue.md](https://github.com/0800tim/tournamental/blob/main/docs/19-open-source-and-contributor-revenue.md).

## Repo and docs

- Source: <https://github.com/0800tim/tournamental>
- Site: <https://tournamental.com>
- Issues: <https://github.com/0800tim/tournamental/issues>

## Licence

Apache-2.0. See [LICENSE](./LICENSE).
