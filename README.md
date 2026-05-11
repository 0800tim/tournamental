# Tournamental

> **Predict the tournament. Beat the market. Prove it.**
>
> A live tournament prediction game with a 3D match-renderer watch-along, Telegram-bot identity, blockchain-verified prediction receipts, and a long-term reputation network — all on a write-once / serve-via-CDN architecture so a million viewers cost the same as ten.

Domain: **tournamental.com**. Brand expansion when needed: **Tournamental — Verified Tournament Oracle Network**.

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
│   ├── 19-open-source-and-contributor-revenue.md  Apache 2.0, Tournamental Holdings, Drips Network revshare
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

Tournamental ships **100% open source** under **Apache 2.0** (code) and **CC-BY-4.0** (docs). The brand, wordmark, and the official `@TournamentalBot` Telegram identity are owned by **Tournamental Holdings** and are *not* licensed for forks — see `TRADEMARK.md`. Anyone may fork the protocol, run their own instance, set their own affiliate destinations, build their own world.

**Contributor revenue share.** A fixed percentage of net affiliate revenue (and other monetization lanes) flows to a public Drips Network treasury that streams USDC to scored contributors quarterly. Code merges, accepted RFCs, games built on the platform, vulnerability disclosures, and major reviews all earn into the pool. **This is revenue share, not equity.** Full design and contributor onboarding in [docs/19-open-source-and-contributor-revenue.md](docs/19-open-source-and-contributor-revenue.md).

**Comparable structures.** Optimism, Filecoin, Mozilla, Linux Foundation, Radworks. Foundation-backed open protocol with brand-and-treasury controlled by the entity, contributor revshare via on-chain streaming.

Asset packs (avatars, stadium models, jersey textures) follow the licence of their original creators; the framework itself contains none.
