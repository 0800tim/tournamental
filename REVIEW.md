# REVIEW — VTourn docs pack readiness audit

> Audit of the design pack as of **2026-05-09**. Goal: confirm the docs are sufficient for Claude code agents to begin building, identify any gaps that would block a parallel agent run, and define the **AR-FR 2022 critical path** to get a watchable demo running on the dev server fastest.

## TL;DR

The pack is **ready to build from**. 21 design docs + spec + examples + 4 LLM prompts + a one-page pitch + this review. All internal cross-links resolve. No blocking contradictions found.

The single material gap (penalty shoot-out events for the AR-FR demo) was patched during this review and the spec is now at v0.1.1.

The orchestration layer (CLAUDE.md, AGENT-PROMPTS.md, CONTRIBUTING.md, IDEAS.md, sessions/) ships alongside this review so a code agent can be dropped into the repo with a single starter prompt and bring up the AR-FR demo.

## Doc inventory (final state)

```
VTourn Pitch.md                                    one-page elevator pitch
README.md                                   entry point + doc index
REVIEW.md                                   this file
CLAUDE.md                                   orchestrator + agent ops entrypoint (NEW)
CONTRIBUTING.md                             contributor guide (NEW)
AGENT-PROMPTS.md                            copy-paste starter prompts (NEW)
IDEAS.md                                    backlog parking lot (NEW)
docs/01-vision-and-scope.md                 what we're building
docs/02-spec.md                             JSON message spec (v0.1.1)
docs/03-architecture.md                     end-to-end system
docs/04-renderer.md                         Next.js + R3F renderer
docs/05-mock-producer.md                    synthetic match generator
docs/06-video-ingest.md                     video → AI → spec
docs/07-avatars-and-assets.md               player likeness + animations
docs/08-cdn-distribution.md                 Cloudflare strategy
docs/09-agent-task-breakdown.md             16 agents (A–P)
docs/10-roadmap.md                          weekend MVP and beyond
docs/11-historic-data-sources.md            StatsBomb open data + AR-FR plan
docs/12-odds-and-predictions.md             gamification, leaderboards (flat-file)
docs/13-telegram-bot-and-auth.md            bot + multi-mode auth
docs/14-clip-generation-and-social.md       clip pipeline → socials
docs/15-vtourn-brand-and-positioning.md      brand, NZ regulatory framing
docs/16-game-modes-and-scoring.md           10 modes, scoring formula
docs/17-vstamp-and-prediction-iq.md         blockchain verification + Prediction IQ
docs/18-monetization.md                     six revenue lanes
docs/19-open-source-and-contributor-revenue.md  Apache 2.0 + Drips + VTourn Holdings
docs/20-identity-humanness-bots.md          multi-provider OAuth + Humanness Score
docs/21-onchain-sweepstakes-oracle.md       trustless settlement via VTournOracle
spec/types.ts                               canonical TypeScript types (v0.1.1)
spec/examples/match-init.json
spec/examples/state-stream.jsonl
spec/examples/events.jsonl
prompts/frame-analyzer.md
prompts/commentary-extractor.md
sessions/README.md                          session-note pattern (NEW)
```

Approximately 350KB of docs total.

## Findings from the audit

### Fixed during this review

| Finding | Severity | Resolution |
|---------|----------|------------|
| **No penalty shoot-out events in spec.** AR-FR demo (doc 11) needs them; doc 11 proposed them as a v0.2 spec extension. | Blocking AR-FR | **Patched.** Spec bumped to v0.1.1 with `event.penalty_shootout_start`, `event.penalty_attempt`, `event.penalty_shootout_end`. Doc 02 updated to note the bump. Backward-compatible minor version. |

### Recommendations folded into CLAUDE.md and AGENT-PROMPTS.md

| Finding | What was done |
|---------|--------------|
| **No `apps/` paths for the StatsBomb-replay producer.** Doc 11 describes the work but doesn't pin a path. | CLAUDE.md pins it at `apps/statsbomb-replay/`. Other apps follow doc 09's existing path conventions. |
| **No package manager / monorepo tool decision.** | CLAUDE.md picks **pnpm + workspaces** for TS, **uv** or pip for Python. |
| **No top-level `package.json` or `pnpm-workspace.yaml`.** | The orchestrator agent will create these in Phase 0 per CLAUDE.md instructions. |
| **No dependency list for the dev server.** | CLAUDE.md lists Node 20+, pnpm, Python 3.11+, ffmpeg, Redis, Postgres (optional), Docker. |
| **Critical path for AR-FR demo not flagged separately.** Doc 09 lists 16 agents, doc 10 has a "weekend MVP" but it targets the synthetic mock, not AR-FR. | CLAUDE.md defines a focused **AR-FR-first** Phase 1 with four parallel agents (StatsBomb replay producer, renderer, avatars/assets, mock producer) and skips lanes that aren't on the critical path (stream server, CDN, bot, VStamps, gamification). |
| **No Match-ID lookup procedure for the AR-FR final.** Doc 11 says "filter `competitions.json`, then `matches/43/106.json`". | AGENT-PROMPTS.md gives the producer agent the exact lookup steps. |
| **No CLI runbook for the demo.** | CLAUDE.md ends with a one-page runbook for the orchestrator. |
| **No session-note / sign-off discipline.** | New `sessions/` directory with README; sign-off protocol in CONTRIBUTING.md and AGENT-PROMPTS.md; commit-message conventions defined. |
| **No PR review pipeline for code agents.** | CONTRIBUTING.md defines the lint / type / test / security / spec-conformance pipeline; AGENT-PROMPTS.md has a dedicated reviewer prompt. |
| **No place for new ideas that are out of sprint scope.** | New `IDEAS.md` parking lot. |

