# 09, Agent Task Breakdown

> Parallelisable workstreams for code agents. Each row is a self-contained job with a defined contract on its boundaries. Agents working on different rows should not need to communicate, the spec is the contract.

## Dependency graph

```
                 ┌─────────────────┐
                 │ A. spec/types.ts│  (already written, frozen contract)
                 └────────┬────────┘
                          │
        ┌─────────────────┼─────────────────┬─────────────────┐
        ▼                 ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌─────────────────┐
│ B. Mock       │ │ C. Stream     │ │ D. Renderer   │ │ E. Spec client  │
│    producer   │ │    server     │ │    (web app)  │ │    package      │
│   (Node TS)   │ │   (Node TS +  │ │  (Next + R3F) │ │    (TS lib)     │
│               │ │    Postgres)  │ │               │ │                 │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └────────┬────────┘
        │                 │                 │                  │
        └─────────────────┴─────────────────┴──────────────────┘
                  shared protocol = JSON spec, NDJSON wire
                          │
        ┌─────────────────┼─────────────────┬─────────────────┐
        ▼                 ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌─────────────────┐
│ F. Video      │ │ G. CDN        │ │ H. Avatars/   │ │ I. Demo site +  │
│    ingest     │ │    deploy     │ │    asset pack │ │    landing page │
│   (Python)    │ │   (Cloudflare)│ │               │ │                 │
└───────────────┘ └───────────────┘ └───────────────┘ └─────────────────┘

  Gamification, verification & social tier (independent of A–I, share Redis + CDN):

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐
│ J. Game service │  │ K. Tournament   │  │ L. Clip pipeline + social   │
│  (predictions,  │  │    Bot          │  │    distributor              │
│   leaderboards, │◀▶│  (Telegram +    │  │  (headless renderer + ffmpeg│
│   badges, pools)│  │   email + TOTP  │  │   + Instagram/TikTok/YT/TG) │
│   Redis + CDN   │  │   + passkey)    │  │   R2 / S3                   │
└────────┬────────┘  └─────────────────┘  └─────────────────────────────┘
         │
         ▼  prediction lock hashes
┌─────────────────────────────────────────┐
│ M. VStamp service                       │   Merkle batches → Polygon
│   (verification + Prediction IQ)        │   anchor + OpenTimestamps
│   Node TS                               │   Bitcoin proof. Public proof
└─────────────────────────────────────────┘   pages + Prediction IQ.

  Identity, monetisation, and on-chain settlement (independent extensions):

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐
│ N. Affiliate    │  │ O. Identity +   │  │ P. On-chain pools + Oracle  │
│    router       │  │    Humanness    │  │    (Solidity + TS)          │
│  (geo + EPC)    │  │  (OAuth, friend │  │  PoolFactory, Pool,         │
│   Node TS       │  │   graph, bots)  │  │  TournamentalOracle on Polygon/Base│
└─────────────────┘  └─────────────────┘  └─────────────────────────────┘
```

Letters A–E are the critical path for the v0.1 demo. F–I can start in parallel with E after A is frozen. **J–P are the platform/business tier** and are independent of A–I; they can start as soon as the spec is frozen and Redis is up. K depends on J for shared user records; L depends on the renderer (D) supporting a `?record=1` query param; M depends on J for the prediction-lock event stream; N can start anytime; O coordinates with K (shared user record); P depends on M's oracle-key infrastructure.

## Agent briefs

### Agent A, Spec freeze

**Status**: complete. Files: `spec/types.ts`, `spec/examples/*`, `docs/02-spec.md`.

Boundary: bumping `spec_version` requires the spec author. All other agents may read the spec but must not modify it.

### Agent B, Mock producer

**Repo path**: `apps/mock-producer/`.

**Reads**: `spec/types.ts`. **Writes**: stream output (WS / SSE / file / stdout).

**Brief**: build a Node 20+ TypeScript service that emits a deterministic 90-min synthetic match per [docs/05-mock-producer.md](05-mock-producer.md). Single binary. Spec validation tests must pass.

**Done when**: `npm run mock -- --seed=42 --out=ws --port=4001` starts a server, the renderer can connect to it, and a 90-min replay produces the full set of canonical event types.

