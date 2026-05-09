# 14 — Clip Generation and Social Distribution

> Auto-generate platform-native MP4 clips from any moment in the rendered match, post them to TikTok, Instagram Reels, YouTube Shorts, X, Facebook, Telegram channels — driven by the same spec stream and event triggers. The render engine is the production studio; ffmpeg and platform APIs do the distribution. Telegram bot ([doc 13](13-telegram-bot-and-auth.md)) routes the user-share variants.

## What this layer produces

For each interesting moment in a match — goal, near-miss, save, red card, full-time — the system automatically produces a family of MP4 variants:

- **15s vertical (1080×1920)** — TikTok, Instagram Reels, YouTube Shorts.
- **30s vertical** — TikTok, Instagram Reels, YouTube Shorts (longer cut).
- **60s vertical** — Instagram Reels (max for many accounts), Reels-style cuts.
- **90s vertical** — Reels long-form.
- **3 min vertical** — full game-summary reels.
- **16:9 1920×1080** — YouTube, X / Twitter, embedded on partner sites.
- **1:1 1080×1080** — Instagram feed, Facebook feed.
- **Square 720×720 low-bitrate** — Telegram channel previews, embedded shareables.

Each variant gets:
- An LLM-written caption with platform-appropriate hashtags.
- A branded outro card (1.5s) with the Tournament Bot avatar.
- A subtitle track for the rephrased commentary line.
- An audio mix: in-scene SFX bed (subtle crowd noise + ball thud) + ElevenLabs commentary line.

These get uploaded to the configured platforms via either native APIs (Instagram Graph, TikTok, YouTube Data API) or routed through a CRM social planner (GoHighLevel, Buffer, Hootsuite) at the operator's preference.

## Architecture

```
   spec stream (one match)
         │
         ▼
   ┌──────────────────────────┐
   │ Highlight Detector       │   Watches event.* messages.
   │ (event.goal, shot...)    │   Emits "highlight requests"
   │                          │   with (start_ms, end_ms, kind).
   └────────────┬─────────────┘
                │
                ▼
   ┌──────────────────────────┐    grabs the spec chunks for the
   │ Clip Builder Service     │    requested window (init.json + N
   │ (Node TS)                │    chunks) and a deterministic seed.
   └────────────┬─────────────┘
                │
                ▼
   ┌──────────────────────────┐    runs the renderer in offline-render
   │ Headless Render Worker   │    mode at 30fps, writes frames to
   │ (Chromium + WebGL OR     │    /tmp/clip_<id>/frame_NNNNNN.png
   │  native three.js)        │    + audio mix to /tmp/clip_<id>/audio.wav
   └────────────┬─────────────┘
                │
                ▼
   ┌──────────────────────────┐    ffmpeg encodes:
   │ Encoder + Variant Forge  │    • 1080x1920 H.264, 5 Mbps
   │ (ffmpeg)                 │    • 1920x1080 H.264, 8 Mbps
   │                          │    • 1080x1080 H.264, 5 Mbps
   │                          │    • plus thumbnails, captions
   └────────────┬─────────────┘
                │
                ▼
   ┌──────────────────────────┐    object storage; each variant
   │ Asset Store (S3/R2)      │    has a stable URL. CDN-fronted.
   └────────────┬─────────────┘
                │
                ▼
   ┌──────────────────────────┐    posts to:
   │ Social Distributor       │    • Instagram Graph API
   │                          │    • TikTok API
   │                          │    • YouTube Data API
   │                          │    • X API v2
   │                          │    • Telegram channels (via bot)
   │                          │    • Buffer/GoHighLevel/Hootsuite (optional)
   └──────────────────────────┘
```

Stack:

