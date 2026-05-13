# Tournamental

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![npm: @tournamental/bracket-engine](https://img.shields.io/npm/v/@tournamental/bracket-engine.svg?label=%40tournamental%2Fbracket-engine)](https://www.npmjs.com/package/@tournamental/bracket-engine)
[![Open issues](https://img.shields.io/github/issues/0800tim/tournamental.svg)](https://github.com/0800tim/tournamental/issues)
[![Last commit](https://img.shields.io/github/last-commit/0800tim/tournamental.svg)](https://github.com/0800tim/tournamental/commits/main)
<!-- TODO: replace https://discord.gg/tournamental with the finalised invite URL once it is reserved. See docs/55-public-launch-checklist.md. -->
[![Discord](https://img.shields.io/badge/discord-tournamental-5865F2.svg?logo=discord&logoColor=white)](https://discord.gg/tournamental)

> **Predict the tournament. Beat the market. Prove it.**
>
> Tournamental is a live tournament prediction game with a 3D match-renderer watch-along, Telegram-bot identity, blockchain-verified prediction receipts, and a long-term reputation network, all on a write-once / serve-via-CDN architecture so a million viewers cost the same as ten. Open source under Apache 2.0, brand and treasury held by the Tournamental operating company, contributor revenue streamed via the Drips Network.

Domain: **tournamental.com**. Brand expansion when needed: **Tournamental, Verified Tournament Oracle Network**.

## What just shipped

- **npm packages live** under [`@tournamental/*`](https://www.npmjs.com/search?q=%40tournamental) -- `spec`, `bracket-engine`, `social-cards`, and `plugin-sdk` (in development).
- **MCP server live** at [`mcp.tournamental.com`](https://mcp.tournamental.com) so Claude, Cursor, Windsurf, and other Model Context Protocol clients can read live Tournamental state.
- **Engineering blog + plugin SDK** -- the engineering log at [`tournamental.com/engineering`](https://tournamental.com/engineering) is now the canonical entry point for builders, and the plugin SDK in [`packages/plugin-sdk/`](packages/plugin-sdk) lets you drop in renderers, scorers, ingest sources, identity providers, share-card pipelines, odds feeds, and affiliate routers without forking the core.

## Build on Tournamental in 20 minutes

1. Read [The Tournamental stack at a glance](https://tournamental.com/engineering/2026-05-13-stack-at-a-glance) for the six-step "vibe-code your app on top of Tournamental" walkthrough.
2. Pick the npm packages you need:
   - [`@tournamental/spec`](https://www.npmjs.com/package/@tournamental/spec) -- the canonical JSON message spec.
   - [`@tournamental/bracket-engine`](https://www.npmjs.com/package/@tournamental/bracket-engine) -- cascade and scoring engine.
   - [`@tournamental/social-cards`](https://www.npmjs.com/package/@tournamental/social-cards) -- OG, podium, and share-card renderer.
   - [`@tournamental/plugin-sdk`](https://www.npmjs.com/package/@tournamental/plugin-sdk) -- plugin contracts for community-built modes.
3. Wire your agent (Claude, Cursor, Windsurf) to the MCP server at [`mcp.tournamental.com`](https://mcp.tournamental.com) so it can read live state without you writing a fetch layer first.
4. Browse the aggregated API reference at [`tournamental.com/api`](https://tournamental.com/api) (Scalar UI, deep-linkable per service). Per-service OpenAPI snapshots live under [`docs/api/`](docs/api/) for offline use.
5. Ship it, open a PR for the contrib pool, and post in [Show and Tell](https://github.com/0800tim/tournamental/discussions/categories/show-and-tell).

## Read the engineering log

If you are an AI agent or a human engineer landing in this repo and trying to work out where to plug in, start with the engineering log at **[tournamental.com/engineering](https://tournamental.com/engineering)** rather than the docs folder. The first post, [The Tournamental stack at a glance](https://tournamental.com/engineering/2026-05-13-stack-at-a-glance), maps every service and package and gives you a six-step "vibe-code your app on top of Tournamental" walkthrough. Subsequent posts drill into specific subsystems (renderer, scoring, on-chain, plugins, performance). RSS at `/engineering/rss.xml`. Public Q&A at [GitHub Discussions](https://github.com/0800tim/tournamental/discussions).

## What Tournamental is

A live tournament intelligence game. Users predict match outcomes and tournament-wide brackets, lock predictions before the result is known, and earn points scored against live market implied probabilities — so calling a 25%-implied underdog correctly is worth more than calling a 90% favourite. Every locked prediction is timestamped and committed to a blockchain Merkle batch (a **VStamp**) so the leaderboard is verifiably tamper-proof. Users build a long-term **Prediction IQ** that becomes a portable reputation asset.

The 3D match-renderer (originally specced as a stand-alone framework, "SimulatedSports") is the watch-along surface — players, ball, pitch, stylized avatars, live commentary remixed via ElevenLabs, all driven by a normalized JSON spec stream that's distributed via Cloudflare. The prediction game and the renderer are independent layers sharing the same canonical match stream.

The killer line:

> **Everyone says they knew what would happen. Tournamental proves who really did.**

## Core architecture in one diagram

```
   Producers (mock, video→AI, tracking feed, StatsBomb replay)
                          │  spec stream (JSON)
                          ▼
                   Stream server (origin)
                          │  chunks + manifest
                          ▼
                  Cloudflare CDN ──▶ Match renderer (web, R3F)
                          │
                          │  events
                          ▼
              ┌────────────────────────────┐       ┌─────────────────────┐
              │ Game service (predictions, │ ───▶  │ VStamp service      │
              │ leaderboards, badges,      │       │ (Merkle batching,   │
              │ pools — Redis + flat JSON) │       │  Polygon + OTS)     │
              └─────────────┬──────────────┘       └─────────────────────┘
                            │ pub/sub
                            ▼
              ┌────────────────────────────┐       ┌─────────────────────┐
              │ Tournament Bot (Telegram,  │       │ Clip pipeline       │
              │  identity, notifications,  │       │ (headless renderer  │
              │  group leaderboards)       │       │  + ffmpeg → IG/TT/  │
              └────────────────────────────┘       │  YT/X/Telegram)     │
                                                   └─────────────────────┘
```

## Repo layout

```
SimulatedSports/                           working folder name; consumer brand is "Tournamental"
├── README.md                              this file
├── Tournamental Pitch.md                               one-page elevator pitch
├── REVIEW.md                              docs-pack readiness audit
├── CLAUDE.md                              orchestrator + agent operations entrypoint
├── AGENT-PROMPTS.md                       copy-paste starter prompts for code agents
├── CONTRIBUTING.md                        contributor guide (humans + agents)
├── IDEAS.md                               backlog parking lot
├── sessions/                              per-session work notes
├── docs/                                  detailed design docs (start here)
│   ├── 01-vision-and-scope.md             what we're building and not building
│   ├── 02-spec.md                         the JSON message spec (the contract)
│   ├── 03-architecture.md                 end-to-end system design
│   ├── 04-renderer.md                     Next.js + React Three Fiber renderer
│   ├── 05-mock-producer.md                synthetic match generator
│   ├── 06-video-ingest.md                 video → JSON pipeline (CV + LLM)
│   ├── 07-avatars-and-assets.md           player likeness, jerseys, animations
│   ├── 08-cdn-distribution.md             Cloudflare CDN, chunking, cache
│   ├── 09-agent-task-breakdown.md         parallel work plan for code agents
│   ├── 10-roadmap.md                      weekend MVP and beyond
│   ├── 11-historic-data-sources.md        free data research; AR-FR 2022 plan
│   ├── 12-odds-and-predictions.md         odds, predictions, leaderboards, sweepstakes
│   ├── 13-telegram-bot-and-auth.md        Tournament Bot — auth (Telegram + email + TOTP + passkeys), notifications
│   ├── 14-clip-generation-and-social.md   auto-clips → TikTok / Reels / Shorts / Telegram
│   ├── 15-tournamental-brand-and-positioning.md  Tournamental brand, taglines, NZ regulatory framing, monetisation overview
│   ├── 16-game-modes-and-scoring.md       10 game modes, scoring formula, personality leaderboards
│   ├── 17-vstamp-and-prediction-iq.md     blockchain verification + Prediction IQ reputation
│   ├── 18-monetization.md                 affiliate routing + sponsorship + Pro + B2B + creator + data licensing
│   ├── 19-open-source-and-contributor-revenue.md  Apache 2.0, Tournamental, Drips Network revshare
│   ├── 20-identity-humanness-bots.md      multi-provider OAuth, Humanness Score, bot policy, friend graph
│   └── 21-onchain-sweepstakes-oracle.md   user-organised on-chain pools + Tournamental-as-oracle (Polygon/Base)
├── spec/
│   ├── types.ts                           canonical TypeScript types
│   └── examples/                          sample JSON payloads
└── prompts/                               LLM prompts (frame-analyzer, commentary-extractor)
```

## npm packages

Workspace packages publish to npm under the `@tournamental` scope since
2026-05-13. Apps inside this monorepo (`apps/web`, `apps/marketing`,
`apps/game`, and friends) stay as `@vtorn/*` because they are internal
deploy targets and do not publish.

Public packages:

- `@tournamental/spec` -- canonical message spec for every producer and
  renderer.
- `@tournamental/bracket-engine` -- cascade and scoring engine for the
  bracket prophet flow.
- `@tournamental/social-cards` -- OG, podium, and share-card renderer.
- `@tournamental/plugin-sdk` -- plugin contracts for community-built
  modes (in development).

## v0.2 demo target: 2022 World Cup Final

The first non-mock demo recreates **Argentina 3–3 France (4–2 pens), 2022 World Cup Final**, driven by **StatsBomb Open Data** (free, on GitHub, includes events + 360° freeze-frames for every match). Player photos via Wikidata / Wikimedia Commons. Full plan in [docs/11-historic-data-sources.md](docs/11-historic-data-sources.md). Tournamental-flavour: every viewer can predict the match alongside the rendered replay, score against the 2022 implied probabilities (we have the StatsBomb data for that), and walk away with a verifiable VStamp on their best calls.

## Documentation

- **Hive-mind index** for agents and contributors: [`docs/README.md`](docs/README.md). Start here.
- **Glossary** of Tournamental-specific terms: [`docs/glossary.md`](docs/glossary.md).
- **Playbooks** for adding apps, routes, debugging PRs, merge conflicts, feature flags, doc updates: [`docs/playbook/`](docs/playbook/).
- **API reference** with per-service Swagger UI URLs and committed OpenAPI 3.0 specs: [`docs/api/README.md`](docs/api/README.md).

## API

- **Public API portal** at [`tournamental.com/api`](https://tournamental.com/api), one aggregated Scalar-rendered reference across every public Fastify service in the monorepo, with deep-links at `/api/<service-slug>`. Built from the committed `docs/api/*.openapi.json` snapshots so it works offline. Architecture in [`docs/53-api-portal.md`](docs/53-api-portal.md).
- **Per-service snapshots** committed under [`docs/api/`](docs/api/), regenerated by `pnpm --filter @vtorn/<service> run openapi:snapshot` (alias for the existing `dump-openapi` script).

## Quickstart for code agents

Each doc in `docs/` is written to be picked up by a separate code agent and implemented independently. The agent task breakdown lives in [docs/09-agent-task-breakdown.md](docs/09-agent-task-breakdown.md) and identifies which docs are blocking, which can run in parallel, and the contract surface each agent must respect.

There are now thirteen agents (A–M):

- **A–E** — match-stream critical path (spec, mock producer, stream server, renderer, spec client).
- **F–I** — match-stream parallel work (video ingest, CDN deploy, avatars, demo site).
- **J** — game service: predictions, leaderboards, badges, pools.
- **K** — Tournament Bot: Telegram + email + TOTP + passkey auth, notifications, group leaderboards.
- **L** — clip pipeline: headless renderer → MP4 variants → social posting.
- **M** — VStamp service: Merkle batching, Polygon anchoring, OpenTimestamps proofs.

Critical-path "watchable demo" remains a weekend-one job (agents A–E + minimal H). The full Tournamental launch with predictions, bot, VStamps, and clip distribution is a 2–4 week pack of work for a parallel team of code agents — roughly the timeframe to a tournament window like the 2026 World Cup.

## Build a plugin in 10 minutes

Tournamental ships a plugin SDK so third parties can drop in a replacement renderer, scorer, ingest source, identity provider, commentary voice, share-card pipeline, odds feed, or affiliate router without forking the core. Eight extension points are first-class in v0.1.

Quickstart:

- SDK: [`packages/plugin-sdk/`](packages/plugin-sdk) + [`packages/plugin-sdk/README.md`](packages/plugin-sdk/README.md)
- Reference plugin: [`packages/plugins/example-cel-shaded-renderer/`](packages/plugins/example-cel-shaded-renderer)
- Full architecture doc: [`docs/28-plugin-architecture.md`](docs/28-plugin-architecture.md)
- Revenue split via Drips: [`docs/19-open-source-and-contributor-revenue.md`](docs/19-open-source-and-contributor-revenue.md)

```bash
pnpm add @tournamental/plugin-sdk
# Create plugin.json declaring `provides: ["renderer"]` (or another capability)
# Export a default PluginFactory from src/index.ts
# Drop it in plugins/ for dev or publish to npm under @tournamental-plugin/*
```

Plugins are dynamically loaded at app boot. License must be Apache-2.0, MIT, BSD-2-Clause, or BSD-3-Clause (the manifest schema rejects everything else). Plugins shipped in `packages/plugins/*` or under the `@tournamental-plugin/*` npm scope receive a share of the upstream Drips treasury per [doc 19](docs/19-open-source-and-contributor-revenue.md).

## Deploys

CI/CD is build-slot blue-green: build to `<slot>-staging`, smoke-test on a
private port, atomic-swap `<slot>-prod`, PM2 reload. Worst-case ~2-3s
perceived downtime. Generalised across all monorepo apps.

- Architecture: [docs/47-cicd-pipeline.md](docs/47-cicd-pipeline.md)
- Deploy runbook: [docs/cicd/01-deploy-runbook.md](docs/cicd/01-deploy-runbook.md)
- Rollback: [docs/cicd/02-rollback-runbook.md](docs/cicd/02-rollback-runbook.md)
- Incident flag: [docs/cicd/03-incident-flag-runbook.md](docs/cicd/03-incident-flag-runbook.md)
- Secrets rotation: [docs/cicd/04-secrets-rotation-runbook.md](docs/cicd/04-secrets-rotation-runbook.md)

Top-level scripts: `pnpm deploy:staging --apps=marketing`,
`pnpm deploy:promote`, `pnpm deploy:rollback --app=marketing --buildKind=astro`.

## Positioning (short version)

Tournamental is **free-to-play**. Points are not redeemable for cash. We never operate as a sportsbook. We display public market odds (Polymarket, The Odds API) as a data layer for scoring difficulty; we surface affiliate links to regulated operators *only where legal for the user*. Sweepstakes pools are tracked but not custodial — users settle off-platform. Detailed regulatory framing (including the NZ-specific Polymarket/Kalshi situation) in [docs/15-tournamental-brand-and-positioning.md](docs/15-tournamental-brand-and-positioning.md).

## Disclaimer

This project is provided for educational and demonstration purposes only. Tournamental does not offer or facilitate real-money wagers. Producer implementations that consume copyrighted broadcasts, scrape paid data feeds, or republish licensed tracking streams are the responsibility of the operator running them, not this framework. Operators are responsible for confirming the legality of any market-data display or affiliate-link placement in their jurisdiction.

## License and structure

Tournamental ships **100% open source** under **Apache 2.0** (code) and **CC-BY-4.0** (docs). The brand, wordmark, and the official `@TournamentalBot` Telegram identity are owned by **Tournamental** and are *not* licensed for forks — see `TRADEMARK.md`. Anyone may fork the protocol, run their own instance, set their own affiliate destinations, build their own world.

**Contributor revenue share.** A fixed percentage of net affiliate revenue (and other monetization lanes) flows to a public Drips Network treasury that streams USDC to scored contributors quarterly. Code merges, accepted RFCs, games built on the platform, vulnerability disclosures, and major reviews all earn into the pool. **This is revenue share, not equity.** Full design and contributor onboarding in [docs/19-open-source-and-contributor-revenue.md](docs/19-open-source-and-contributor-revenue.md).

**Comparable structures.** Optimism, Filecoin, Mozilla, Linux Foundation, Radworks. Foundation-backed open protocol with brand-and-treasury controlled by the entity, contributor revshare via on-chain streaming.

Asset packs (avatars, stadium models, jersey textures) follow the licence of their original creators; the framework itself contains none.

## Sub-processors

Production Tournamental surfaces depend on the following third-party services. New contributors should know the data-flow boundary before shipping anything that touches user data. The same list appears in [SECURITY.md](SECURITY.md) for the security-disclosure context.

- **Supabase** -- managed Postgres + auth (user records, sessions, predictions, leaderboards).
- **Cloudflare** -- DNS, CDN, Workers, Tunnel, WAF; the public edge for every Tournamental surface.
- **Aiva SMS** -- SMS and WhatsApp gateway for OTP delivery during the auth flow.
- **GoHighLevel** -- CRM for syndicate signups and marketing automation.
- **npm registry** -- distribution channel for the `@tournamental/*` packages.
- **GitHub** -- source hosting, issues, discussions, releases, and security advisories.
- **Drips Network** -- on-chain contributor revenue treasury (Ethereum + L2).
- **Polymarket** -- read-only prediction-market odds used for difficulty scoring.
- **StatsBomb Open Data** -- read-only historical match data for the replay demos.

Sub-processor changes ship as their own PR with a CHANGELOG entry and a SECURITY.md update.

## Community

- **Discussions** -- ideas, help, and show-and-tell at [GitHub Discussions](https://github.com/0800tim/tournamental/discussions). Templates live in [`.github/DISCUSSION_TEMPLATE/`](.github/DISCUSSION_TEMPLATE/).
- **Discord** -- live chat at [discord.gg/tournamental](https://discord.gg/tournamental) (invite finalised at public-launch, see [docs/55-public-launch-checklist.md](docs/55-public-launch-checklist.md)).
- **Code of Conduct** -- the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Report violations to `0800tim@gmail.com`.
- **Security** -- private disclosure flow in [SECURITY.md](SECURITY.md). Do not open public issues for vulnerabilities.
