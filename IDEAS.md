# IDEAS — Backlog parking lot

> Out-of-scope thoughts that surface during work. Not yet promoted to issues, not yet on a sprint plan. Triaged weekly by the orchestrator. Each entry is one line — if it needs more, it should already be an issue.

Format: `- [year-month-day, source] description (status)`. Status is one of `open | promoted | rejected | shipped`. Once `shipped`, link to the PR.

## Backlog

### Renderer
- [2026-05-09, doc 04] WebXR / VR mode — scene already in three.js, additive lift. (open)
- [2026-05-09, doc 04] In-scene replay seek (snap to event time). (open)
- [2026-05-09, doc 04] Spectator chat / Twitch overlay. (open)
- [2026-05-09, doc 04] Stadium customisation per-team. (open)
- [2026-05-09, doc 07] Ready Player Me avatar tier — generates GLB from one player photo, swap into existing pipeline. (open)
- [2026-05-09, doc 07] Custom GLB avatar tier for forks (Roblox-style worlds). (open)
- [2026-05-09, doc 07] Ship full Mixamo retargets for the 12 stub animations (`walk`, `sprint`, `pass`, `header`, `shoot`, `tackle`, `fall`, `celebrate`, `throw`, `catch`, `dribble`, `jump`) — current build emits idle-clip stubs that satisfy the loader contract but read as static. Pipeline: download Mixamo FBX → `FBX2glTF` → drop in `apps/web/public/animations/`. (open)
- [2026-05-09, doc 07] Higher-fidelity body GLB: hand-modelled in Blender with a full Mixamo skeleton, tasteful low-poly silhouette (head/torso/arm separation rather than the current box approximation). Current self-authored body is functional but readable as boxes at close camera. (open)

### Producers
- [2026-05-09, doc 06] Per-player MOT tracking (TrackNet for ball, ByteTrack for players). (open)
- [2026-05-09, doc 06] Camera-pose estimation to back out world coordinates from broadcast view. (open)
- [2026-05-09, doc 06] Pose estimation for accurate kicking / heading animations. (open)
- [2026-05-09, doc 06] Multi-feed fusion (sideline + broadcast + tactical cam). (open)
- [2026-05-09, doc 11] Live-broadcast CV pipeline (own implementation, not LLM-based). (open)
- [2026-05-09, doc 11] UWB / RFID amateur-match tracking module — community capstone. (open)

### Spec extensions (need orchestrator-approved spec PR)
- [2026-05-09, doc 02] Player rotations beyond yaw (pitch/roll). (open)
- [2026-05-09, doc 02] In-scene crowd / weather / atmosphere. (open)
- [2026-05-09, doc 02] Multi-camera authoring as part of the wire format. (open)
- [2026-05-09, doc 02] event.commentary may need an `audio_uri` field for prerendered ElevenLabs audio. (open)

### Game / scoring
- [2026-05-09, doc 16] Dynamic per-tournament scoring rule overrides (sponsor "Comeback Cup" with 2× comeback points). (open)
- [2026-05-09, doc 16] Live-stream "Watch Party Mode" UI for pubs / Discord — see doc 14 mention. (open)

### Auth / identity
- [2026-05-09, doc 13] Voice messages from the bot (only after v0.1 lands). (open)
- [2026-05-09, doc 13] Sticker pack as viral asset. (open)
- [2026-05-09, doc 20] Behavioural-biometrics opt-in (typing cadence) — privacy-conscious, opt-in only. (open)

### Verification / Prediction IQ
- [2026-05-09, doc 17] Bitcoin-only OpenTimestamps tier marketing badge once Bitcoin proof completes. (open)
- [2026-05-09, doc 17] Prediction-IQ percentile breakdown by tournament stage (group vs knockout). (open)

### On-chain
- [2026-05-09, doc 21] UMA dispute integration for high-value pools. (open)
- [2026-05-09, doc 21] Multi-chain expansion beyond Polygon + Base (Arbitrum, Optimism). (open)

### Monetisation
- [2026-05-09, doc 18] Native iOS / Android app shipping (push, contacts integration, location). (open)
- [2026-05-09, doc 18] Advertiser / brand-safety dashboard for sponsored inventory placements. (open)
- [2026-05-09, doc 18] Verified-Pundit-as-creator monetisation flywheel (paid follower tier). (open)
- [2026-05-09, doc 18] Cross-domain expansion (elections, awards, entertainment) once sports platform stable. (open)

### Open source / contributor programme
- [2026-05-09, doc 19] Quarterly RetroPGF round to layer onto Drips streaming. (open)
- [2026-05-09, doc 19] Formal governance token (deferred to year 2+ if regulatory path appears). (open)
- [2026-05-09, doc 19] Public treasury dashboard at vtorn.com/foundation/treasury. (open)
- [2026-05-09, doc 19] Drips Network Drip List with 200 contributor addresses. (open)

### Marketing site
- [2026-05-09, VTorn Pitch.md] vtorn.com landing — coming-soon page with email capture. (open)
- [2026-05-09, VTorn Pitch.md] Pitch deck for sponsors / investors based on VTorn Pitch.md. (open)
- [2026-05-09, VTorn Pitch.md] Brand assets: logo, wordmark, colour palette, animation reel. (open)
- [2026-05-09, VTorn Pitch.md] OpenGraph share-card generator for matches and predictions. (open)

### Tooling
- [2026-05-09, CLAUDE.md] `scripts/sign-off.sh` — automate the end-of-session checklist. (open)
- [2026-05-09, CLAUDE.md] `scripts/new-session.sh` — bootstrap a session note from a template. (open)
- [2026-05-09, CONTRIBUTING.md] CI integration: GitHub Actions matrix for lint/test/build/security. (open)
- [2026-05-09, CONTRIBUTING.md] Pre-commit hook running gitleaks + lint locally. (open)
- [2026-05-09, REVIEW.md] Repo rename from `SimulatedSports` to `vtorn` once brand is locked. (open)

### Strategic / Tim-only
- [2026-05-09, REVIEW.md] License confirmation (Apache 2.0 vs MIT vs AGPL — Apache 2.0 currently set). (open)
- [2026-05-09, REVIEW.md] Cayman + NZ entity incorporation. (open)
- [2026-05-09, REVIEW.md] Domain DNS + Cloudflare account setup for vtorn.com. (open)
- [2026-05-09, REVIEW.md] Telegram bot username reservation (`@VTornBot` / variants). (open)

## Triage rules

- **Promoted**: orchestrator opens an issue, links it back here, marks `promoted`.
- **Rejected**: explanation in a one-line comment under the entry.
- **Shipped**: link to the merged PR.

Triage at the start of each sprint. Don't let this list become a graveyard — items older than 90 days that haven't been promoted should be pruned or actively rejected.