- **Node 20+, TypeScript**, single repo `apps/clip-pipeline/`.
- **Chromium headless** with WebGL2 enabled (`--use-gl=angle` on Linux servers with EGL, fallback to SwiftShader for low-spec).
- **Puppeteer** to drive the page and intercept canvas frames via `page.screenshot()` per frame, *or* the renderer's built-in `record-mode` (URL flag `?record=1&seed=…&start_ms=…&end_ms=…`) that writes frames via the [`MediaRecorder`](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) API. Record-mode is faster.
- **ffmpeg** for encode and variant forging.
- **MinIO / Cloudflare R2** for asset storage. R2 has zero egress fees, perfect for this.
- **No DB**. Job state is a Redis hash; finished assets are referenced by the static manifest at `/v1/static/clips/<match_id>.json`.

## Highlight detection

A pure-functional service consuming the spec event stream. Rules:

| Trigger | Window | Variant priority |
|---------|--------|------------------|
| `event.goal` | t-7s to t+10s | every variant |
| `event.shot` (on_target, saved) | t-4s to t+5s | 15s vertical only |
| `event.shot` (on_target, scored) | redundant — covered by goal | — |
| `event.foul` (severity = red) | t-4s to t+8s | every variant |
| `event.foul` (severity = yellow) | t-3s to t+5s | 15s vertical only |
| `event.tackle` (success = true, defensive third) | t-3s to t+4s | 15s vertical only |
| `event.save` | t-4s to t+5s | 15s vertical only |
| `event.period_end` (period 90+) | full match summary | 60s, 90s, 3min, 16:9 |
| `event.match_end` | full-match summary | every long variant |

The detector emits a job message:

```json
{
  "job_id": "clip_01HXP4...",
  "match_id": "wc26-arg-fra-final",
  "trigger_event_id": "ev_...",
  "trigger_kind": "event.goal",
  "window_ms": [108412345, 108429345],
  "variants_requested": ["v15", "v30", "v60", "h169_60", "sq_30"],
  "priority": "high"
}
```

Priorities: `high` (goals, reds, full-match) → enter the fast queue. `normal` (shots, saves) → batch every 30s.

## Headless render worker

The renderer is the same Next.js + R3F app from [doc 4](04-renderer.md), but with two extra modes:

- **`?record=1`** — disables the live HUD (or shows a clean broadcast HUD), enables a deterministic time clock, runs the scene at exactly 30fps regardless of wall clock, and emits each frame via MediaRecorder into a single MP4 stream piped to stdout.
- **`?frames=1`** — emits PNG frames + a `manifest.txt` with frame timings, for cases where ffmpeg-side compositing is preferred over MediaRecorder.

A worker runs:

```bash
chromium-headless \
  --use-gl=angle --enable-webgl2-compute-context \
  --window-size=1080,1920 \
  --user-data-dir=/tmp/profile_${WORKER_ID} \
  "https://renderer.local/match/${MATCH_ID}?record=1&seed=${SEED}&start_ms=${S}&end_ms=${E}&format=v15"
```

The renderer takes ~3-4× real time on a beefy 2024 server with an iGPU; on a real GPU it runs near 1× real time. Wall budget for a 15s vertical clip end-to-end (job arrives → MP4 in R2): ~10-30s on a CPU-only box, ~5-15s on a GPU box.

For predictable QoS during live matches, the worker pool is per-priority. High-priority jobs get a dedicated 2-worker pool; normal jobs share a 4-worker batch pool.

### Audio mix

Three layers:

1. **Crowd bed** — looped CC0 ambient stadium noise, ducked under commentary. Stored as `assets/audio/crowd_bed.ogg`.
2. **SFX cues** — `goal.ogg`, `whistle.ogg`, `kick.ogg`, etc. Triggered by event timings.
3. **Commentary** — the `event.commentary.text` for the window, synthesised via ElevenLabs (or local Coqui XTTS for cost-free deployments) with the same `voice_id` used elsewhere.

Mixed in ffmpeg with `-filter_complex` against the rendered video stream.

## Encoding and variant forging

A single ffmpeg invocation per output variant. Example for the TikTok 15s vertical:

