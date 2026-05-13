# Tournamental docs, the hive-mind index

> **Read this first if you are an agent.** This file is the brain. Everything any contributor (human or AI) needs is one or two clicks away from here.
>
> If you only have 60 seconds, read these three: [`../CLAUDE.md`](../CLAUDE.md), [`01-vision-and-scope.md`](01-vision-and-scope.md), [`09-agent-task-breakdown.md`](09-agent-task-breakdown.md).

The docs in this folder are numbered roughly by area (00s mission, 10s product, 20s ops, 30s growth, 40s adjacent surfaces). Numbering is not strict, search by topic, not by digit. Every doc is CC-BY-4.0 (see [LICENSE-DOCS](LICENSE-DOCS)).

## Start here

| Doc | Why you read it |
| --- | --- |
| [`../CLAUDE.md`](../CLAUDE.md) | Operating contract for every agent every session. Sign-off checklist, commit conventions, performance rules. |
| [`01-vision-and-scope.md`](01-vision-and-scope.md) | What Tournamental is and isn't, in 30 seconds and then in detail. |
| [`09-agent-task-breakdown.md`](09-agent-task-breakdown.md) | The 16-agent matrix. Tells you who owns what. |
| [`02-spec.md`](02-spec.md) | The JSON spec, the contract every producer and renderer respects. |
| [`../AGENT-PROMPTS.md`](../AGENT-PROMPTS.md) | Copy-paste starter prompts for every agent type. |
| [`../REVIEW.md`](../REVIEW.md) | Current readiness audit of the design pack. |

## Architecture and contracts

| Doc | Summary |
| --- | --- |
| [`02-spec.md`](02-spec.md) | The canonical JSON message spec. Producers emit it, renderers consume it. Do not branch the spec. |
| [`03-architecture.md`](03-architecture.md) | End-to-end system topology, producers, stream server, CDN, game service, identity, VStamp. |
| [`08-cdn-distribution.md`](08-cdn-distribution.md) | Cloudflare CDN, manifest layout, chunk cadence, cache rules for the live stream. |
| [`22-deployment-and-tunnels.md`](22-deployment-and-tunnels.md) | Single source of truth for ports, tunnel ingress, and the caching matrix. **Always update with port changes.** |
| [`25-keys-and-secrets-required.md`](25-keys-and-secrets-required.md) | Every env var the platform expects, grouped by service. |
| [`32-auth-and-privacy.md`](32-auth-and-privacy.md) | Auth surfaces, JWT contract, session policy, privacy posture. |
| [`33-security-hardening-checklist.md`](33-security-hardening-checklist.md) | Per-PR security checks the reviewer agent runs. |

## Product surfaces

### Bracket app (the prediction game)

| Doc | Summary |
| --- | --- |
| [`12-odds-and-predictions.md`](12-odds-and-predictions.md) | Odds ingest, prediction lock, leaderboard, sweepstakes flow. |
| [`16-game-modes-and-scoring.md`](16-game-modes-and-scoring.md) | Ten game modes, the scoring formula, personality leaderboards. |
| [`30-gamification-and-affiliate-spine.md`](30-gamification-and-affiliate-spine.md) | The economic spine, affiliate router + gamification loops. |
| [`36-tournamental-ux-spec.md`](36-tournamental-ux-spec.md) | Bracket-app UX spec (canvas, taps, transitions, error states). |
| [`37-pwa-app-shell.md`](37-pwa-app-shell.md) | PWA shell, bottom nav, top app-bar, manifest, install affordance. |
| [`24-gamification-and-virality.md`](24-gamification-and-virality.md) | Virality loops, invites, badges, streaks, share cards. |

### Renderer / replay (the watch-along)

| Doc | Summary |
| --- | --- |
| [`04-renderer.md`](04-renderer.md) | Next.js + React Three Fiber renderer, the watchable surface. |
| [`05-mock-producer.md`](05-mock-producer.md) | Synthetic match generator for renderer dev. |
| [`06-video-ingest.md`](06-video-ingest.md) | Video → JSON pipeline (CV + LLM). |
| [`07-avatars-and-assets.md`](07-avatars-and-assets.md) | Procedural avatars, jersey textures, billboard faces. |
| [`11-historic-data-sources.md`](11-historic-data-sources.md) | Free historical data; AR-FR 2022 plan; the v0.1 demo target. |
| [`27-fidelity-roadmap.md`](27-fidelity-roadmap.md) | Roadmap for renderer fidelity over the next four phases. |
| [`27a-fidelity-phase1-mocap-rig.md`](27a-fidelity-phase1-mocap-rig.md) | Phase 1, mocap rig + run cycles. |
| [`27b-fidelity-phase2-physics-director.md`](27b-fidelity-phase2-physics-director.md) | Phase 2, physics + auto-director cameras. |
| [`27c-fidelity-phase3-stadium-crowd.md`](27c-fidelity-phase3-stadium-crowd.md) | Phase 3, stadium + crowd. |
| [`27d-fidelity-phase4-magnus-mobile.md`](27d-fidelity-phase4-magnus-mobile.md) | Phase 4, Magnus ball physics + mobile budget. |
| [`27d-fidelity-phase4-polish.md`](27d-fidelity-phase4-polish.md) | Phase 4 polish, foot-IK, weight transfer, breathing. |
| [`31-live-commentary-overlay.md`](31-live-commentary-overlay.md) | Live commentary overlay (ElevenLabs + caption track). |

### Backend services