### Agent C, Stream server (origin)

**Repo path**: `apps/stream-server/`.

**Reads**: producer connections, Postgres. **Writes**: chunked NDJSON files on disk + manifest, Postgres rows, live WebSocket.

**Brief**: Node 20+ TypeScript. WebSocket fan-in from producers, validate against spec, persist to Postgres, write 1s/5s NDJSON chunks + `live.m3u8` manifest, expose live WS for clients. See [docs/03-architecture.md](03-architecture.md) and [docs/08-cdn-distribution.md](08-cdn-distribution.md).

**Done when**: mock-producer (Agent B) → stream-server → renderer (Agent D) works over WebSocket *and* over a localhost-served chunk directory.

### Agent D, Reference renderer

**Repo path**: `apps/web/`.

**Reads**: live WS or chunked manifest. **Writes**: a webpage.

**Brief**: Next.js 14 + React Three Fiber per [docs/04-renderer.md](04-renderer.md). 22 player avatars + ball + pitch + minimal stadium + HUD, animation FSM, broadcast / top-down cameras, 60fps target. Procedural avatars first (use shared body GLB + jersey texture + billboard face); RPM and custom GLB avatar tiers can land after MVP.

**Done when**: connecting to a mock-producer stream shows a watchable 90-min match with score updating on goals.

### Agent E, Spec client package

**Repo path**: `packages/spec-client/`.

**Reads**: live WS URL or manifest URL. **Writes**: a tiny TS library exporting `useMatchStream(url)` (React) and `openMatchStream(url, onMessage)` (vanilla).

**Brief**: Reusable connector. Handles WS reconnect, chunk-based playback (manifest poll + sliding fetch), spec validation, ring buffer for events. Renderer (D) imports from this; forks reuse it.

**Done when**: D consumes only via this package and tests cover both transports.

### Agent F, Video ingest

**Repo path**: `apps/video-ingest/`.

**Reads**: a video URL or path, prompt files in `prompts/`, model API keys. **Writes**: stream output to stream-server.

**Brief**: Python 3.11 pipeline per [docs/06-video-ingest.md](06-video-ingest.md). ffmpeg → Whisper + vision LLM → event extractor → spec emitter. Cost-conscious sampling, perceptual-hash caching of frame descriptions.

**Done when**: a recorded match video produces a spec-valid stream that, when piped to the renderer, shows a watchable approximation of the original (≥80% goal recall, correct final score).

### Agent G, CDN deploy

**Repo path**: `infra/cloudflare/`.

**Brief**: Terraform or Wrangler config for a Cloudflare zone serving `streams.example.com` per [docs/08-cdn-distribution.md](08-cdn-distribution.md). Cache rules, tiered caching, brotli, manifest TTL of 1s. Smoke test: a million-virtual-viewer load test against a single origin server stays under 50 origin reqs/sec.

**Done when**: a chunk URL is hit from 5 globally distributed PoPs and shows `cf-cache-status: HIT` after the first miss.

### Agent H, Avatars and asset pack

**Repo path**: `assets/`, `apps/web/public/`.

**Brief**: per [docs/07-avatars-and-assets.md](07-avatars-and-assets.md). Author or curate the body GLB + 15 Mixamo animations + ball + low-poly stadium + sane defaults. Verify CC0 / open licenses for everything checked in.

**Done when**: renderer asset bundle ≤ 30MB, no console errors, animations blend cleanly.

### Agent I, Demo site / landing

**Repo path**: `apps/web/app/(marketing)/`.

**Brief**: a marketing landing page at `/` explaining the project, a live demo at `/match/demo` running an always-on mock producer, contributor docs at `/docs`, and OpenGraph share cards generated from match state. Aim: a Twitter clip can land here and the project explains itself in 30 seconds.

**Done when**: cold visitor lands on `/`, clicks "watch demo", and is rendering a match within 5 seconds.

### Agent J, Gamification service (predictions, badges, leaderboards, pools)

**Repo path**: `apps/game-service/`, `packages/snapshotter/`.

**Reads**: spec event stream (for prediction settlement), Redis (KV writes), Polymarket / The Odds API (for odds). **Writes**: Redis hot KV, JSON snapshot files to `/v1/static/...` consumed by clients via CDN.

