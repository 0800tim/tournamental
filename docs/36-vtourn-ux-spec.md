# 36 — VTourn UX redesign spec

> The synthesis. Doc [35](35-competitor-ux-dossier.md) was research; this doc is action. Every recommendation here is implementable in our existing stack (Next.js + React Three Fiber + Tailwind + the `@vtorn/bracket-engine` types) and references the specific components we already ship so the next builder agent can extend rather than rewrite.
>
> Filename note: this lives at `36-` because `25-keys-and-secrets-required.md` already occupies the `25-` slot.

## North star

> **A prediction game that looks like the World Cup feels — flags, kit colours, 48 nations on the pitch — and that lets a casual fan make their first pick in under five seconds.**

Three sentences expanded:

1. **Flags are the hero**. Every screen leads with a big circular flag. Our existing `TeamFlag` already supports this — we just need to lift it harder.
2. **Kit colours theme everything**. Group cards, match rows, knockout cards, leaderboard rows all pick up the home and away kit primaries. Existing CSS variables `--mpr-home-accent`, `--mpr-away-accent`, `--km-home-accent`, `--km-away-accent` are the wiring; we need to extend the language across the rest of the app.
3. **Five seconds to first pick**. No login, no account, no email field, no "join a league" gate. Cold traffic lands on `/world-cup-2026`, taps a flag in any group card, and is now playing.

---

## Pages we should redesign or add

### A. `/team/[code]` — NEW