### Items deferred (no action needed pre-launch)

These are noted in IDEAS.md or in the relevant doc; they do not block the AR-FR demo or the broader v0.1 launch:

- **Smart-contract audit** — full audit of VTournOracle / PoolFactory / Pool by Trail of Bits / OpenZeppelin / ConsenSys Diligence. 6–10 weeks, $30k–$80k. On-chain pools (doc 21) ship after audit.
- **Foundation incorporation** — Cayman Foundation + NZ Op Co structure (doc 19). $20k–$50k all-in. Defer until revenue justifies.
- **Native iOS / Android apps** — doc 20 specifies these for contacts integration. Web + Telegram bot covers v0.1 launch.
- **Polymarket / Bet365 / etc. affiliate deal negotiations** — doc 18 outlines the structure. Lead time ~1–3 months per operator. Begin negotiations early but launch with whatever has been signed.
- **Full Tournament Prophet bracket UI** — doc 16 spec is solid, the bracket-grid component is ~2 weeks of UI work; ships post-AR-FR demo.

### Items NOT done that are on the critical path

After the AR-FR demo ships, the next visible items are:

- The CDN-fronted spec stream (doc 8) — needed once we have more than one viewer.
- The flat-file gamification snapshotter (doc 12) — needed once predictions go live for users.
- The VStamp service (doc 17) — needed for the verified-prediction marketing claim.
- The Tournament Bot (doc 13) — needed for the auth + push channel.

All of these are independent of the renderer/producer pair, so they can begin in parallel as soon as the AR-FR demo proves the spec works end-to-end.

## Critical path for AR-FR demo (Phase 1)

The fastest path to "watch Argentina vs France 2022 World Cup Final replay in a browser":

1. **StatsBomb-replay producer** (`apps/statsbomb-replay/`) — Python service that reads StatsBomb open data for the AR-FR final, converts events + 360 freeze-frames to spec messages, emits over WebSocket or NDJSON file. **~1 day for one focused agent.**
2. **Reference renderer** (`apps/web/`) — Next.js + R3F per doc 04. Connects to the producer's stream, renders pitch + 22 procedural-avatar players + ball + HUD with score/clock, animation FSM, broadcast camera. **~2–3 days for one focused agent.**
3. **Avatar pipeline** (in `apps/web/public/` + `packages/avatar/`) — single shared body GLB, runtime canvas-generated jersey textures with team colours and numbers, billboard face quads with images scraped from Wikidata for the 22 starters. **~1 day for one focused agent.**
4. **Mock producer** (`apps/mock-producer/`) — small synthetic match generator per doc 05, useful as a fast renderer-dev fixture even though the headline demo is StatsBomb-driven. **~half a day.**

End-to-end target: **3–5 days** with three or four agents working in parallel, plus an orchestrator who keeps the spec frozen and runs the integration check.

## Spec v0.1.1 changes summary

```
+ event.penalty_shootout_start
+ event.penalty_attempt
+ event.penalty_shootout_end
```

All other types unchanged. Forward-compatible — a 0.1.0 renderer plays a 0.1.1 stream by ignoring the unknown event types (per the spec's MUST-ignore-unknown rule). A 0.1.1-aware renderer animates the shootout properly.

## Outstanding strategic decisions (Tim-only)

These don't block agents but should be made before the v0.1 marketing launch:

1. **Repo name and visibility.** The folder is `SimulatedSports` but the brand is VTourn. When to rename. Where to host (GitHub `vtorn` org? Codeberg? self-hosted?).
2. **License confirmation.** Apache 2.0 for code, CC-BY-4.0 for docs (recommended in doc 19) — confirm before LICENSE files are committed.
3. **Match-ID and tournament tag conventions.** What's the canonical match_id for the 2022 WC Final in the spec stream? Suggested: `fifa-wc-2022-final-arg-fra-2022-12-18`. Document and use consistently.
4. **Brand assets.** A real logo / wordmark is needed before any marketing surface goes live. Currently sketched in doc 15.
5. **Telegram bot username.** `@VTournBot`, `@VTournTournamentBot`, or other. Reserve early.
6. **vtourn.com landing.** A simple coming-soon page with email capture should go up well before the demo to start collecting interest.

## Verdict

**Ready to build.** The orchestration layer (CLAUDE.md + AGENT-PROMPTS.md + CONTRIBUTING.md) ships alongside this review. A code agent can take the orchestrator prompt, follow it, and produce the AR-FR demo within a working week.