```bash
ffmpeg -i raw.mp4 -i commentary.wav -i crowd.ogg \
  -filter_complex "
    [1:a]volume=1.4[c];
    [2:a]volume=0.3,aloop=loop=-1:size=2e9[b];
    [c][b]amix=inputs=2:duration=shortest[mixed];
    [0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[v]
  " \
  -map "[v]" -map "[mixed]" \
  -c:v libx264 -preset veryfast -crf 22 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  -t 15 \
  out_v15.mp4
```

Branding overlay (Tournament Bot logo) is added as a 1.5s outro card concatenated, not burnt-in throughout. Subtitle track from rephrased commentary is added as a soft sub stream so platforms that show captions natively pick it up.

Thumbnails: extract the highest-action frame in the clip via a small heuristic (frame with maximum velocity sum across all visible players) using `ffmpeg -ss <t> -frames:v 1`.

## Captions and copy

For each variant, an LLM call generates platform-tuned copy. Prompt is in `prompts/clip-caption.md` (write next pass; structure mirrors the other prompts in the repo). Inputs:

- The match metadata (teams, score, minute).
- The trigger event (goal / red / shot etc.).
- The platform (tiktok / reels / shorts / x / fb / tg).
- Length budget (TikTok: 150 chars, Reels: 2200 chars, X: 280 chars, etc.).

Output:

```json
{
  "caption": "MESSI. AGAIN. Argentina lead France 3-2 in the World Cup Final. 🐐",
  "hashtags": ["#WorldCup2026", "#Messi", "#Argentina", "#WorldCupFinal", "#fyp"],
  "platform_specific": {
    "tiktok": "..." ,
    "reels": "...",
    "shorts": "..."
  }
}
```

