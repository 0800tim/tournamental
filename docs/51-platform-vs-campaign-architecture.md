# 51 — Platform vs Campaign Architecture

> **Status**: design intent, not yet implemented. Captures Tim's
> 2026-05-11 clarification so the next agents can align without
> re-litigating it.

## The clarification, in one sentence

**VTourn is a tournament-prediction *platform*. The 2026 FIFA World Cup
is one *campaign* running on that platform.**

The platform should be capable of hosting many campaigns side-by-side:
World Cup, Euros, Copa, AFCON, the Cricket World Cup, the NFL post-
season, March Madness, the Olympics, eSports leagues, and even private
syndicate-only tournaments somebody wants to spin up for an office.
The current codebase has WC2026 wired into the chrome as if it were the
whole product. That works for v0.1, but the next refactor needs to
separate the two cleanly so a new campaign can be added without forking
the codebase.

## The shape (target state)

```
vtourn.com                      ← platform marketing site (apps/marketing)
  /                             ← homepage
  /why                          ← "how do prediction games work"
  /how-it-works
  /syndicates                   ← create a private league
  /leaderboards                 ← global pundit board (across campaigns)
  /open-source
  /news
  /blog
  /contribute
  /login                        ← magic-link auth, DM-OTP, OAuth
  /me                           ← profile, settings, owned campaigns

2026wc.vtourn.com               ← ONE CAMPAIGN running on the platform
  /                             ← hype landing (apps/web/app/world-cup-2026/landing)
  /world-cup-2026               ← the bracket builder (apps/web/app/world-cup-2026)
  /world-cup-2026/share/<id>    ← shareable bracket
  /match/<id>/preview           ← match preview (FotMob-style tabs)
  /match/<id>                   ← 3D renderer
  /team/<code>                  ← team detail
  /player/<id>                  ← player detail
  /leaderboard                  ← this-campaign leaderboard
  /watch                        ← upcoming renderer streams

<other-campaign>.vtourn.com     ← e.g. afcon2026, nfl-2026-playoffs, ...
  (same routes; data + branding swap in)
```

## Platform-level primitives (never campaign-specific)

These belong on `vtourn.com` and should never be duplicated in a
campaign subdomain:

- **Marketing surfaces**: `/why`, `/how-it-works`, `/syndicates`,
  `/leaderboards` (global), `/blog`, `/news`, `/open-source`,
  `/contribute`, `/influencers`, `/legal`.
- **Auth**: magic-link, DM-OTP (per [doc 13](13-telegram-bot-and-auth.md)),
  OAuth providers. One identity, many campaigns.
- **User profile + settings**: `/me`, `/me/connections`,
  `/me/notifications`, `/me/keys`.
- **Self-serve "create a campaign" flow**: where a syndicate organiser
  (or an open-source contributor) imports a fixture pack and brand kit.
- **Global pundit leaderboard**: rolls each campaign's per-user score
  up into a single "Prediction IQ" number (per
  [doc 17](17-vstamp-and-prediction-iq.md)).
- **Pricing, billing, affiliates router** (per
  [doc 18](18-monetization.md)).

## Campaign-level primitives

These vary per campaign and ship in a campaign config bundle:

- **Fixture data + canonical team list**: `data/<campaign>/teams.json`,
  `data/<campaign>/fixtures.json`. Currently hardwired at
  `data/fifa-wc-2026/`.
- **Brand colours / sponsor logos / hero copy**: e.g. WC2026 uses
  amber + emerald, FIFA logos, the "33 days until the world predicts
  the World Cup" hero. AFCON would use very different palette + assets.
- **Bracket format**: groups + knockout (WC), knockout-only (Champions
  League), round-robin (some leagues), best-of-N (eSports). The
  `@vtorn/bracket-engine` already abstracts the format; the campaign
  just declares which.
- **Renderer match data**: stadium models, kit textures, ball model,
  commentary corpus, ad-boards.
- **Per-campaign leaderboard** (rolls into the global pundit score).
- **Per-campaign push channels**: a campaign can have its own Telegram
  channel + Discord webhook + email digest.

## Subdomain pattern

```
<campaign-slug>.vtourn.com
```

The middleware (`apps/web/middleware.ts`) already rewrites
`2026wc.vtourn.com/` → `/world-cup-2026/landing`. The future shape:

- A campaign-registry table maps `<slug>` → `<route prefix>` and
  `<config bundle>`.
- The middleware injects a `x-vtorn-campaign` header (or React context)
  so server components know which campaign they're rendering.
- The `[campaign]` route segment (or context provider) replaces the
  hardcoded `/world-cup-2026/` paths in client navigation. Apex
  `vtourn.com` resolves to the platform marketing site; everything
  else resolves to a campaign.

## App-shell behaviour

The PWA shell (`apps/web/components/shell/AppShell.tsx`) should:

1. **Default tabs** are platform-level: Home / Predict / Watch /
   Profile. The "Predict" tab points at the platform's "your campaigns"
   index when the user is in multiple campaigns; in a single-campaign
   context it deep-links to that campaign's bracket.
2. A campaign can **override** the Predict tab to point at its own
   bracket route. Today, `apps/web/app/world-cup-2026/page.tsx` already
   passes its own `bottomNavTabs` prop; the future override is exactly
   that, surfaced via campaign config rather than per-route.
