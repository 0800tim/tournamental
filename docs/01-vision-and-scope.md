# 01 — Vision and Scope

> Why this project exists, what it is and isn't, and what success looks like. Read this first if you're new to the repo.

## Vision

A canonical, open JSON message stream for live sports — and a reference 3D renderer driven by it — so that anyone can:

- Build their own visual style (Roblox-flavoured, Fortnite-flavoured, anime, animal mascots, photoreal-but-stylized, tactical-board, VR) without re-inventing the data layer.
- Plug in any data source — a synthetic mock, AI watching a video, an official tracking feed, RFID jerseys, a person typing into a CLI — without changing any of the rendering code.
- Distribute to a million viewers without any per-viewer infrastructure cost, by leveraging CDN economics on the immutable append-only stream.

This is a **show-and-tell open-source project**. It exists to demonstrate what becomes possible when modern AI, GPU rendering, and CDN distribution are aimed at a problem together — in the same spirit as the OSINT and geo-analysis projects that turned public data into compelling visualisations.

## Why this is the right shape of project

Three observations make the timing right:

1. **The data exists and is increasingly accessible.** StatsBomb's free 2022 World Cup data alone gives full event streams plus 360° freeze-frames for every match including the AR-FR final. Optical and RFID tracking are licensable from multiple vendors. Vision LLMs can extract a *useful* approximation from any video.
2. **In-browser 3D is good enough.** Three.js / R3F / WebGL2 happily render 22 skinned characters on a 105m pitch at 60fps on mid-range phones. Native engines aren't required.
3. **The append-only spec stream pattern is essentially free to scale.** Once chunked and put behind Cloudflare, one origin server feeds millions of viewers. The economics flip from "expensive to broadcast" to "the stream is the cheap part."

## What this is

- A **JSON message spec** describing the live state of a sports match.
- A **reference renderer** in Next.js + React Three Fiber that consumes the spec and shows a watchable 3D match in the browser.
- A **set of producers** that emit the spec from different sources: synthetic mock, video-and-AI, StatsBomb replay, official feed adapters, commentary-only.
- A **stream server** that fans-in producers, persists, chunks, and serves to clients.
- A **CDN deployment recipe** for Cloudflare so the stream is distributable for free at any scale.
- A **set of LLM prompts** for the video-ingest pipeline.

## What this is not

- **Not a commercial broadcast system.** Operators using this to consume copyrighted feeds are responsible for their own legal exposure; the framework is content-agnostic.
- **Not a replacement for licensed tracking.** Where positional fidelity matters, the framework consumes licensed feeds via adapters; it doesn't pretend to derive metre-accurate positions from broadcast video.
- **Not a sports simulation game.** There is no AI that plays the game — the framework only renders what producers emit.
- **Not closed source.** Everything is MIT / CC0 / open-equivalent. Forking is the intended use, not the exception.
- **Not a service.** No accounts, no subscriptions, no SaaS tier. Run it yourself.

## Audience

Three groups, roughly equal weight:

- **Hobbyists and hackers** who want to build a stylized world for their favourite sport. The framework hands them the data layer.
- **Analysts** who want a simple, programmatic way to render real positional data without writing renderer code from scratch.
- **People who like sports** and want a personalised alt-cast — animal mascots, miniature figurines, tactical board — without waiting for Disney to license another Funday Football.

## Success metrics

The project succeeds when:

1. A stranger forks the repo and ships their own world within a week.
2. There are at least three meaningfully different worlds in the wild driven by the same spec.
3. At least one producer beyond mock + StatsBomb-replay exists, written by someone outside the original authors.
4. A weekend hacker can plug their own data feed in (RFID, scraped, custom CV) and have it rendered without contacting the maintainers.

The project is *not* succeeding if it becomes:

- A complicated framework with a steep on-ramp.
- A platform that requires central hosting or accounts.
- A magnet for legal pressure that scares away contributors.