**Brief**: per [docs/12-odds-and-predictions.md](12-odds-and-predictions.md). Node 20+ TypeScript. Redis as the write authority; snapshotter flushes JSON every 5–60s depending on file. No SQL. Implements: profile data shape, friends, predictions, lock rules, scoring, badges, granular leaderboards (global / country / city / team / friend / pool / tournament / round / day), self-organised sweepstakes pools, affiliate routing, Polymarket/Odds API ingestion, market_update event publishing on the spec side-channel.

**Done when**: bot-driven predictions land in Redis, snapshotter produces correct CDN JSON, leaderboards refresh on a 10s tick, scoring engine resolves predictions when match events arrive, badges award on the right milestones, pool flow works end-to-end without ever handling money.

### Agent K, Tournament Bot (Telegram + auth + notifications)

**Repo path**: `apps/tournament-bot/`.

**Reads**: shared Redis (with Agent J), spec event stream (for live notifications), profile/leaderboard CDN JSON. **Writes**: Telegram outbound messages, Redis user records, web session tokens for the web app.

**Brief**: per [docs/13-telegram-bot-and-auth.md](13-telegram-bot-and-auth.md). Node 20+ TypeScript using grammY. Webhook mode behind Cloudflare. Implements: three auth paths (one-time code, login widget, bot-first), command router for `/predict /pool /leaderboard /streak /share /clip`, inline-keyboard prediction flow, Telegram Mini App container for the web view, notification dispatcher with per-user rate limits, group-chat leaderboard install (`/setup`), localisation pack, viral share intents, channel posting for the always-on announcement channel.

**Done when**: a fresh user can sign up via Path A, B, or C in under 30s; predicting the next match takes ≤4 taps; goals in predicted matches notify within 5s; a fresh group chat with the bot in it works as a private leaderboard out of the box.

### Agent N, Affiliate routing engine

**Repo path**: `apps/affiliate-router/`.

**Reads**: `cf-ipcountry` from request, `operators.yaml`, current EPC tracking. **Writes**: click events to durable storage, conversion records when affiliate postbacks fire.

**Brief**: per [docs/18-monetization.md](18-monetization.md). Node 20+ TypeScript. Geo + age-gate + legality lookup + EPC-rank routing for every outbound market-link click. NZ users see no offshore-sportsbook links (TAB monopoly hard rule); US/UK/AU users see only locally-licensed operators. Own-side click and conversion tracking, never trust each operator's dashboard alone.

**Done when**: a US user is routed to DraftKings/FanDuel; a UK user to Bet365 if approved; a NZ user sees no links unless TAB NZ has approved an affiliate deal; every click writes to the durable store with `(user_id, operator, region, ts)`; daily EPC report ranks operators correctly.

### Agent O, Multi-provider identity service + Humanness Score

**Repo path**: `apps/identity-service/`, `packages/humanness/`.

**Reads**: provider OAuth callbacks, friendship graph, behavioural signals from app/bot/web. **Writes**: user-provider links in Redis, humanness score history, friend graph (Neo4j or DuckDB+parquet), three-flavour leaderboard inputs.

**Brief**: per [docs/20-identity-humanness-bots.md](20-identity-humanness-bots.md). Node 20+ TypeScript. Implement OAuth flows for Google, Apple, Facebook, X, LinkedIn, GitHub, Discord, WhatsApp Business. Native iOS/Android apps with hashed-PSI contacts sync. Humanness Score nightly recomputation (provider stack + friend reciprocity + behaviour − bot signals). Bot self-declaration UX. Three-flavour leaderboard data feeds (Combined / Humans / Bots). Friend ring detection.

**Done when**: a user can link 5+ providers in <30s each from the profile page; humanness score correctly increments and breakdown view shows source-of-truth; bot self-declaration toggle works and surfaces correctly across all leaderboards; planted bot ring of 5 is detected by nightly graph analysis.

### Agent P, On-chain pool factory and TournamentalOracle

**Repo path**: `apps/onchain/`, `contracts/`.

**Reads**: spec results pipeline (for oracle publication), web UI for pool deployment. **Writes**: signed transactions to PoolFactory and TournamentalOracle on Polygon + Base; published result events.

