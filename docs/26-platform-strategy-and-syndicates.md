## VTourn as a platform — syndicates, custom subdomains, SDK, MCP

> The strategic shift articulated 2026-05-09. **VTourn is not just a product — it's a platform.** Anyone can spin up their own tournament syndicate at `their-name.vtourn.com`, run their own pool with their friends, settle however they like (off-platform real-money handshake or on-platform bonus tokens), and the global VTourn engine carries the data, predictions, leaderboards, and verifiable results.

## Brand decision

**`vtourn.com` is the canonical marketing brand.** Tim owns both `vtorn.com` and `vtourn.com` .com domains (registered 2026-05-09). `VTourn` reads instantly as "Virtual Tournaments" — on-message and easy to explain. `VTorn` connotes "torn / ripped / conflict" — wrong vibe.

The repo + code remain `vtorn` for now (a one-time rename PR can clean that up later). The deployed URLs and all marketing surfaces use `vtourn.com`.

| Surface                       | Brand    |
| ----------------------------- | -------- |
| Marketing site                | vtourn.com |
| App (renderer + game)         | app.vtourn.com |
| API                           | api.vtourn.com |
| User syndicate subdomains     | `*.vtourn.com` (e.g. `jason.vtourn.com`) |
| Email                         | `tim@vtourn.com`, `support@vtourn.com` |
| Telegram bot                  | `@VTournBot` (reserve at BotFather) |
| Repository (code-internal)    | `0800tim/vtorn` (rename later) |

## What a syndicate is

A **syndicate** is a private/semi-private pool of friends running their own tournament prediction game on top of VTourn. The host (the syndicate owner) configures:

- **Tournament**: which real or virtual tournament to play (FIFA WC, IPL, Six Nations, custom).
- **Format**: weekly winner-takes-all, gold/silver/bronze, season-long ladder, knockout brackets.
- **Stake & settlement**: free-to-play, internal-tokens-only, or **off-platform real-money** with the host responsible for collecting and disbursing — the platform tracks predictions and scores, never touches money it isn't authorised to hold.
- **Scoring**: points per correct prediction, bonus multipliers for streaks, prediction-IQ weighting.
- **Membership**: invite-only with a syndicate code, public sign-up with host approval, or fully public.

The host visits `jason.vtourn.com`, sees their syndicate's branded leaderboard + tournaments + chat, and runs everything from there. Their friends see the same subdomain — no need to know "VTourn" exists.

## Architecture for custom subdomains

Wildcard DNS at `*.vtourn.com` → the same app origin, with the subdomain extracted server-side and resolved to a syndicate.

### DNS

Cloudflare wildcard records:

```
*.vtourn.com    CNAME    app.vtourn.com    (proxied)
```

A tunnel ingress rule (or Cloudflare Pages routing) catches `*.vtourn.com` and serves the app. The app reads `Host:` (or `X-Forwarded-Host:`) and looks up the syndicate.

### Slug resolution (fuzzy matching)

Subdomain claims are case-insensitive and normalised. Reserved words (`www`, `app`, `api`, `admin`, `dev`, `preview`, `auth`, `static`, `cdn`, `dashboard`, `help`, `docs`, `blog`) are blocked.

Approved characters: `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?`. Length 3-63. Can't start/end with `-`. Punycode rejected for v0.1 (re-evaluate when we expand internationally).

**Fuzzy matching for typos**: when a visitor hits `jasn.vtourn.com` and there's no exact `jasn`, the app:
1. Looks up Levenshtein-distance ≤ 2 against active syndicate slugs.
2. If exactly one match, redirects with a small notice ("Did you mean jason.vtourn.com?").
3. If multiple, shows a disambiguation page.
4. If none, shows the "claim this name" page (with the marketing pitch).

Tracked claims live in `syndicate_aliases` (Postgres) so a host can reserve common variants of their name (`jason`, `jasonm`, `jasonsmith`).

### Branding per syndicate