## Non-goals (deliberately)

- Sub-100ms end-to-end latency. The framework is comfortable with 1–10s latency for free-tier scale; sub-second is available via direct WebSocket but not the design centre.
- Per-viewer interactivity (user-driven cameras across all clients, multiplayer chat, etc.). One stream out, many independent renderers in. Interactivity is a renderer concern.
- Universal sport support on day one. Soccer / association football is the design centre. Rugby, basketball, American football, hockey are accommodated by the spec but not test-covered initially.

## How to read the rest of the docs

- [`02-spec.md`](02-spec.md) — the JSON contract. Everything else implements or consumes this.
- [`03-architecture.md`](03-architecture.md) — how the pieces fit together.
- [`04-renderer.md`](04-renderer.md) — Next.js + R3F renderer design.
- [`05-mock-producer.md`](05-mock-producer.md) — synthetic match generator (MVP test fixture).
- [`06-video-ingest.md`](06-video-ingest.md) — turning a video stream into the spec via AI.
- [`07-avatars-and-assets.md`](07-avatars-and-assets.md) — what the players look like.
- [`08-cdn-distribution.md`](08-cdn-distribution.md) — Cloudflare deployment and chunking.
- [`09-agent-task-breakdown.md`](09-agent-task-breakdown.md) — parallel work plan for code agents.
- [`10-roadmap.md`](10-roadmap.md) — weekend MVP and beyond.
- [`11-historic-data-sources.md`](11-historic-data-sources.md) — research on free historic data; AR-FR 2022 demo plan.
- [`12-odds-and-predictions.md`](12-odds-and-predictions.md) — Polymarket / sportsbook odds, predictions game, badges, granular leaderboards, self-organised sweepstakes.
- [`13-telegram-bot-and-auth.md`](13-telegram-bot-and-auth.md) — Tournament Bot, plus Telegram / email-magic-link / TOTP / passkey auth; notifications, viral share loops.
- [`14-clip-generation-and-social.md`](14-clip-generation-and-social.md) — auto-clip pipeline; posts to TikTok / Reels / Shorts / X / Facebook / Telegram.
- [`15-tournamental-brand-and-positioning.md`](15-tournamental-brand-and-positioning.md) — Tournamental brand identity, taglines, NZ-aware regulatory framing, free-to-play / affiliate-link separation, monetisation paths.
- [`16-game-modes-and-scoring.md`](16-game-modes-and-scoring.md) — 10 game modes, the unifying scoring formula, multipliers, streaks, confidence chips, personality leaderboards.
- [`17-vstamp-and-prediction-iq.md`](17-vstamp-and-prediction-iq.md) — Merkle-batched blockchain verification (Polygon + OpenTimestamps), VStamp UX, Prediction IQ reputation algorithm.
- [`18-monetization.md`](18-monetization.md) — six revenue lanes (affiliate routing, sponsorship, Pro, B2B, creator leagues, data licensing), realistic revenue ramp, NZ TAB monopoly framing, build sequencing.
- [`19-open-source-and-contributor-revenue.md`](19-open-source-and-contributor-revenue.md) — Apache 2.0 license, Tournamental Holdings + Foundation structure, Drips Network contributor revshare, fork policy, comparable projects.
- [`20-identity-humanness-bots.md`](20-identity-humanness-bots.md) — multi-provider OAuth (Google / Apple / Facebook / X / LinkedIn / GitHub / Discord / WhatsApp), native-app contacts, Humanness Score algorithm, explicit bot policy, three-flavour leaderboards.
- [`21-onchain-sweepstakes-oracle.md`](21-onchain-sweepstakes-oracle.md) — user-deployed Pool contracts on Polygon / Base, TournamentalOracle (4-of-7 multisig) for verified match results, geo-restricted UI, trustless settlement.

`prompts/` holds the LLM prompts used by the video-ingest pipeline. `spec/` holds the canonical types and example payloads.