3. Marketing-flavoured surfaces (the landing page, the share page)
   pick their own chrome. Some want the full AppShell so the bottom
   nav is consistent; some are designed as standalone hype pages
   (e.g. the WC2026 landing) and skip it deliberately.

## What's already in place

- `apps/marketing/` is the platform marketing site. Cleanly separate
  from the bracket app, deploys to `vtourn.com`.
- `apps/web/` is the campaign app. Today it hardcodes WC2026, but the
  fixture / team data is already keyed by tournament under
  `data/fifa-wc-2026/`.
- `@vtorn/bracket-engine` is campaign-agnostic (it takes a fixtures
  blob and returns a cascading bracket).
- `apps/web/middleware.ts` already host-rewrites `2026wc.vtourn.com`
  → the WC landing.
- Per [doc 22](22-deployment-and-tunnels.md), the deploy pipeline and
  Cloudflared ingress already model each campaign as a sub-domain
  routed through the same tunnel.

## What's NOT in place yet (refactor backlog)

> These tasks are recorded so the next sprint can pick them up. They
> are NOT for this PR — Tim's directive: "as long as we can prototype
> it" — just nail the architecture doc so the next agents have ground
> truth.

1. **Extract a campaign config provider.** Wrap each campaign route in
   a `<CampaignProvider value={campaignConfig}>` (server-component
   context) so components below can read the active campaign's slug,
   palette, fixture data path, and bracket-format flag.
2. **Move `apps/web/app/world-cup-2026/` under
   `apps/web/app/[campaign]/`** with `[campaign]` resolved from the
   subdomain via middleware. Keep `/world-cup-2026/` working as a
   redirect (or symlink) until the WC2026 demo is shipped.
3. **Centralise team / fixture loading** behind a
   `loadCampaign(slug)` helper that returns the bracket-engine inputs.
   Today, `loadFixtures2026()` is hardcoded. Generalise to
   `loadFixtures(campaignSlug)`.
4. **Add a self-serve "create a campaign" flow** on the marketing
   site (`/create`). MVP: upload a fixture CSV + a brand kit, get
   back a `<slug>.vtourn.com` subdomain (gated behind login + manual
   review at first).
5. **Platform-level bottom nav defaults** in the PWA. The current
   `DEFAULT_BOTTOM_NAV_TABS` in `BottomNav.tsx` hardcodes the
   `/world-cup-2026` href as the Predict tab. That should read from
   the active campaign config instead.
6. **Mobile menu (`apps/marketing/src/components/Header.astro`)**
   already lists `/world-cup-2026` as a marketing link. When other
   campaigns ship, the platform marketing menu rotates the *current*
   featured campaign (or shows an aggregate "Browse campaigns" link).
7. **OG meta + share routes**: the share page is currently nested at
   `/world-cup-2026/share/[bracketId]`. Lift to `/share/[bracketId]`
   with the campaign read from the bracket payload (so a share link
   to an AFCON bracket continues to work without a code change).
8. **Global pundit leaderboard**: today `apps/web/app/leaderboard/`
   shows the WC2026 board. A *platform* leaderboard at
   `vtourn.com/leaderboards` should aggregate per-campaign scores via
   the rolled-up Prediction IQ (per
   [doc 17](17-vstamp-and-prediction-iq.md)).

## How this changes Tim's "WC2026 is a campaign launched on the platform" pitch

The pitch is now:

- VTourn is a tournament prediction platform. Anyone can run a
  campaign on it.
- The 2026 World Cup site (`2026wc.vtourn.com`) is **our** campaign —
  built end-to-end by the core team as a flagship and a proof point.
- The renderer, bracket engine, scoring, social distribution, and
  watch-along are reusable across any campaign with a structured
  fixture stream. The 22-player avatar + StatsBomb-style spec is
  football-shaped today; doc 27a-d already enumerates the path to
  multiple sports.
- Anyone (an office syndicate, a creator, a media partner) can run
  their own bracket campaign on the same primitives. The platform
  takes a small share of any monetised campaign (per
  [doc 18](18-monetization.md)) and the rest accrues to the campaign
  organiser plus the open-source contributor pool (per
  [doc 19](19-open-source-and-contributor-revenue.md)).

## Cross-references

- [docs/01-vision-and-scope.md](01-vision-and-scope.md) — the vision
  this doc operationalises.
- [docs/15-vtourn-brand-and-positioning.md](15-vtourn-brand-and-positioning.md)
  — voice + visual language. The brand kit must accommodate per-campaign
  overrides.
- [docs/17-vstamp-and-prediction-iq.md](17-vstamp-and-prediction-iq.md)
  — global pundit IQ rolls up per-campaign scores.
- [docs/18-monetization.md](18-monetization.md) — affiliate router
  + revenue share lives at the platform layer.
- [docs/22-deployment-and-tunnels.md](22-deployment-and-tunnels.md) —
  subdomain → tunnel ingress wiring; already supports per-campaign
  domains.
- [docs/37-pwa-app-shell.md](37-pwa-app-shell.md) — the AppShell
  contract whose default tabs this doc clarifies as platform-level.
