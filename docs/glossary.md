# Tournamental glossary

Domain terms used across the codebase, alphabetical. If you find yourself explaining a term in plain English in two different docs, that term belongs here.

Whenever a term has more than one meaning in normal English, the entry pins it to the Tournamental-specific sense.

## A

**Affiliate router**, the service at [`apps/affiliate-router`](../apps/affiliate-router) that takes a partner ID + a click-context and resolves the geo-gated outbound URL while writing an audit row. See [`30-gamification-and-affiliate-spine.md`](30-gamification-and-affiliate-spine.md).

**Aiva**, Tim's messaging platform that exposes a unified gateway over WhatsApp / SMS / Telegram. Tournamental talks to it via [`packages/aiva-client`](../packages/aiva-client). Two specific surfaces: **Aiva-SMS** (transactional SMS via Twilio behind the gateway) and **Aiva-WhatsApp** (Baileys session pool fronted by the same gateway).

**Auto-director**, the camera director in the renderer that picks shot framing based on event type (goal, build-up, set piece). Defined in [`27b-fidelity-phase2-physics-director.md`](27b-fidelity-phase2-physics-director.md).

## B

**BracketPrediction**, a single user's full pre-tournament bracket, group winners, knockout fixtures, champion. Locked at the tournament-lock cutoff. See [`12-odds-and-predictions.md`](12-odds-and-predictions.md).

**Builder agent**, a code agent assigned to one app or package directory. Reads relevant docs, implements per spec, opens a PR. Constrained to its directory.

## C

**Card-style overlay**, a full-bleed mobile-first overlay that animates in as a card and out as a sheet. Used for kickoff alerts, prediction confirmations, and result celebrations. See [`apps/web/components/overlay`](../apps/web/components/overlay) and [`36-tournamental-ux-spec.md`](36-tournamental-ux-spec.md).

**Cascade**, when a knockout fixture's winner depends on an earlier fixture, the dependent fixture's prediction "cascades", that is, the user's pick auto-updates if the underlying bracket pick was wrong but the underlying winner reaches the same slot. The bracket-engine package handles cascade resolution.

**Cursor**, the position marker a poller persists between runs so it doesn't re-process the same item twice. Reddit, Mastodon, and Signal each have their own cursor in [`apps/dm-poll-forwarder`](../apps/dm-poll-forwarder).

## D

**Dead-letter queue**, when [`apps/dm-poll-forwarder`](../apps/dm-poll-forwarder) tries to forward a message and the downstream `dm-otp` rejects it permanently, the message lands in the DLQ rather than being retried indefinitely. JSONL-backed.

**DM-OTP**, the user-initiated DM flow where a user sends "TOURNAMENTAL <code>" to one of seventeen platforms (Telegram, WhatsApp, Discord, X, Reddit, etc.) and gets verified back through the same channel. See [`13-telegram-bot-and-auth.md`](13-telegram-bot-and-auth.md) and [`apps/dm-otp`](../apps/dm-otp).

**Drip List**, the on-chain Drips Network primitive that streams USDC to a fixed allocation of contributor addresses on a schedule. Tournamental maintains one main contributor Drip List. See [`40-drips-network-integration.md`](40-drips-network-integration.md).

**Drips**, the open-source revenue-distribution protocol Tournamental uses to share platform revenue with contributors. Apache-2.0 contributors share platform revenue per [`19-open-source-and-contributor-revenue.md`](19-open-source-and-contributor-revenue.md).

## F

**Foot-IK**, inverse kinematics applied to player feet to keep them planted on the pitch surface during run cycles and stops. Phase 4 polish in [`27d-fidelity-phase4-polish.md`](27d-fidelity-phase4-polish.md).

## G

**GroupId**, a stable identifier for a tournament group (e.g. `wc2026:group-A`). See [`packages/spec`](../packages/spec).

## H

**HUD**, heads-up display in the renderer (clock, score, possession). Must match the canonical match state at all times.

**Humanness Score**, a continuous 0–1 score per user, derived from linked-platform graph signals (account age, mutual follows, posting cadence). Used to rank friend leaderboards and to tier bot-policy enforcement. See [`20-identity-humanness-bots.md`](20-identity-humanness-bots.md).

## K

**KnockoutFixture**, a single knockout-stage match slot (RO16-1, QF-1, SF-1, F, 3rd-place). Two slots are bracket-derived (winner of X, runner-up of Y); both populate from group-stage results. Type defined in [`packages/spec`](../packages/spec).

## L