Each syndicate has a small theme record: logo URL, primary colour, accent colour, optional hero image, tagline. Themes apply to:
- Marketing landing under their subdomain.
- HUD accent colours during a match (subtle — doesn't override team colours).
- Email templates (VTourn-templated, syndicate-skinned).
- Share cards (auto-generated PNGs include the syndicate logo + handle).

### Off-platform real-money settlement

VTourn does not handle money for v0.1 syndicates. It tracks predictions, scores, and rankings. **The host arranges money offline.**

Architecture decision: this keeps VTourn out of regulated-gambling territory in most jurisdictions. The platform is a *prediction game with a points system* — no different from Fantasy Premier League's free tier — and any money flowing between participants is between them (much like a friends-and-family pool for the office). The platform is explicit about this in its terms.

For phase 2 we add:
- **On-platform bonus-token pools** (already in the gamification doc) — never withdrawable as cash, raffle entries to real prizes via VTornOracle (doc 21).
- **On-platform real-money pools (audited)** — gated by the smart-contract audit, KYC for the pool host above a threshold, and per-jurisdiction rollout. Tim's call when revenue justifies the legal lift.

## npm SDK

`@vtourn/sdk` (publishable on npm under the `vtourn` org) lets third-party developers run VTourn predictions in their own product without depending on the full repo.

```ts
import { VTourn, useMatchStream } from "@vtourn/sdk";

const vt = new VTourn({ apiKey: "..." });

// React hook: subscribe to a match
const { score, t, status } = useMatchStream("fifa-wc-2022-final-arg-fra-2022-12-18");

// Submit a prediction
await vt.predictions.submit({
  match_id: "fifa-wc-2022-final-arg-fra-2022-12-18",
  market: "match_winner",
  selection: "team_0",
  stake_units: 10,
});

// Render the player into your own scene
import { MatchScene } from "@vtourn/sdk/r3f";
<MatchScene matchId="fifa-wc-2022-final-arg-fra-2022-12-18" theme={mySyndicateTheme} />
```

The SDK wraps the public API + spec types + a thin React-three-fiber binding. Internally it lives at `packages/sdk/` in this monorepo and is published on each tagged release.

**Auth model**: SDK consumers use a `pk_*` publishable key (read-only public surfaces) or a `sk_*` secret key (write surfaces — submit predictions on user's behalf). Keys are generated per syndicate from the syndicate dashboard.

## MCP server

`@vtourn/mcp` — a Model Context Protocol server exposing VTourn capabilities to Claude Desktop / Cursor / any MCP-aware client. Lets a developer or a creator say:

> "Set up a Six Nations syndicate for me at `kiwi-fans.vtourn.com`, gold/silver/bronze, NZ$10 buy-in I'll handle myself. Invite my Telegram contacts."

…and the MCP server orchestrates the API calls + emits a setup checklist.

**Tools surfaced** by the MCP server:

- `vtourn.syndicate.create({ slug, format, theme, settlement_mode })`
- `vtourn.syndicate.invite({ syndicate_id, channel, recipients })`
- `vtourn.tournament.list({ scope })`
- `vtourn.tournament.attach({ syndicate_id, tournament_id })`
- `vtourn.predictions.submit({ syndicate_id, match_id, predictions[] })`
- `vtourn.leaderboards.get({ syndicate_id, period })`
- `vtourn.match.stream({ match_id })` — returns a stream URL the client can pipe.

**Resources** (read-only via MCP resources protocol):
- `vtourn://syndicate/{slug}` — current state of a syndicate.
- `vtourn://match/{id}/snapshot/{t_ms}` — a match snapshot at a given time.
- `vtourn://tournament/{id}/predictions` — all open prediction markets.

The MCP server lives at `apps/mcp/` and is published as `@vtourn/mcp` on npm so users can run it locally with `npx @vtourn/mcp` or globally as a Claude Desktop integration.

## Startup prompts

A small library of onboarding prompts users (or their Claude/Cursor sessions) paste to bootstrap their VTourn experience. Lives at `prompts/onboarding/` in the repo and is mirrored on the marketing site at `vtourn.com/start`.

Suggested set:

- `00-claim-your-syndicate.md` — claim a subdomain, set up branding, invite first 5 friends.
- `01-pick-a-tournament.md` — attach the next FIFA / IPL / Six Nations cycle to your syndicate.
- `02-configure-scoring.md` — choose format and prize structure.
- `03-share-and-grow.md` — auto-generated share cards, referral links, social copy variants.
- `04-host-toolkit.md` — managing predictions, settling rounds, handling disputes.
- `05-developer-quickstart.md` — install `@vtourn/sdk`, fetch a stream, render a scene.

Each prompt is a self-contained markdown the user pastes into a Claude / Cursor / ChatGPT session, and it walks them through the MCP-server-or-API calls to complete the setup.

## Marketing site (vtourn.com)

Static site (Cloudflare Pages, Next.js or Astro). Lives at `apps/marketing/` (port 3320 in dev → `vtourn-www.aiva.nz`; production: Pages + `vtourn.com`).

**v0.1 scope** (single-sprint deliverable):
- **/** — hero with the AR-FR demo embedded as a 30s autoplay clip; "Predict the next big match. Bring your friends."
- **/how-it-works** — 4-step explainer (sign up → predict → watch → climb the leaderboard).
- **/syndicates** — pitch for hosts: "Run your own pool at `yourname.vtourn.com`."
- **/affiliates** — partner program for sportsbooks / influencers.
- **/contributors** — Drips Network revenue share for OSS contributors (per `docs/19`).
- **/start** — onboarding prompt library + `npx @vtourn/mcp` install snippet + Telegram bot link.
- **/git** — link to the GitHub repo with a "we're 100% open source under Apache 2.0" badge.
- **/legal** — terms, privacy, cookie policy, disclaimer about real-money play.

Performance: edge-cached, < 1s LCP on a mid-range Android, image-optimised, no JS framework on the lightest pages (Astro's island architecture is the safer pick for marketing).

## Globe + full-platform data view

A standout capability: every prediction submitted across every syndicate worldwide is visible (with appropriate privacy) on `vtourn.com/globe` — a 3D world map showing live activity. "5,400 predictions submitted from 87 countries in the last hour" with real-time pulses.

Implementation: Redis pub/sub of every `prediction_submitted` event → a `/v1/firehose/predictions` SSE endpoint with rate limiting and PII scrubbed (just `geo_country` + `tournament_id` + `match_id`). The globe component on the marketing site subscribes and animates pulses at the geo_country centroid.

This is both a hero marketing visual AND a network-effect signal: visitors see activity, sign up to join.

## Implementation roadmap

| ID    | Item                                            | Phase | Owner       |
| ----- | ----------------------------------------------- | ----- | ----------- |
| #0030 | `apps/marketing/` v0.1 scaffold (Astro + content) | P1    | unstaffed   |
| #0031 | Wildcard `*.vtourn.com` DNS + tunnel ingress    | P1    | orchestrator |
| #0032 | Syndicate slug resolution + Levenshtein matcher | P1    | api builder  |
| #0033 | Syndicate model + theme record (Prisma migration) | P1    | api builder  |
| #0034 | `packages/sdk/` v0.1.0 publishable to npm       | P2    | sdk builder  |
| #0035 | `apps/mcp/` MCP server publishable as npx pkg   | P2    | mcp builder  |
| #0036 | `prompts/onboarding/` library                   | P2    | doc/design   |
| #0037 | `/globe` real-time activity visualisation        | P2    | globe builder |
| #0038 | Reserve `@VTournBot` Telegram username          | P0    | tim          |
| #0039 | npm `@vtourn` org registered                    | P0    | tim          |

## What every PR touching the platform surface is reviewed against

- Did this PR add a hostname surface? → wildcard subdomain rules respected, reserved words protected, fuzzy resolver tested?
- Did this PR add an SDK-visible API? → backwards-compatible, semver respected, types exported in `packages/sdk/`?
- Did this PR change syndicate pricing / scoring / settlement? → docs/26 updated, host-facing settings UI updated, migration shipped?
- Did this PR add a new marketing surface? → cache policy per `docs/22`, performance budget per `docs/22`?
- Did this PR introduce a new MCP tool? → documented in this doc and in `apps/mcp/README.md`, error semantics covered, rate-limited?