Hashtags are sourced from a curated list per tournament (we don't let the LLM invent random tags — too risky for shadow-banning). The list is in `data/hashtags/<tournament_id>.json`.

## Distribution

### Native APIs

For each platform, a small wrapper service:

- **Instagram Graph API**: post Reels via business account. Requires a Meta app, business account on a Facebook Page, and access tokens with `instagram_content_publish`. Two-step: upload media URL → publish container.
- **TikTok**: their [Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started/) is in beta and requires application approval. Until approved, fall back to scheduled-post via Buffer/GoHighLevel.
- **YouTube Data API v3**: `videos.insert` for Shorts. OAuth token per channel, refreshed nightly.
- **X API v2**: media upload + tweet create. v2 has a free tier (limited writes); for production volume, the Basic tier ($100/mo) covers thousands of posts.
- **Facebook Pages**: same Meta app as Instagram, different endpoint.
- **Telegram channels**: via bot `sendVideo` to channel IDs we admin. Free, instant.

Each platform's quirks:
- **TikTok**: requires opening the captions URL with a fresh access token; clip must be uploaded within 1 hour of token issuance.
- **Instagram Reels**: cannot be edited after publish; thumbnail must be one of the video's frames.
- **YouTube Shorts**: detected automatically if vertical and < 60s; explicit `#Shorts` tag in description for safety.
- **X**: video must be < 140s, < 512 MB; must use chunked upload.

### CRM social planner fallback

If a platform doesn't have a stable API or the operator doesn't want to manage tokens, the distributor can hand off to **Buffer**, **Hootsuite**, **Later**, or **GoHighLevel** (Tim's likely preference). Each accepts a webhook with a media URL and caption; their pipeline handles platform-specific quirks. Higher latency (5-15 min) but zero per-platform engineering.

Configured per-platform in `config/distribution.yaml`:

```yaml
instagram:
  channel: native
  business_account_id: 17841...
  access_token_secret: meta_token

tiktok:
  channel: gohighlevel
  webhook: https://services.leadconnectorhq.com/...
  
youtube:
  channel: native
  client_id_secret: yt_oauth
```

### Per-platform queue and rate

- TikTok: max 30 posts/day per account in beta.
- Instagram Reels: ~25/day soft limit.
- YouTube Shorts: ~6/day before risking spam flag.
- X: 300 posts per 3-hour window, free tier far less.

The distributor enforces these via per-account token-bucket limiters. During a busy match (multiple goals), low-priority highlights are dropped or batched.

## Telegram channel posts

Highlights also fan out to:

- **`@SimSportsAnnounce`** main channel — every goal, every full-match summary.
- **Country-specific channels** — only highlights involving that country's team.
- **User DMs** — only if the user is in a relevant pool, opted in, or the highlight involves a player they predicted.

Telegram channel posts are the *fastest* surface — bot can `sendVideo` within seconds of clip render. Use this as the canary: if the clip looks bad on Telegram, hold the others.

## Brand and consistency

A single visual identity ships in `assets/brand/`:

- **Logo lockup** for outro card.
- **Lower-third bug** for in-clip score / minute.
- **Caption font** (Inter, OFL).
- **Color palette** matching the Tournament Bot persona.
- **Tournament Bot intro stinger** (1.0s, optional, only on long-form clips).

Forks of the renderer for stylized worlds (cartoon foxes, tabletop minis) override the brand assets in `apps/web/public/brand/` so their clips look distinct.

## Cost model

For a tournament (e.g. WC2026, ~100 matches over a month):

- **Compute** for clip generation: assume 10 highlights × 5 variants per match × 100 matches = 5,000 clips. Average 20s render time on a single 8-core box → ~28 hours of compute, fits a $100/mo VPS easily.
- **Storage**: 5,000 clips × ~3MB average = 15 GB. R2 storage: $0.22.
- **Egress**: depends on view counts. R2 has zero egress to internet, $0.36/GB to other clouds. If we serve direct, free.
- **LLM captions**: 5,000 × ~500 tokens in / 100 tokens out × Sonnet pricing ≈ $20.
- **TTS commentary**: ElevenLabs charges per character. 5,000 clips × ~150 chars × $0.30/1k chars ≈ $225. Or self-host Coqui XTTS for free.
- **Platform APIs**: free apart from X Basic tier ($100/mo).

Total: low hundreds of dollars per major tournament for a fully autonomous clip pipeline. Scales linearly with clip count, not viewer count (because variants are produced once and CDN-served).

## Acceptance criteria

- [ ] A `event.goal` triggers a 15s vertical clip in object storage within 30s of the event.
- [ ] Clip plays correctly on iOS Safari, Android Chrome, Telegram in-app player, and any modern desktop browser.
- [ ] Caption is platform-appropriate; hashtags from the curated list only; never includes the LLM hallucinating "#trending".
- [ ] Audio mix is intelligible: commentary clearly above crowd bed.
- [ ] Auto-post to Telegram channel succeeds within 5s of clip ready.
- [ ] Auto-post to Instagram Reels succeeds within 5 min of clip ready.
- [ ] Failed posts retry with exponential backoff up to 3 attempts before going to a human-review queue.
- [ ] Per-platform rate limits respected; exceeded jobs queued not dropped.
- [ ] Branded outro card present on every variant.

## What we deliberately don't build

- **Real-time live streaming** of the rendered scene to TikTok / YouTube. The headless renderer is fast enough for clipping but not for full live broadcast at scale. The CDN spec stream + browser renderer covers live; clips cover post-event.
- **AI-generated commentary outside of the existing pipeline**. The clip pipeline reuses commentary already in the spec stream; it doesn't re-narrate.
- **Manual editor UI**. Long-term we may want one, but every clip in v0.1-0.4 is automated. A bad clip is dropped; we do not hand-edit.
- **Engagement analytics**. We get top-line numbers from each platform's own analytics. We don't scrape comments or build sentiment dashboards.

## Sources

- [Instagram Graph API for Reels](https://developers.facebook.com/docs/instagram-api/guides/content-publishing)
- [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started/)
- [YouTube Data API v3 — videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- [X API v2 media upload](https://developer.twitter.com/en/docs/twitter-api/v1/media/upload-media/api-reference/post-media-upload)
- [Telegram Bot API — sendVideo](https://core.telegram.org/bots/api#sendvideo)
- [Cloudflare R2 zero-egress object storage](https://developers.cloudflare.com/r2/)
- [GoHighLevel social planner](https://www.gohighlevel.com/)