Currently missing entirely. The single biggest unlock from the dossier (FotMob's team page at <https://www.fotmob.com/teams/9919/squad/start> and OneFootball's team-coloured headers per [doc 35 §5](35-competitor-ux-dossier.md#5-onefootball)).

**Purpose**:
- SEO: 48 high-quality international team pages = 48 ranking surfaces for "World Cup 2026 [team] predictions".
- Sharing: a team page is shareable in a way that a group card isn't.
- Onboarding: deep-linking from social ("see Argentina's bracket page") becomes possible.

**Components to add**:
- `TeamHeroHeader` (new) — kit-coloured gradient strip + big circular flag + FIFA-rank chip.
- `TeamFormDots` (new) — 5-pill last-5 form (W/D/L colours).
- `TeamHeadToHeadPill` (new) — used on the team page's "Coming up" section.
- `TeamSquadGrid` (new) — 4 position groups, photo + shirt number + name + nationality flag.
- Reuse `TeamFlag` at `size="xl"` `shape="circle"` for the hero.

### B. `/match/[id]` — ENRICHMENT

Today this route is the renderer-mounted live match view (per [doc 04](04-renderer.md)). The pre-match enrichment screen is a different concern and should sit at `/match/[id]/preview` or be a tab on the same route.

**Pattern**: borrow FotMob's five-tab match detail (Facts / Stats / Lineup / H2H / Predict — see [doc 35 §4](35-competitor-ux-dossier.md#4-fotmob)). For VTourn pre-match the relevant tabs are:

- **Predict** (default) — embed `MatchPredictionRow` (plus odds via existing `OddsChip`).
- **H2H** — head-to-head record, last meetings.
- **Form** — last-5 form dots for each side.
- **Lineup** (where available) — predicted XI.
- **Stats** — pre-match xG, possession averages, group standing context.

### C. Group cards — REDESIGN

Existing `GroupCard.tsx` works but it's a list of six prediction rows plus a standings table. Push it further:

- Group header has a **kit-spectrum strip** of the four nations' primary colours, gradient-blended.
- Each `MatchPredictionRow` keeps the two-flag-and-draw-pill UX but gets new ornament: H2H pill + form dots per team.
- Standings table picks up team-coloured row backgrounds (5% tint) so each team is visually anchored to its kit colour even when the user scans the table.

### D. Knockout cards — REDESIGN

Existing `KnockoutMatch.tsx` is clean but uses small flags. Lift to a more dramatic, card-shaped layout:

- Two circular flags side-by-side, larger.
- A "VS" treatment in the centre rather than just whitespace.
- Selection treatment: kit-coloured ring on the chosen flag, the other flag dimmed and desaturated.
- Kit-coloured selection ring derives from `--km-home-accent` / `--km-away-accent` (already wired).

### E. Leaderboard — REDESIGN

Existing `LeaderboardPreview` has the right tab structure (Global / Country / Friends / Affiliate, per `apps/web/app/world-cup-2026/landing/_components/LeaderboardPreview.tsx`). Build on it:

- Each row: rank · avatar · username · points · delta · (mobile-collapsed) percentile.
- Rank-change motion: when a row moves up, brief upward-arrow flash; when down, brief downward arrow. Inspired by ESPN BracketCast's "live results in one spot" pattern (per [doc 35 §2](35-competitor-ux-dossier.md#2-espn-tournament-challenge)).
- Avatars sourced from the Humanness-Score-verified identity scaffolding in [doc 20](20-identity-humanness-bots.md).

---

## Concrete component specs

### `TeamFlag` — extend (do not break)

Existing component at `apps/web/components/bracket/TeamFlag.tsx`. Already supports `shape="circle"` and four sizes. **No breaking changes**; add:

- New `xxl` size — 144px circle for the team-hero on `/team/[code]`. Add to both `SIZE` and `CIRCLE_SIZE` maps.
- New `selectionRing` prop (boolean): when true and `shape="circle"`, render a 4px ring in the team's accent colour around the flag. Used on bracket-pick affordances and on the `/team/[code]` hero.
- New `dim` prop (boolean): when true, applies `filter: grayscale(0.6) opacity(0.5)` so unselected sides in a knockout match visibly recede.

```tsx
// Extended Props (proposed, additive only)
type Props = {
  code: string;
  name?: string;
  accentColor?: string;
  size?: "sm" | "md" | "lg" | "xl" | "xxl";   // <- xxl added
  sparkle?: boolean;
  shape?: "rect" | "circle";
  selectionRing?: boolean;                     // <- new
  dim?: boolean;                               // <- new
  className?: string;
};
```

### `TeamColorStrip` — NEW

A 6px horizontal gradient strip painted from a team's `kit.primary` and `kit.secondary` colours. Used as the top edge of `/team/[code]`, of group cards, of knockout cards.

```tsx
type TeamColorStripProps = {
  primary: string;          // "#75AADB" for ARG
  secondary?: string;       // "#FFFFFF"; defaults to colour-mix(white, primary, 30%)
  height?: number;          // px, default 6
  direction?: "horizontal" | "diagonal"; // default "horizontal"
};
```

Implementation: a single `<span>` with `background: linear-gradient(...)` — a few lines, no new deps.

### `RankChip` — NEW

A pill displaying FIFA rank in the form `#3 FIFA`. Sits on the team hero next to the flag. Inspired by Sorare's scarcity indicator (per [doc 35 §10](35-competitor-ux-dossier.md#10-sorare)).

```tsx
type RankChipProps = {
  rank: number;             // 1 to 211
  delta?: number;           // optional last-month change, eg -2 (improved 2 places)
  variant?: "fifa" | "elo" | "vstamp";   // labels the chip
};
```

Visual: `#3 FIFA  ▲2` in OneFootball-styled neutral grey with hype-coloured delta if present.

### `FormDots` — NEW

Five small pills representing the last 5 results. Standard across FlashScore and FotMob (per [doc 35 §6](35-competitor-ux-dossier.md#6-flashscore) and [§4](35-competitor-ux-dossier.md#4-fotmob)).

```tsx
type Result = "W" | "D" | "L";
type FormDotsProps = {
  results: readonly Result[];   // most recent first; up to 5
  size?: "sm" | "md";           // sm=10px, md=14px
};
```

Visual:
- Win: green fill (`#22c55e`).
- Draw: neutral fill (`#94a3b8`).
- Loss: red fill (`#ef4444`).
- Each pill is a 14px circle (md) with the W/D/L letter in white, or a colour-only dot (sm).

### `HeadToHeadPill` — NEW

A horizontal pill showing the head-to-head record between two teams. Used on match cards on the team page and on `/match/[id]`.

```tsx
type HeadToHeadPillProps = {
  home: { code: string; wins: number };
  away: { code: string; wins: number };
  draws: number;
  total?: number;             // optional, computed if absent
  variant?: "compact" | "wide";
};
```

Visual (wide):
```
[ARG] 4 W  •  3 D  •  2 W [FRA]
```

Visual (compact):
```
ARG 4-3-2 FRA
```

### `MatchPredictionRow` — extend

Existing component at `apps/web/components/bracket/MatchPredictionRow.tsx`. The two-flag + DRAW-pill core is the right idea. Additions:

- Below each flag (in addition to the existing `mpr-pick-pct`), render an **inline `FormDots size="sm"`** for that team.
- Above the row, render a **collapsed `HeadToHeadPill variant="compact"`** as a one-line subtitle.
- Use the new `selectionRing` prop on `TeamFlag`: when `isHome`, render the home-team's kit-colour ring around the home flag; same for away. This replaces or augments the existing `sparkle` cue.
- Keyboard shortcuts (1/H, 2/D, 3/A, Arrow keys) are already implemented and stay.

### `KnockoutMatch` — extend

Existing component at `apps/web/components/bracket/KnockoutMatch.tsx`. Additions:

- Lift flag size from `sm` → `lg` (`shape="circle"`).
- Add a centre "VS" treatment between flags.
- Use new `dim` prop on `TeamFlag` to desaturate the losing side after pick.
- Add a `TeamColorStrip` at the top of each knockout card pulling both teams' primaries.
- Stage badge (existing `km-stage`) restyled into a single pill ("R32" / "R16" / "QF" / "SF" / "F") in OneFootball-style neutral chrome (per [doc 35 §5](35-competitor-ux-dossier.md#5-onefootball)).

### `BracketBuilder` — extend

Existing component at `apps/web/components/bracket/BracketBuilder.tsx`. The three-tab structure (groups / knockouts / lock) stays. Add:

- A new **`bird's-eye view`** modal/route accessible from the knockouts tab that shows the entire 32-team bracket scaled to fit a single 360-wide phone — pure read-only, share-as-image. Borrowed directly from ESPN's "Bird's-Eye View" (per [doc 35 §2](35-competitor-ux-dossier.md#2-espn-tournament-challenge)).
- A **"share my bracket as a card"** action in the lock tab that generates a 1080x1920 PNG of the user's full bracket with kit-coloured flags. Reuses the OG-image generation pipeline already on the marketing site.

### `LeaderboardRow` — NEW

Used inside `LeaderboardPreview` and the eventual full `/leaderboard` page.

```tsx
type LeaderboardRowProps = {
  rank: number;
  rankDelta?: number;             // +1 means moved up 1 spot
  user: { id: string; handle: string; avatarUrl?: string; countryCode?: string };
  points: number;
  perfectPicks?: number;
  vstampVerified?: boolean;       // gold check
  highlighted?: boolean;          // current user
};
```

Visual:
- Mobile: rank · avatar · handle · points (right-aligned, big).
- Desktop: rank · delta arrow · avatar · handle · country flag · points · perfect picks · vstamp tick.

---

## Mobile + desktop wireframes (ASCII)

### `/team/[code]` — mobile (375 wide)

```
+-----------------------------------+
|  ◀  Argentina        ⓘ   ☆ Follow |
|                                   |
|     ░░░ kit colour gradient ░░░   |
|        primary → secondary        |
|                                   |
|       (   xxl 144px circle    )   |
|       (        flag           )   |
|       (        ARG            )   |
|                                   |
|   #3 FIFA  ▲2   Group D          |
|                                   |
|   Form: ● ● ○ ● ●                 |
|         W W D W W                 |
|                                   |
|   H2H vs FRA: ARG 6-3-5 FRA       |
+-----------------------------------+
| Tabs: Squad | Fixtures | History  |
+-----------------------------------+
| SQUAD                             |
|                                   |
|  Goalkeepers                      |
|  [face] 1 E. Martínez   GK   31   |
|  [face] 12 G. Rulli     GK   34   |
|                                   |
|  Defenders                        |
|  [face] 4 G. Montiel    RB   29   |
|  ...                              |
+-----------------------------------+
| FIXTURES (next 5)                 |
|                                   |
|  Group D • 12 Jun 2026            |
|  ARG vs MEX                       |
|  H2H ARG 18-12-7 MEX  • 18:00 ET  |
|  [Predict]                        |
|                                   |
|  ...                              |
+-----------------------------------+
```

### `/team/[code]` — desktop (1280+ wide)

```
+---------------------------------------------------------------------------------+
|  ░░░ kit-colour gradient strip — full width ░░░                                 |
+----------------+----------------------------------+-----------------------------+
| ( xxl 192px    | Argentina                        |  #3 FIFA  ▲2                |
|   circle flag) | Group D • host: USMX             |  Form ● ● ○ ● ●             |
|                | Last meeting: 2-2 vs FRA (2022)  |  ☆ Follow   📤 Share         |
+----------------+----------------------------------+-----------------------------+
|  Tabs:  Squad  •  Fixtures  •  History  •  Predict their bracket               |
+---------------------------------------------------------------------------------+
| SQUAD (4 columns)                  | FIXTURES (right rail)                      |
|                                    |                                            |
| Keepers          Defenders         |  [Group D] ARG vs MEX  12 Jun  18:00 ET    |
| 1 Martínez       4 Montiel         |  Predicted: [ARG ✓] [DRAW] [MEX]           |
| 12 Rulli         13 Lisandro M.    |                                            |
| 23 Armani        ...               |  [Group D] ARG vs IRN  18 Jun  21:00 ET    |
|                                    |  Predicted: [ARG] [DRAW] [IRN]             |
| Midfielders      Forwards          |                                            |
| 5 Paredes        9 J. Álvarez      |  [Group D] ARG vs CRO  24 Jun  18:00 ET    |
| 7 De Paul        10 L. Messi       |  Predicted: [ARG] [DRAW] [CRO]             |
| ...              ...               |                                            |
+---------------------------------------------------------------------------------+
```

### `/match/[id]/preview` — mobile

```
+-----------------------------------+
| ◀  Group D • 12 Jun 2026 • 18:00  |
+-----------------------------------+
| ░░░ home gradient | away gradient |
+-----------------------------------+
|                                   |
|   ( ARG circle )   VS   ( MEX )   |
|   #3 FIFA              #15 FIFA   |
|   ● ● ○ ● ●            ● ○ ○ ● ●  |
|                                   |
|   H2H: ARG 18-12-7 MEX            |
+-----------------------------------+
| Tabs: Predict | Stats | Lineup    |
|       | H2H    | News              |
+-----------------------------------+
| PREDICT                           |
|                                   |
|  [ARG circle]   [DRAW]   [MEX]    |
|     54%          25%      21%     |
|   (ring = sel)                    |
|                                   |
|  Add score?                       |
|  ARG [-] [2] [+]  –  MEX [-] [1]  |
+-----------------------------------+
| Affiliate odds chip (existing)    |
+-----------------------------------+
```

### Group card — mobile

```
+-----------------------------------+
|  Group D                          |
|  ░░░ ARG · MEX · CRO · IRN ░░░    |  <- 4-stop kit gradient
+-----------------------------------+
| H2H ARG 18-12-7 MEX               |
| [ARG circle]  DRAW  [MEX circle]  |
| 54%          25%     21%          |
| ●●○●●               ●○○●●         |
+-----------------------------------+
| H2H ARG 6-3-5 FRA                 |
| ...                               |
+-----------------------------------+
| STANDINGS (computed)              |
|                                   |
| 1 ARG (kit-tinted row) 9 pts +6   |
| 2 MEX                  6 pts +2   |
| 3 CRO                  3 pts -1   |
| 4 IRN                  0 pts -7   |
+-----------------------------------+
```

### Knockout card — mobile

```
+-----------------------------------+
| ░░░ ARG / FRA gradient ░░░        |
| R16 #45                           |
+-----------------------------------+
|                                   |
|  ( ARG circle  )   VS   ( FRA )   |
|     ring=sel           dim       |
|     ARG                  FRA      |
|                                   |
|  Form: ●●○●●           ○●●●○      |
+-----------------------------------+
|     [ARG advances]   54%          |
+-----------------------------------+
```

### Leaderboard — desktop (1280 wide)

```
+----------------------------------------------------------------------+
| Tabs: Global  •  Country (NZ)  •  Friends  •  Affiliate cohort       |
+----------------------------------------------------------------------+
| #1  ▲2  [avatar] @bracket-king          NZ 🇳🇿  3,450  pts  ✓  19/24 |
| #2  ▼1  [avatar] @argentina-2026         AR 🇦🇷  3,440  pts     18/24 |
| #3  —   [avatar] @office-pizza           US 🇺🇸  3,210  pts  ✓  17/24 |
| ...                                                                  |
| #43 [you]  [avatar] @tim-nz              NZ 🇳🇿  2,210  pts     11/24 |
+----------------------------------------------------------------------+
```

---

## Prioritised punch-list (what to build first)

### Small (≤1 day each)

1. **`FormDots` component** — five-pill last-5 form. Reused everywhere. Reference: [doc 35 §6](35-competitor-ux-dossier.md#6-flashscore).
2. **`RankChip` component** — FIFA-rank pill with optional delta. Reference: [doc 35 §10](35-competitor-ux-dossier.md#10-sorare).
3. **`TeamColorStrip` component** — gradient strip, 6px tall, used as card-edge decoration. Reference: [doc 35 §5](35-competitor-ux-dossier.md#5-onefootball).
4. **`TeamFlag` extension** — add `xxl` size, `selectionRing` prop, `dim` prop. Backwards-compatible additive change to `apps/web/components/bracket/TeamFlag.tsx`.
5. **`MatchPredictionRow` enrichment** — wire `FormDots` and `HeadToHeadPill` into the existing row.

### Medium (2–4 days each)

6. **`HeadToHeadPill` component** — pill with both formats (compact / wide). Needs a small data layer (we likely have last-meeting data already from StatsBomb open data per [doc 11](11-historic-data-sources.md)).
7. **`KnockoutMatch` redesign** — bigger flags, VS treatment, kit-coloured selection ring, dim losing side, `TeamColorStrip` at the top.
8. **`/team/[code]` page** — new route, hero header (gradient strip + xxl flag + RankChip + FormDots + H2H pill), tabbed body (Squad / Fixtures / History). Copy FotMob's eight-tab IA but trim to three for v0.1 ([doc 35 §4](35-competitor-ux-dossier.md#4-fotmob)).
9. **`LeaderboardRow` polish** — avatars, rank-delta arrows, vstamp tick, current-user highlight. Reference: [doc 35 §11](35-competitor-ux-dossier.md#11-yahoo-sports-pickem--bracket-mayhem) and [§12](35-competitor-ux-dossier.md#12-splash-sports).

### Large (≥1 week each)

10. **`/match/[id]/preview` enrichment screen** — full FotMob-style five-tab match view (Predict / H2H / Form / Lineup / Stats). Each tab is a sub-component; the Predict tab embeds the existing `MatchPredictionRow`. Reference: [doc 35 §4](35-competitor-ux-dossier.md#4-fotmob).
11. **Bird's-Eye bracket view** — modal (or new route) that shows the user's entire 32-team knockout bracket scaled to one mobile viewport, plus PNG export. Reference: [doc 35 §2](35-competitor-ux-dossier.md#2-espn-tournament-challenge).
12. **Bracket-as-shareable-card generator** — 1080x1920 PNG of the user's full bracket, generated server-side via the existing OG-image pipeline. Reference: FotMob's lineup-builder share pattern in [doc 35 §4](35-competitor-ux-dossier.md#4-fotmob).

---

## Brand and palette guidance

Keep VTourn's existing brand palette from [doc 15](15-vtourn-brand-and-positioning.md) as the chrome. **The kit colours are the content**.

- Card chrome: dark mode neutrals (similar to OneFootball's `#1A1A1A` / `#F0F0F0` axis from [doc 35 §5](35-competitor-ux-dossier.md#5-onefootball)).
- Active selection: kit-coloured ring on the chosen flag, plus a small accent in the global accent (`#fbbf24` works today; the existing `accentColor` prop on `TeamFlag` already supports this).
- Dim state: 60% grayscale + 50% opacity (per the new `dim` prop on `TeamFlag`).
- Form colours: green `#22c55e` win, slate `#94a3b8` draw, red `#ef4444` loss. Avoid pure red/green to be colour-blind friendly — these are tested OK but consider supplementing with a letter glyph (W/D/L) at small sizes.
- Yes/No-style props (when we ship them): blue for "advances/yes", warm orange for "out/no" — matches Polymarket's pattern from [doc 35 §9](35-competitor-ux-dossier.md#9-polymarket) and avoids the red/green trap.

---

## Accessibility and performance notes

- All flag images already lazy-load via `loading="lazy"` on `TeamFlag`'s `<img>`. Keep.
- New `selectionRing` and `dim` props must compose cleanly so a screen reader user gets the same outcome via `aria-pressed` (existing on `MatchPredictionRow` buttons).
- Form-dot colours need a non-colour cue at the smallest size — the `md` variant carries the W/D/L letter, the `sm` does not. Default to `md` everywhere except inside the standings table.
- `/team/[code]` should hit the LCP budget from [doc 22](22-deployment-and-tunnels.md): hero flag SVG must be inlined or use `priority` loading.
- `/match/[id]/preview` should use `s-maxage=60` edge caching with SWR — match data is staleness-tolerant in the pre-match window.

---

## Out of scope for this spec

These are real ideas surfaced during research but should park in [IDEAS.md](../IDEAS.md) rather than the spec:

- "Confidence points" overlay (Splash Sports pattern from [doc 35 §12](35-competitor-ux-dossier.md#12-splash-sports)) — interesting v2 mechanic, but conflicts with our scoring model in [doc 16](16-game-modes-and-scoring.md). Park.
- "In-contest chat" (Splash Sports) — has support cost. Park until we have a cohort big enough to need it.
- Pundit-pick comparisons (Sky Super 6) — would be cool with named NZ pundits like Wynton Rufer. Park; needs business-development effort.
- Full FotMob-style market-value filter on lineups — gold-plate; not in scope for v0.1.

---

## What success looks like

After the punch-list ships:

1. A new visitor lands on `/world-cup-2026`, taps a flag, sees a kit-coloured selection ring snap onto it, and sees their pick committed in <1s. Tap-to-first-pick stays at 2 (matching Telegraph; better than ESPN's 6).
2. A user lands on `/team/ARG` from social, sees a hero with a 144px Argentina flag, FIFA #3 chip, sky-blue gradient strip, and clicks through to predict Argentina's group matches.
3. A user finishes a bracket and shares a single PNG to WhatsApp; the receiver clicks the link and lands on the same `/world-cup-2026` flow with the original bracket pre-filled (read-only) so they can build their own from a comparison position. Share-loop velocity becomes our primary growth metric for the AR-FR demo and through to launch.

---

## Cross-references

- [doc 04 — renderer](04-renderer.md) — the live `/match/[id]` route.
- [doc 11 — historic data sources](11-historic-data-sources.md) — where H2H data comes from.
- [doc 12 — odds and predictions](12-odds-and-predictions.md) — where the percentages on `MatchPredictionRow` come from.
- [doc 15 — brand and positioning](15-vtourn-brand-and-positioning.md) — chrome palette.
- [doc 16 — game modes and scoring](16-game-modes-and-scoring.md) — why we resist confidence-points and stepper score-entry.
- [doc 20 — identity and humanness](20-identity-humanness-bots.md) — leaderboard avatars.
- [doc 22 — deployment and tunnels](22-deployment-and-tunnels.md) — caching budgets for `/team/[code]` and `/match/[id]/preview`.
- [doc 24 — gamification and virality](24-gamification-and-virality.md) — share-card pipeline.
- [doc 30 — gamification and affiliate spine](30-gamification-and-affiliate-spine.md) — leaderboard tabs (affiliate cohort).
- [doc 35 — competitor UX dossier](35-competitor-ux-dossier.md) — every claim above is sourced there.