**LiveDataProvider**, the abstraction in [`apps/wc2026-data`](../apps/wc2026-data) over Sportradar / API-Football / mock backends. Providers emit `LiveMatchState` snapshots and the service multiplexes them as Server-Sent Events.

## M

**Magic-link**, a one-tap email login link. Issued by [`apps/dm-otp`](../apps/dm-otp) when the user picks email as the OTP channel. See [`13-telegram-bot-and-auth.md`](13-telegram-bot-and-auth.md).

**Magnus**, the Magnus effect on a curving ball. Phase 4 ball-physics target in [`27d-fidelity-phase4-magnus-mobile.md`](27d-fidelity-phase4-magnus-mobile.md). Implemented in [`packages/ball-physics`](../packages/ball-physics).

**MatchId**, a stable identifier for a match. Format: `<tournamentId>:<matchNumber>` (e.g. `fifa-wc-2026:m032`). The producer, renderer, game service, and odds-ingest all agree on it.

**MatchPrediction**, a per-match prediction inside a single match: 1X2 + scoreline guess, locked at kickoff. Distinct from a **BracketPrediction**, which covers the whole tournament.

**Mock producer**, [`apps/mock-producer`](../apps/mock-producer), a deterministic synthetic-match producer used to develop the renderer without real data. Seedable.

**MOT**, "moment of truth", the instant in a match when a goal is scored or a pen taken. Used by the auto-director to switch camera and by the clip pipeline to clip a window.

## O

**OracleStamp**, the on-chain signature Tournamental writes when settling a sweepstakes pool. Distinct from a VStamp (which proves a prediction was made before the result was known). See [`21-onchain-sweepstakes-oracle.md`](21-onchain-sweepstakes-oracle.md).

**OverlayRouter**, the client-side router in `apps/web` that decides which card-style overlay to show given the current route + match state. Owned by the per-match-pick-popup agent.

## P

**Pool**, a sweepstakes pool. User-organised, not custodial, Tournamental never holds funds. The on-chain settlement contract resolves payouts using an OracleStamp.

**Prediction IQ**, a long-term per-user reputation score, computed from VStamp'd predictions over time. Survives bracket cycles. See [`17-vstamp-and-prediction-iq.md`](17-vstamp-and-prediction-iq.md).

## S

**Settlement bridge**, the small worker inside [`apps/wc2026-data`](../apps/wc2026-data) that posts each unique `final` snapshot to `apps/game`'s `/v1/match/:id/result`. Triggers leaderboard recomputation.

**Sheet**, a half-screen overlay that slides up from the bottom edge. Used for action menus and confirmations. Dismissible by tap-outside. Distinct from a card-style overlay.

**Spec**, see [`02-spec.md`](02-spec.md). The JSON message contract every producer emits and every renderer consumes. **Sacred**, orchestrator approves every spec change.

**Spec stream**, the ordered sequence of spec messages for a single match. Producers emit it; the stream server fans it out via WebSockets. Renderers replay it locally with interpolation.

**StageId**, a stable identifier for a tournament stage: `group`, `ro16`, `qf`, `sf`, `final`, `third-place`.

**Sweepstakes**, see **Pool**.

**Syndicate**, a private group of users who share a leaderboard and (optionally) a sweepstakes pool. Created from the Tournament Bot.

## T

**Tiebreaker**, when two brackets are level on points, ties break on (1) earliest correct champion pick, (2) most underdog calls, (3) lowest VStamp commit timestamp. Implemented in [`packages/bracket-engine`](../packages/bracket-engine).

**Tournament**, the top-level competition (e.g. FIFA WC 2026). Consists of stages (group, ro16, qf, sf, final, third-place).

**Tournament Bot**, the Telegram bot at [`apps/tournament-bot`](../apps/tournament-bot). Handles auth, syndicate creation, push notifications, and group leaderboards.

## V

**VStamp**, a tamper-evident prediction receipt. The VStamp service batches a Merkle tree over a window of locked predictions and signs the root with Ed25519. See [`17-vstamp-and-prediction-iq.md`](17-vstamp-and-prediction-iq.md) and [`apps/vstamp`](../apps/vstamp).

**Verified-Pundit**, a public expert (commentator, journalist) whose locked predictions appear on a public leaderboard alongside ordinary users. Distinct badge in the bracket UI. Implemented in `apps/game/src/pundit/`.

## W

**WC2026**, short for FIFA World Cup 2026. The first live tournament Tournamental supports end-to-end. Data lives in [`apps/wc2026-data`](../apps/wc2026-data).