**Brief**: per [docs/21-onchain-sweepstakes-oracle.md](21-onchain-sweepstakes-oracle.md). Solidity contracts (Pool, PoolFactory, TournamentalOracle) + audit by Trail of Bits / OpenZeppelin / ConsenSys Diligence (budget $30k–$80k). TypeScript publisher service that takes settled match results from the spec pipeline, formats them as oracle MatchResult structs, signs with the 4-of-7 multisig, and publishes to both chains. Web UI flow for pool creation, joining, depositing, predicting, finalising. Geo-restriction so NZ/US/UK/AU users don't see the on-chain pool option until counsel confirms.

**Done when**: pool deployment costs <$0.50 on Polygon; deposit + prediction flow under $0.20 combined; result publication batches a full matchday in one tx for <$50; finalize + withdraw flows correctly distribute USDC; no high-severity audit findings remain.

### Agent M, VStamp service (verification + Prediction IQ)

**Repo path**: `apps/vstamp-service/`.

**Reads**: prediction lock events from agent J, Polygon RPC, OpenTimestamps calendar API. **Writes**: per-prediction Merkle proofs back to Redis; on-chain anchor transactions; static proof pages on CDN.

**Brief**: per [docs/17-vstamp-and-prediction-iq.md](17-vstamp-and-prediction-iq.md). Node 20+ TypeScript. Hash predictions on lock. Build Merkle trees in 1-minute batches. Anchor roots to Polygon (signed by a cold-stored anchor key) and submit to OpenTimestamps for Bitcoin-backed proofs. Issue VStamp IDs in human-friendly format. Generate static proof pages with in-browser verification. Compute Prediction IQ (Elo-flavoured, market-relative) and per-sport sub-scores; snapshot to CDN profile JSON.

**Done when**: every locked prediction gets a VStamp ID within 100ms; Polygon anchor confirms within 60s; OpenTimestamps Bitcoin confirmation within 60min; public proof page verifies the Merkle proof against on-chain root in the user's browser without any Tournamental server involvement; Prediction IQ recomputes correctly given new resolutions.

### Agent L, Clip pipeline and social distributor

**Repo path**: `apps/clip-pipeline/`, `apps/social-distributor/`.

**Reads**: spec event stream, renderer (in record-mode), object storage (R2). **Writes**: MP4 variants to R2, Telegram channel posts, native API posts (Instagram / TikTok / YouTube / X / Facebook), Buffer/GoHighLevel webhook handoffs.

**Brief**: per [docs/14-clip-generation-and-social.md](14-clip-generation-and-social.md). Node 20+ TypeScript. Highlight detector watches `event.*`, builds clip jobs. Headless render worker drives the renderer in `?record=1` mode. ffmpeg encodes variants. LLM caption generator with curated hashtag lists. Distributor implements native API integrations *and* a CRM-planner fallback. Per-platform rate limiting; failed posts retry with backoff.

**Done when**: a goal in a live match produces a 15s vertical clip in storage within 30s and the clip lands in the Telegram channel within 5s of being ready. Native API posts to Instagram Reels and YouTube Shorts succeed within 5 minutes.

## Coordination

- **Single repo** (monorepo) with pnpm workspaces. Each agent owns a subdirectory; PRs gated on local tests passing in that subdirectory.
- **Spec changes** require an explicit agent A PR that bumps `spec_version` and includes migration notes in `docs/02-spec.md`.
- **Shared review loop**: nightly the renderer (D) is run against the latest mock-producer (B) and video-ingest (F) outputs. Any regression breaks the world; first commit author of the day fixes it.
- **No agent should branch the spec.** If an agent wants new fields, they propose them via a comment in `spec/types.ts` and tag agent A.

## Time-zoning the work

Critical path B → C → D + E is roughly two long days. F, G, H, I are largely independent and can be done by separate agents in parallel.

Suggested order if running fewer agents than rows:

1. A (done), then B + D + E in parallel (3 agents).
2. C joins after B starts emitting (so C can test against B's output).
3. F, G, H, I begin once D has its first watchable build.

That's the path that gets you a watchable demo soonest.
