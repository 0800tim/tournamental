# @tournamental/social-cards

[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Framework-agnostic OG image, podium share card and bracket-reveal video
generator for Tournamental. Pure TS, runs in Node and any modern
server runtime that supports `satori`, `@resvg/resvg-js` and
`@napi-rs/canvas`.

The package now ships two card families side by side:

1. **Editorial presets** (gold + charcoal + Fraunces), the new direction
   shipped 2026-05-21 alongside the syndicate OG route. Reach for these
   for all new share surfaces.
2. **Legacy cards** (sky-blue + flame), the original satori family.
   Still typechecks and tests so existing consumers keep working, but
   deprecated for new work.

Brand reference: [docs/BRAND.md](../../docs/BRAND.md) (gold scale,
typography, motion grammar). The editorial presets mirror the visual
grammar of `apps/web/app/api/og/syndicate/route.ts` exactly.

## Surface

### Editorial presets (new)

Each preset exports a typed `render(args)` returning the raw PNG bytes.

- `presets.predictionPick`     -- a user saves a single high-impact pick.
- `presets.leaderboardRankUp`  -- a user climbs a leaderboard position.
- `presets.perfectWeek`        -- a user clears a 7-day correct-pick streak.
- `presets.syndicateInvite`    -- generic pool-share card; matches the
  `/api/og/syndicate` route.

### Editorial primitives

The shared design-system primitives the presets compose from. Import
these directly to build a new editorial surface.

- `goldBall(size)`             -- inline-SVG gold lattice ball mark.
- `dateline(text, { size })`   -- gold mono caption with leading hairline.
- `editorialHeadline(text, size, { italic })` -- Fraunces 500 display,
  optional italic-gold emphasis fragment, auto-shrinks for long lines.
- `tabularStatRow(cells, size)` -- 3-up stat row with hairline rule.
- `charcoalCanvas({ size, children })` -- flat `#15151a` page root.
- `footerUrl(text, size)`      -- gold mono footer URL.
- `loadEditorialFonts()` + `editorialFontSpecs(bundle)` -- font bundle
  for the satori call.

### Theme tokens

- `gold`     -- 50, 100, 200, 300, 400, 500, 600, 700. Reach for 400
                first.
- `charcoal` -- `bg`, `bgElev`, `bgElev2`, `border`, `borderStrong`,
                `fg`, `fgMuted`, `fgStrong`.
- `poolUrlLabel(slug)` -- builds `play.tournamental.com/s/<slug>`.

### Legacy (deprecated for new work)

Kept for back-compat. See **Migration from sky-blue** below.

- `cards`  -- satori-based card builders (bracket, goal-clip,
  leaderboard, badge, referral, tournament recap, pundit badge).
- `theme.palette.ink`, `palette.accent`, `palette.flame`,
  `palette.emerald` -- the old colour ramps.
- `canvas` -- napi-rs canvas renderers for the champion-centric bracket
  share card and animated MP4 frames.
- `video`  -- bracket-reveal video composer.

Full background:
[docs/14-clip-generation-and-social.md](https://github.com/0800tim/tournamental/blob/main/docs/14-clip-generation-and-social.md).

## Install

```bash
npm install @tournamental/social-cards
```

## 30-second example: an editorial preset

```ts
import { promises as fs } from "node:fs";
import { presets } from "@tournamental/social-cards";

// Landscape (1200x630) prediction pick
const og = await presets.predictionPick.render({
  userHandle: "messi-fan",
  pickedOn: "2026-05-21",
  pickTeam: "Argentina",
  opponentTeam: "Brazil",
  oddsPercent: 38,
  picksSaved: 12,
  matchNumber: "Match 47 of 64",
  poolSlug: "casa-rosada",
  size: "og",
});
await fs.writeFile("prediction-pick-og.png", og);

// Vertical story (1080x1920) variant for Instagram / TikTok
const story = await presets.predictionPick.render({
  userHandle: "messi-fan",
  pickedOn: "2026-05-21",
  pickTeam: "Argentina",
  opponentTeam: "Brazil",
  oddsPercent: 38,
  picksSaved: 12,
  matchNumber: "Match 47 of 64",
  poolSlug: "casa-rosada",
  size: "story",
});
await fs.writeFile("prediction-pick-story.png", story);
```

The other three presets take the same `size: "og" | "story"` switch and
return the same `Promise<Buffer>` shape.

## Sample images

Snapshots committed under
[`.playwright-mcp/og-samples/phase3e/`](../../.playwright-mcp/og-samples/phase3e/),
emitted by the `__tests__/presets.test.ts` smoke run on every CI tick:

| Preset                 | Landscape (1200x630)                | Story (1080x1920)                      |
|------------------------|-------------------------------------|----------------------------------------|
| prediction-pick        | `prediction-pick-og.png`            | `prediction-pick-story.png`            |
| leaderboard-rank-up    | `leaderboard-rank-up-og.png`        | `leaderboard-rank-up-story.png`        |
| perfect-week           | `perfect-week-og.png`               | `perfect-week-story.png`               |
| syndicate-invite       | `syndicate-invite-og.png`           | `syndicate-invite-story.png`           |

## Legacy 30-second example

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

## Migration from sky-blue

The 2026-05-21 editorial pass replaces the sky-blue + flame + navy-radial
look with gold + charcoal + Fraunces. The legacy helpers still export
under their old names so older cards keep typechecking, but new work
should use the editorial primitives.

| Old import                                       | New equivalent                                          |
|--------------------------------------------------|---------------------------------------------------------|
| `palette.ink[900]` (page background)             | `charcoal.bg`                                           |
| `palette.ink[800]` (card surface)                | `charcoal.bgElev`                                       |
| `palette.ink[200]` (muted body)                  | `charcoal.fgMuted`                                      |
| `palette.accent[500]` (sky-blue accent)          | `gold[400]`                                             |
| `palette.flame[500]` (flame accent)              | `gold[400]`                                             |
| `palette.emerald[500]` (chip green)              | Drop the chip; gold dateline says "fresh" already       |
| sky-blue V-mark chip                             | `goldBall(size)`                                        |
| "FREE TO PLAY" pill                              | `tabularStatRow([{ value: "Free", label: "Entry fee" }])` |
| navy-radial gradient page background             | `charcoalCanvas({ size, children })` (flat charcoal)    |

If you are mid-migration: import both palettes in the same file is fine,
the legacy ramps stay on the `palette` namespace so nothing breaks at
the import site.

## Fonts

Editorial presets vendor static Fraunces cuts (500, 500-italic, 700) at
[`fonts/`](./fonts/) and pick up a system mono fallback
(`DejaVuSansMono.ttf` or equivalent). Legacy cards (Satori plus resvg)
need Inter, Noto Naskh Arabic and Noto Sans JP files; see
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