| Domain | Docs |
| --- | --- |
| Auth & SMS | [`13-telegram-bot-and-auth.md`](13-telegram-bot-and-auth.md), [`32-auth-and-privacy.md`](32-auth-and-privacy.md), [`41-dm-poll-forwarder.md`](41-dm-poll-forwarder.md) |
| Identity | [`20-identity-humanness-bots.md`](20-identity-humanness-bots.md) |
| Social | [`14-clip-generation-and-social.md`](14-clip-generation-and-social.md), [`27-social-distribution-strategy.md`](27-social-distribution-strategy.md) |
| Live data | [`42-wc2026-live-data.md`](42-wc2026-live-data.md), [`11-historic-data-sources.md`](11-historic-data-sources.md) |
| Revenue | [`18-monetization.md`](18-monetization.md), [`19-open-source-and-contributor-revenue.md`](19-open-source-and-contributor-revenue.md), [`40-drips-network-integration.md`](40-drips-network-integration.md) |

API references for each service live under [`api/`](api/README.md). Every Fastify service exposes its OpenAPI spec at `/docs` when running.

### Marketing site

| Doc | Summary |
| --- | --- |
| [`15-tournamental-brand-and-positioning.md`](15-tournamental-brand-and-positioning.md) | Tournamental brand, taglines, NZ regulatory framing, monetisation overview. |
| [`23-analytics-and-marketing-insights.md`](23-analytics-and-marketing-insights.md) | Analytics events, KPIs, attribution. |
| [`35-competitor-ux-dossier.md`](35-competitor-ux-dossier.md) | UX teardowns of FIFA+, ESPN, Sleeper, Polymarket, Kalshi. |

### Onchain & monetisation

| Doc | Summary |
| --- | --- |
| [`17-vstamp-and-prediction-iq.md`](17-vstamp-and-prediction-iq.md) | Tamper-evident prediction receipts + Prediction IQ reputation. |
| [`18-monetization.md`](18-monetization.md) | Affiliate routing, sponsorship, Pro tier, B2B, creator, data licensing. |
| [`19-open-source-and-contributor-revenue.md`](19-open-source-and-contributor-revenue.md) | Apache 2.0, Tournamental, Drips Network revenue share. |
| [`21-onchain-sweepstakes-oracle.md`](21-onchain-sweepstakes-oracle.md) | User-organised on-chain pools + Tournamental-as-oracle. |
| [`29-polymarket-odds-integration.md`](29-polymarket-odds-integration.md) | How Polymarket numbers feed odds-ingest. |
| [`40-drips-network-integration.md`](40-drips-network-integration.md) | Drip List + revenue-distribution lifecycle. |

## Process and runbooks

| Doc | Summary |
| --- | --- |
| [`09-agent-task-breakdown.md`](09-agent-task-breakdown.md) | Who owns what across the 16 agents. |
| [`32-overnight-sprint-runbook.md`](32-overnight-sprint-runbook.md) | Overnight-sprint orchestration playbook. |
| [`34-orchestrator-runbook.md`](34-orchestrator-runbook.md) | Daily orchestrator routine, triage, merge, doc updates. |
| [`33-security-hardening-checklist.md`](33-security-hardening-checklist.md) | Per-PR security checklist. |
| [`playbook/01-add-a-new-app.md`](playbook/01-add-a-new-app.md) | How to scaffold a new app under `apps/`. |
| [`playbook/02-add-a-new-fastify-route.md`](playbook/02-add-a-new-fastify-route.md) | How to add a new HTTP route + OpenAPI annotation + test. |
| [`playbook/03-debug-a-failing-pr.md`](playbook/03-debug-a-failing-pr.md) | Common CI failure modes and their fixes. |
| [`playbook/04-merge-conflict-resolution.md`](playbook/04-merge-conflict-resolution.md) | Git rebase patterns we use; when to take theirs vs ours. |
| [`playbook/05-rolling-out-a-feature-flag.md`](playbook/05-rolling-out-a-feature-flag.md) | `<APP>_BACKEND=mock\|real` conventions and gating. |
| [`playbook/06-shipping-a-doc-update.md`](playbook/06-shipping-a-doc-update.md) | When code changes, doc changes, numbering and archive policy. |

## API reference

Every Fastify service registers `@fastify/swagger` + `@fastify/swagger-ui`. The generated OpenAPI 3.0 specs are committed under [`api/`](api/) and the Swagger UI is reachable at `/docs` on each running service.

| | |
| --- | --- |
| Index of all services + ports + UI URLs | [`api/README.md`](api/README.md) |
| Regenerate every spec | `pnpm -r --if-present run dump-openapi` |

## Glossary

[`glossary.md`](glossary.md) is the single source of truth for Tournamental-specific terms. If you find yourself defining "Verified-Pundit" or "Cascade" again, link instead.

## How to add to this index

- **Keep entries one line.** A summary cell that wraps three lines is too long.
- **Link with relative paths.** Never absolute, the docs are read inside Obsidian, GitHub, IDE previews, and the website.
- **New docs go under the matching section.** If no section fits, add a new one, but ask yourself first whether you actually have a new concern or just a new doc on an existing concern.
- **Numbering is not strict.** Pick the next free number near related docs. The first two digits are the "neighbourhood", see top of file.
- **Code change → doc change.** A PR that mutates a public surface without updating the relevant doc fails review per [`../CLAUDE.md`](../CLAUDE.md).
- **Stale notes archive.** Session notes older than 30 days move to `sessions/archive/`. Doc archives go to `docs/archive/` only when a doc is fully replaced.
