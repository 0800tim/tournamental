# 61, Social syndication + outbound engagement

> The plan for getting Tournamental content **out** to every social
> platform we publish on, and the plan for going **out** onto those
> platforms and engaging with other people's posts. The first half is
> distribution; the second half is the actual user-acquisition lever.
>
> This doc sits alongside:
>
> - `docs/14, clip generation and social` (the *engine* that produces
>   media artefacts).
> - `docs/27, social distribution strategy` (the brand-channel posting
>   *cadence* during a live tournament).
> - `docs/59, football-audience outreach playbook` (manual,
>   relationship-led creator outreach).
>
> This doc is the *integration* layer: how the engine + cadence + manual
> outreach plug into HighLevel Social Planner, direct platform APIs, and
> the outbound-engagement automation surface.

## What this doc decides

1. **Where each platform integration lives.** HighLevel Social Planner
   owns TikTok, X, Facebook, Instagram, LinkedIn. Everything else
   (Reddit, Telegram, Discord, WhatsApp, YouTube, Threads, Bluesky)
   plugs in directly.
2. **The HighLevel adapter contract.** What our content pipeline POSTs
   to GHL, what GHL POSTs back via webhooks, and how we attribute clicks
   when a GHL-scheduled post fires three hours after we queued it.
3. **The outbound-engagement model.** Commenting on other people's posts
   is the user-acquisition mechanic. This doc specifies the targeting,
   templating, cadence, safety budgets, and per-platform automation path
   (API, browser, or human-in-the-loop), including which platforms we
   refuse to automate.
4. **The sequencing.** What ships in Phase 0, Phase 1, etc., so this
   strategy turns into a backlog the build agents can execute on
   without rediscovering the architecture each sprint.

## 0. The strategic frame

Two motions, both required.

**Motion A, outbound posting.** Publish branded content (clip, share
card, results recap, leaderboard moment) to every surface we operate.
HighLevel handles the fan-out for the big-five social platforms; the
others get direct adapters. Volume target during a live tournament is
~300 posts per week across all surfaces; see `docs/27 §3` for the
per-surface breakdown.

**Motion B, outbound engagement.** Show up in conversations that are
already happening on the platforms about football, predictions,
brackets, World Cup, our competitors. Add value (an insight, a stat,
the live-bracket link when contextually relevant). This is the actual
user-acquisition lever. Most successful prediction-game launches
(Splash Sports, Underdog Fantasy, Sleeper) over-indexed on outbound
engagement in the first 90 days.

Motion A without Motion B is broadcasting into a void. Motion B without
Motion A leaves you with no destination to send the curious to. The two
motions feed each other: outbound engagement points to brand posts;
brand posts make outbound engagement feel less astroturfed because
there's a real account behind it.

## 1. The platform matrix

| Platform | Integration path | API tier | Outbound engagement path | Risk level |
| --- | --- | --- | --- | --- |
| **TikTok** | HighLevel Social Planner | Content Posting API (gated approval) | Manual + Browser (no comment API) | High |
| **Instagram** | HighLevel Social Planner | Graph API (business account) | Graph API for replies on own posts; manual for outbound comments | High |
| **Facebook** | HighLevel Social Planner | Graph API (Page) | Graph API for own-Page reply; **Group posts: manual, see §5b** | Very high for groups |
| **X (Twitter)** | HighLevel Social Planner | X API v2 (paid tier $200/mo) | API v2 (rate-limited) for replies + outbound; **browser-control banned by ToS** | Medium with API, ban-risk without |
| **LinkedIn** | HighLevel Social Planner | Marketing Developer Platform | Manual for outbound comments; API only for own-page activity | Medium |
| **Reddit** | Direct (`tools/reddit-poster`, PRAW) | Official Reddit API | PRAW for replies + outbound; subreddit-rule first | Low if you respect each sub's rules |
| **Telegram** | Direct (our bot, see `docs/13`) | Bot API | Bot API replies to our channel; **no outbound to other channels** | Low |
| **Discord** | Direct (webhooks per server) | Webhook + Bot | Bot replies in invited servers; **never outbound DMs** | Low if invited |
| **WhatsApp** | Direct (auth-sms / Meta Cloud API for templates) | Cloud API (template messages only outbound) | Inbound replies only; **outbound to non-opted-in numbers prohibited** | Very high if violated |
| **YouTube Shorts** | Direct (Data API v3) | OAuth, per-channel | Comment API on own videos; **no outbound on other channels** | Low |
| **Threads** | Manual (no API for posting outbound at v0.1) | n/a | Manual only | n/a |
| **Bluesky** | Direct (AT Protocol) | AT Protocol | API for posts + replies (open) | Low |

**Reading the table.**

- *Integration path* is which app owns submitting content to that
  platform. "HighLevel" means our pipeline POSTs to GHL Social Planner
  and GHL handles the platform-specific publish step.
- *API tier* is what level of access we need on that platform's
  developer programme.
- *Outbound engagement path* is how we comment on *other people's*
  posts. Browser-control entries are flagged for ToS risk; see §5.
- *Risk level* is the realistic ban / rate-limit / legal risk for an
  account doing the volume we'd want.

## 2. HighLevel Social Planner integration

HighLevel (GHL) Social Planner is Tim's chosen control surface for the
five paid social platforms (TikTok, IG, FB, X, LinkedIn). It lets a
non-engineer schedule posts via a calendar UI, manages tokens, retries,
and surfaces a unified inbox.

Our job is to programmatically *submit* content to GHL so the auto-clip
pipeline + share-card library can drive volume without anyone clicking
through a calendar UI. GHL's UI remains the human override surface.

### 2a. What we POST to GHL

GHL's Social Planner exposes a REST endpoint (`POST /social-media-posting/
{locationId}/posts`) that accepts:

```json
{
  "type": "post",
  "accountIds": ["ig_account_id", "fb_account_id"],
  "summary": "Caption + first comment",
  "media": [
    { "url": "https://cdn.tournamental.com/clips/<hash>.mp4", "type": "video" }
  ],
  "scheduleDate": "2026-06-11T20:30:00Z",
  "tags": ["wc2026", "argentina-mexico", "auto-clip"]
}
```

Our pipeline wraps this in a typed adapter (`apps/social-router/src/
adapters/highlevel.ts`, scaffold lives at the top of §6) so the
auto-clip pipeline calls a single `publish({ surfaces, media, caption,
scheduleAt })` regardless of whether the destination is GHL or a direct
platform API.

The adapter handles:

- **Token refresh.** GHL OAuth tokens last ~24 h; the adapter caches
  refresh tokens in our Postgres `social_credentials` table and
  auto-refreshes on 401.
- **Media upload.** GHL accepts URLs (preferred, no upload cost) or
  multipart uploads. We always pass a Cloudflare R2 signed URL with a
  72-hour expiry (long enough for GHL to fetch + retry; short enough
  that an exfiltrated URL doesn't outlive the campaign).
- **Per-platform variants.** A clip post fans out into per-platform
  caption + hashtag variants (X gets a 280-char chop with two hashtags;
  IG gets a 2200-char caption with up to ten hashtags; LinkedIn gets a
  professional voice). The adapter picks the variant by `accountIds`
  and posts each variant in a separate GHL request so each platform's
  captioning is right.
- **Idempotency.** Every queued post carries a `tnm_post_id` UUID; the
  adapter dedupes on retries so a flaky network can't double-post.

### 2b. What GHL POSTs back (webhooks)

GHL fires webhooks at our `apps/social-router` ingress for:

- `post.published` (success), with the platform's native post id
  (Instagram media id, X tweet id, etc.). We store this in
  `social_posts.platform_native_id` so we can later poll for engagement.
- `post.failed`, with the failure reason. Common reasons: token
  expired, media URL 404, platform rate-limit, content policy hit. We
  retry token + URL issues automatically, alert on policy hits.
- `post.engagement_update` (every ~30 min for posts <24h old), with
  likes, comments, shares, link clicks. Drives the `social_engagement`
  rollup the analytics dashboard (`docs/23`) reads.
- `inbox.new_message` for DMs that hit our connected accounts. Routed
  to the human inbox; never auto-replied without human approval at
  v0.1 (see §3c).

### 2c. The connection topology

```
┌──────────────────────────────┐
│  Auto-clip pipeline (doc 14) │
│  Share-card library          │
│  Hand-typed campaigns (Tim)  │
└──────────────┬───────────────┘
               │ publish({surfaces, media, caption, scheduleAt})
               ▼
   ┌────────────────────────┐
   │  apps/social-router    │  ← TS service, lives next to apps/web
   │  Typed adapter layer   │
   └──┬──────┬──────┬───────┘
      │      │      │
      ▼      ▼      ▼
   ┌────┐ ┌────┐ ┌─────────────────────────┐
   │GHL │ │PRAW│ │ Telegram / Discord /    │
   │API │ │    │ │ Bluesky / YouTube /     │
   └─┬──┘ └─┬──┘ │ AT Protocol / Meta WACA │
     │      │    └────────────┬────────────┘
     ▼      ▼                 ▼
  TikTok/IG/FB/X/LinkedIn    Reddit subs, channels, servers
```

### 2d. Where GHL is *not* enough

- **Comment automation on our own posts** can be done via GHL inbox,
  but the AI-reply policy lives in our service, not GHL's templates.
- **Outbound engagement on other people's posts** is out of GHL scope
  entirely. Every platform that supports it requires a direct
  integration (or browser, see §5).
- **Per-locale variants.** GHL's calendar is single-locale per
  scheduled post; we generate the 22 locale variants ourselves and
  push them as separate scheduled posts to per-locale GHL accounts (one
  per language) so each locale's audience sees native copy.

## 3. Inbound replies (our own posts)

When someone comments on a post we made, the response loop is:

1. GHL or platform webhook fires (`comment.created`).
2. `apps/social-router` classifies the comment via a small Claude call:
   `category ∈ {question, complaint, spam, supportive, neutral,
   competitor-bait, off-topic}`.
3. Routing:
   - `supportive`, `neutral`: auto-react (heart / upvote) if the platform
     supports it; no text reply unless the conversation is short and
     bounded.
   - `question`: draft a reply via the AI, queue for human approval in
     the GHL inbox. Tim or a community manager taps approve.
   - `complaint`, `competitor-bait`: queue with high-priority flag, AI
     drafts but **never** auto-sends.
   - `spam`: drop, no reply.
4. After 24h with no human review, supportive auto-reactions stand and
   the queued drafts decay (no late reply is better than a stale one).

### 3a. Auto-reply policy

Auto-reply *without* human approval is restricted to:

- A 👍 / heart / equivalent reaction on supportive comments under 80
  characters, on platforms where reactions are visible.
- A single canned thank-you reply on first-time commenters on Tim's
  own posts, gated by an explicit list of "always safe" phrasings.

Everything else routes through human approval. This is a v0.1 policy
that we revisit when we have enough labelled examples to trust an LLM
classifier under 0.1% false-positive on policy-violating replies.

### 3b. Per-platform reply mechanics

- **X**: API v2 `POST /2/tweets` with `reply.in_reply_to_tweet_id`.
- **Instagram**: Graph API `POST {ig-media-id}/comments`.
- **Facebook**: Graph API `POST {post-id}/comments`.
- **TikTok**: no public comment API; replies surface in the GHL inbox
  and must be sent from the TikTok app or browser. We render them as
  a TODO list for the human operator.
- **LinkedIn**: UGC API for the company page; v1 of marketing dev
  platform doesn't expose comment-on-comment, so threaded replies
  must be sent manually.
- **Reddit**: PRAW `comment.reply(...)`, trivial.
- **YouTube**: Data API v3 `commentThreads.insert`.

### 3c. Refusing to auto-DM

We do not auto-reply to *direct messages* on any platform. DMs are
1:1 conversations and an AI cold-reply is recognisably weird. The GHL
inbox surfaces every DM to Tim or the duty community manager; the AI
drafts a suggested reply but never sends.

## 4. Reddit (the highest-leverage non-HighLevel platform)

Reddit is the single biggest outbound-engagement opportunity for a
prediction product. r/soccer, r/football, r/worldcup, r/fantasysports,
r/sportsbook (and the per-country subs: r/argentina, r/Brasil,
r/MLS, etc.) collectively serve millions of monthly active users
who *are already discussing predictions*. They are also the platform
with the lowest tolerance for off-tone marketing; bad outreach gets
your account shadow-banned the same day.

### 4a. tools/reddit-poster (scaffolded, partial)

The Python scaffold at `tools/reddit-poster/` (started earlier, awaits
completion) uses **PRAW**, the official Python wrapper for the Reddit
API. Authentication is OAuth via a registered "script" app on Tim's
Reddit account. Every action is rate-limited by Reddit (~60 req/min);
PRAW handles the rate-limit headers automatically.

The scaffold needs (the issue tracker / `IDEAS.md` should mirror this):

- `requirements.txt`: praw, pyyaml, python-dotenv, anthropic (for
  per-comment-draft via Claude CLI, same pattern as the YouTube tool).
- `.env.example`: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
  REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_USER_AGENT.
- `subreddits.yaml`: a curated list of subreddits with per-sub
  posting rules (allow-self-promo: bool, posting-day-window, required
  flair, manual-mod-approval-required, etc.).
- `post.py`: submit a single thread to a single sub with --dry-run,
  --schedule, --flair, --crosspost-from flags.
- `comment.py`: post a comment in a thread, with --thread-url and
  --draft-body or --auto-draft-context flags. Auto-draft uses the
  Claude CLI subprocess pattern from the YouTube tool (Max-plan auth,
  ANTHROPIC_API_KEY stripped from subprocess env).
- `posted_log.json`: audit log of every post + comment, indexed by
  subreddit, with cadence enforcement (no more than one post per sub
  per 14 days; no more than one comment per thread per account).
- `cadence_guard.py`: refuses to send a post if the cadence rule
  would be violated, and refuses to send a comment if the same
  account already commented in the same thread or made more than 6
  comments in any 24-hour window across the whole platform (the
  "shadow-ban tripwire").

### 4b. Subreddit strategy

Three buckets:

1. **Direct-fit subs we post in** (r/soccer, r/football, r/worldcup,
   r/MLS, per-country subs). Posts only when we have a substantive
   contribution: a stats deep-dive on tomorrow's match, a free-to-join
   "redditor bracket" with no ads, a transparency post on our
   open-source code. Cadence: at most one post per sub per 14 days,
   with at least 7 days between posts overall.

2. **Adjacent subs where we comment** (r/sportsbook, r/dfsports,
   r/fantasysports, r/sportsanalytics, r/datascience, r/programming
   for the open-source angle). Posts are off-policy here; we *only*
   comment when relevant.

3. **Tournament-window-only subs** (r/argentina, r/Brasil,
   r/itali, r/Espana, etc. for World Cup matches involving that
   country, r/Toronto for Canadian host-city threads). Cadence is
   bursty per match: one well-timed comment on a match-thread, with
   a one-line link to a country-themed leaderboard slug.

Per-sub rules live in `subreddits.yaml` and the cadence guard refuses
any action that would violate them.

### 4c. The Reddit comment-out playbook

Outbound commenting on Reddit is where Tournamental users actually
come from. The shape of a good comment:

- Add a stat the OP / commenter didn't have. Tournamental's bracket
  cascade + Polymarket-derived odds (see `docs/29`) are a near-infinite
  source of relevant stats.
- Mention the product *once*, not at all, or *only when contextually
  invited*. "I built a free bracket if you want to lock in your call,
  link in my bio" is the absolute most direct it gets, and only in
  threads explicitly asking "where can I make a bracket?"
- Never as the first comment on a thread; never on a thread <30 min
  old (looks like brigading); never on a thread >7 days old (necro
  signals).
- Per-account rate-limit: 6 outbound comments per 24 h, 30 per
  rolling 7 days, max 3 in any single subreddit per 7 days.

The cadence guard enforces these as hard limits. If Tim wants to push
harder, he overrides per-call with `--force-cadence-override` which
logs the override to the audit file. **No autopilot mode**: every
outbound comment requires a human approval step before send in v0.1.
After we have 200 reviewed comments and the AI's draft acceptance rate
is above 80%, we revisit autopilot.

### 4d. Why Reddit first

- Official API with generous free tier.
- ToS explicitly permit script accounts as long as they identify
  themselves in user-agent and respect rate limits.
- Highest concentration of intent-matched users for prediction games.
- Lowest moderation surface area (1 voluntary mod per sub; you can
  often *ask* the mod for permission to share, vs FB where you can't
  reach the mod).
- Per-thread analytics are public (upvotes, ratio, comment count, sub
  size) so we can measure outbound-engagement ROI cleanly.

## 5. The honest section on browser-control automation

Tim's brief asks for "browser control or bot to ideally post... and we
need to be going out and commenting on other people's posts." Some of
this is fine. Some of it is account-suicide. This section says which
is which, and why.

### 5a. Where browser control is genuinely OK

- **Reddit**: PRAW handles every API surface we'd need. Browser-control
  is unnecessary and strictly worse than API.
- **Telegram**: bot API covers posting + replies + channel admin.
  Browser irrelevant.
- **Discord**: bot API + webhooks cover posting; outbound is
  policy-banned (DMs to non-friends) regardless of mechanism.
- **Bluesky**: AT Protocol is the API, browser unneeded.
- **YouTube**: Data API v3 covers comments on our own videos. Browser
  irrelevant.
- **LinkedIn (read-only browsing)**: scraping public-profile data for
  outreach research is acceptable if respectful of robots.txt and
  rate-limited; that's not posting, it's reading. We already do this
  pattern in `tools/youtube-discovery`.

### 5b. Where browser control gets accounts banned in days

- **Facebook**: their detection layer is mature. Group-post browser
  automation gets accounts flagged within 50-200 actions, full bans
  follow. Page-post automation is covered by the Graph API which is
  the right path. **Outbound commenting in other groups via browser
  is a hard no.**
- **Instagram**: same as FB (same company, same detection stack).
  Even slow human-cadenced browser scripts on residential proxies get
  the "we restricted your account" notice within a couple of weeks.
- **TikTok**: aggressively anti-automation. Browser-control gets
  shadow-banned (your posts get 0 reach silently). Their detection
  uses device fingerprinting + behavioural ML that has no public
  workaround. The Content Posting API is the only sustainable path,
  and it requires their approval.
- **X (Twitter)**: ToS explicitly prohibits browser automation; v2 API
  is the only sanctioned path. With the $200/mo Basic tier we have
  enough rate for our outbound volume. Without API, every
  scraping/browser path gets the account suspended within weeks.

### 5c. Where browser control is permissible *only* with human-loop

- **LinkedIn (posting + commenting)**: the API for individual-user
  posting is restricted. Browser automation works, but LinkedIn's
  detection is moderate and a bot-flagged account loses the ability
  to send connection requests. Acceptable approach: **drafter, not
  sender**. Code drafts content and surfaces it in a queue; a human
  pastes it into LinkedIn from their own browser.
- **Threads**: no posting API at v0.1. Same drafter-not-sender model.

### 5d. The Tournamental policy

Browser-control automation **only on platforms where the platform's
ToS permits it**. For the four platforms in §5b, the answer is "use
the API path or don't do it." For the two platforms in §5c, the answer
is "code drafts, human sends."

This is a strategic decision, not just a compliance one. A Tournamental
account that gets banned from FB during the World Cup loses a
five-month build-up of audience and there is no recovery path. The
asymmetry favours patience.

### 5e. The "looks legit" requirement

Whatever the mechanism, every account we operate has to look like a
real person or a real brand account, not a sock-puppet farm. Concretely:

- **Real profile photo, real bio, real linked-back website** on every
  account.
- **Consistent posting history** preceding any outbound engagement.
  An account with three posts in its history and 30 outbound comments
  is the textbook spam pattern.
- **Same identity across platforms** where it makes sense
  (`@tournamental` on X / IG / Threads / Bluesky; `Tournamental` on
  LinkedIn / FB / YouTube; `u/tournamental` on Reddit if available).
- **Diverse content mix**: 50% original content, 25% reposting /
  reacting to others' content, 25% commentary / replies.
- **A real human in the loop** for outbound engagement at v0.1, even
  when the API permits autopilot. The cost (Tim's 30 min/day) is
  trivial relative to the upside of *not* getting banned mid-tournament.

## 6. Architecture

### 6a. The `apps/social-router` service

A new TypeScript service that owns:

- The unified `publish(...)` entrypoint consumed by the auto-clip
  pipeline, the share-card library, and any campaign tooling Tim
  drives by hand.
- The typed adapter layer (one adapter per integration path:
  HighLevel, Reddit, Telegram, Discord, Bluesky, YouTube, Meta WACA).
- The outbound-engagement queue: a Postgres-backed work queue of
  (platform, action, target-url, draft-body, status) rows. Workers
  pop pending rows and execute via the appropriate adapter.
- Webhook ingress for GHL + platform-native callbacks.
- The cadence guard, shared across all platforms.

Stack: Fastify (same as `apps/game`), TypeScript, Postgres for
persistence, Redis for the queue + cadence counters, Pino for logs.

### 6b. Data model

```sql
-- One row per scheduled / fired publish action.
CREATE TABLE social_posts (
  id              UUID PRIMARY KEY,
  tnm_post_id     UUID UNIQUE,                   -- idempotency key
  surface         TEXT NOT NULL,                 -- 'tiktok' | 'ig' | ...
  account_id      TEXT NOT NULL,                 -- the connected account
  caption         TEXT NOT NULL,
  media_url       TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  published_at    TIMESTAMPTZ,
  platform_native_id TEXT,                       -- e.g. X tweet id
  status          TEXT NOT NULL,                 -- queued|published|failed
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per outbound comment / engagement action.
CREATE TABLE social_engagements (
  id              UUID PRIMARY KEY,
  surface         TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  target_url      TEXT NOT NULL,                 -- the post we're replying to
  parent_native_id TEXT NOT NULL,                -- the platform's id for the parent
  draft_body      TEXT NOT NULL,
  human_approved_by TEXT,                        -- who approved (null = pending)
  human_approved_at TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  platform_native_id TEXT,                       -- the comment id once sent
  status          TEXT NOT NULL,                 -- drafted|approved|sent|rejected
  context_json    JSONB,                         -- the thread / post we're replying in
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rolling cadence counters per (surface, account_id, window).
CREATE TABLE social_cadence (
  surface         TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  window_start    TIMESTAMPTZ NOT NULL,
  window_kind     TEXT NOT NULL,                 -- 'hour'|'day'|'week'
  posts_count     INT NOT NULL DEFAULT 0,
  engagements_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (surface, account_id, window_kind, window_start)
);

-- Webhook receipts (idempotency for inbound).
CREATE TABLE social_webhook_receipts (
  id              UUID PRIMARY KEY,
  source          TEXT NOT NULL,                 -- 'ghl'|'meta'|'twitter'|...
  external_id     TEXT NOT NULL UNIQUE,
  raw_body        JSONB NOT NULL,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Migrations live at `apps/social-router/migrations/` per the
repo-wide convention (see `CLAUDE.md, Database and cache stack`).

### 6c. The adapter contract

```ts
// apps/social-router/src/adapters/base.ts
export interface SocialAdapter {
  /** The platform name, e.g. 'tiktok'. */
  readonly surface: Surface;

  /** Submit a new post for publication. Idempotent on tnm_post_id. */
  publish(input: PublishInput): Promise<PublishResult>;

  /** Reply to a comment on one of our own posts. */
  reply?(input: ReplyInput): Promise<ReplyResult>;

  /** Post an outbound comment on someone else's post. */
  engage?(input: EngagementInput): Promise<EngagementResult>;

  /** Refresh credentials if the adapter holds OAuth tokens. */
  refreshCredentials?(): Promise<void>;
}

export type Surface =
  | 'tiktok' | 'ig' | 'fb' | 'x' | 'linkedin'   // via HighLevel
  | 'reddit' | 'telegram' | 'discord'
  | 'bluesky' | 'youtube' | 'whatsapp';
```

Adapters that don't support an operation (e.g. Telegram has no
"engage" because we don't outbound to other channels) simply omit the
method; the router refuses to enqueue an unsupported action.

### 6d. Auth + credentials

All credentials live in `social_credentials` (Postgres, encrypted at
rest with pgcrypto, key from `SOCIAL_CREDENTIALS_KEY` env). The
adapter layer reads tokens via a single `getCredentials(surface,
account_id)` helper that handles decryption + auto-refresh on the
401 path.

GHL OAuth flow: redirect Tim through the GHL OAuth screen, capture
the auth code at our `/oauth/highlevel/callback`, exchange for the
refresh token, store. Refresh tokens last as long as the install is
not revoked.

Reddit OAuth: script-app pattern, username + password + client
credentials, no redirect dance needed (script apps are first-party
to the account).

Per-platform native APIs (Bluesky, YouTube, Meta WACA, Telegram,
Discord) each have their own pattern documented in
`apps/social-router/docs/credentials.md` once the service exists.

### 6e. Observability

- Pino structured logs, one line per adapter call.
- Counters in Postgres: posts published per surface per day, comments
  drafted vs sent, cadence-guard rejections, failure rates by reason.
- A dashboard route at `/dashboard/social` for Tim, showing the queue
  depth, today's scheduled posts, pending engagements awaiting
  approval, recent failures.
- Hard alert if any platform credential goes invalid (Slack ping via
  the existing `clawdia` gateway, see `docs/22, deployment`).

## 7. Outbound engagement, the deep dive

Outbound engagement is high-leverage and high-risk. This section is
the explicit playbook.

### 7a. Target sourcing (where the posts come from)

We pull candidate posts from each platform via:

- **Reddit**: PRAW's `subreddit.new(limit=...)` + `search(query=...)`
  scoped to our curated subreddit list and our keyword set
  ("bracket", "world cup pool", "predictions", "who do you think will
  win", "where can I make a bracket", per-country team names during
  the tournament).
- **X**: API v2 filtered stream with our keyword set + per-country
  team handles; we tap in for 30-min windows during peak hours.
- **Instagram**: hashtag search via Graph API on a curated tag list
  (#worldcup2026, #fifa, per-team hashtags), polling every 30 min.
- **Facebook (groups)**: **manual only.** No API for non-page-owned
  group post discovery. Tim or a contractor scans the curated group
  list and drops candidate URLs into the queue.
- **TikTok, LinkedIn**: manual scanning, drop URLs into the queue.

Every candidate target lands in `social_engagement_targets` with
metadata: discovered_at, source, surface, target_url, sample_text,
predicted_relevance_score (a small LLM classifier 0-1), suggested
draft (LLM-generated).

### 7b. The draft + approve flow

1. Worker picks up a target from `social_engagement_targets`.
2. LLM generates a draft using the persona prompt and the thread
   context (parent post + recent comments).
3. Draft + target URL + persona land in the Tim-facing approval
   queue at `/dashboard/social/queue`.
4. Tim reviews. Three buttons: **Send**, **Edit & send**, **Reject
   with reason**.
5. On Send, the adapter posts via the appropriate platform API and
   records the platform-native comment id back into
   `social_engagements`.
6. The cadence guard increments the relevant counters; if a counter
   hits a hard limit, subsequent drafts for that (surface,
   account_id) are queued but not sendable until the window rolls.

### 7c. Per-platform safety budgets

Conservative defaults, tunable per account once we have data:

| Platform | Engagements / 24h | / 7d | Min gap between actions |
| --- | --- | --- | --- |
| Reddit | 6 | 30 | 15 min |
| X | 20 | 80 | 5 min |
| Instagram | 8 | 40 | 20 min |
| Facebook (Page comments only) | 6 | 30 | 30 min |
| LinkedIn (drafter only) | 5 | 20 | n/a (human paces) |
| TikTok (drafter only) | 4 | 15 | n/a |
| YouTube (own-video replies only) | unlimited (own content) | n/a | n/a |
| Bluesky | 20 | 100 | 2 min |

Cadence guard enforces. Tim can override on a per-call basis with
`--force` (logged to audit).

### 7d. Persona prompts

Each surface has a persona prompt under `apps/social-router/prompts/`:

- `persona-reddit-stats.md`: stat-led, factual, includes a number
  the OP didn't have. Long-form acceptable. No emoji. Signs off with
  the link only when contextually invited.
- `persona-x-quick.md`: 200-260 chars, one-line counter-take or
  stat, one emoji max. Tournamental link only as a card unfurl, not
  inline text.
- `persona-ig-supportive.md`: short, warm, emoji OK, no link
  (Instagram doesn't allow clickable links in comments).
- `persona-linkedin-credentialled.md`: opens with a context line
  ("I work on a free open-source bracket project..."), then the
  substantive comment, no hashtags.
- `persona-bluesky-builder.md`: builder voice, OK to mention
  open-source, link included.

Persona prompts are versioned in git; every draft logs which version
generated it so we can A/B test prompt iterations.

### 7e. Refusal cases

The drafter refuses to generate when:

- The thread is on a sensitive topic (injuries, deaths, geopolitics)
  the LLM classifier flags as "do not engage".
- The OP is under a reasonable estimate of 16 years old (we infer
  from profile signals where available; conservative refusal when
  uncertain).
- The thread is in a country/locale where we have no localised landing
  page (don't dump English-speaking visitors onto an English-only
  page if their context is Brazilian Portuguese).
- The target account is verified-public-figure (athletes, journalists,
  brands). Top-of-funnel engagement should come from peers, not from
  Tournamental reaching out to verified accounts. Tim can override
  for specific known relationships.

## 8. Metrics that matter

Per surface, weekly:

- **Outbound published** (count).
- **Outbound engagement actions** (count) and **acceptance rate** (% of
  drafts approved by Tim and sent).
- **Reach per outbound action** (clicks back to the syndicate-landing /
  bracket page, attributed via UTM-tagged short links).
- **Cost per registered user, attributed to that surface** (calculated
  by sub-team monthly).
- **Account-health signals**: per-surface follow/follower deltas,
  unusual rate-limit responses, any platform notice on the account.

The analytics dashboard (`docs/23`) gets a new "Social syndication"
tab that surfaces these. The funnel attribution model in
`docs/30, gamification and affiliate spine` handles the surface →
registered-user wiring.

## 9. Compliance, ethics, legal

### 9a. Per-platform ToS specifics, headline items only

- **X**: API tier required, $200/mo Basic, no browser scraping.
- **Meta** (FB + IG): Graph API access via approved Meta app; Page
  + business-IG required; no group-post automation.
- **TikTok**: Content Posting API approval required; **no browser
  automation** (their detection layer is significantly more advanced
  than Meta's).
- **LinkedIn**: Marketing Developer Platform for own-Page; no API for
  personal-profile posting at v0.1.
- **Reddit**: API permitted, must identify in User-Agent, must respect
  per-sub rules, no shadow-account farms.
- **YouTube**: Data API v3, OAuth per channel, no scraping.

### 9b. Inauthentic-behaviour red lines

We do not:

- Operate more than one account per platform per natural person.
- Coordinate posting across multiple accounts to amplify a single
  message ("brigading").
- Use VPNs or residential proxies to evade rate limits or geo-gates.
- Misrepresent the brand as a third party (no sock-puppet "I tried
  Tournamental and it changed my life" accounts).
- Auto-DM users who haven't opted in.

This is a hard policy; if a future contributor proposes any of the
above, the reviewer agent rejects the PR on doc-61 grounds.

### 9c. Data subject considerations

Outbound engagement involves natural persons whose content we are
processing (the post we're replying to, the commenters in the thread).
We do not retain their content beyond the engagement context (target
URL + a sample to drive the draft). The drafter prompt is provided
the thread text at draft time and not stored alongside the draft once
sent (the `context_json` column is truncated to a hash + first 500
characters for audit).

For GDPR / EU users: we are the data controller for the engagements
table; the parent post and commenter handles are public content of
the platform, but if a person requests deletion via our existing data
deletion route (`docs/32, auth and privacy`), we honour it by
hard-deleting any matching engagement rows.

## 10. Sequencing and roadmap

Phases as separate PRs / sprints. Each phase delivers a usable
increment; we don't wait for the full architecture before shipping
Phase 0.

### Phase 0, Reddit poster MVP (already started)

Finish `tools/reddit-poster/` as a standalone script. PRAW-based.
Post and comment with --dry-run + --force-cadence-override. JSON audit
log. No GHL, no Postgres, no service. Just enough for Tim to start
posting and commenting on Reddit from the CLI today.

**Deliverable**: `python tools/reddit-poster/post.py --sub=soccer
--title="..." --body="..."` works end-to-end.

### Phase 1, HighLevel adapter (single-platform first)

Spin up `apps/social-router` skeleton. Implement the GHL adapter for
**X only** as the first surface (smallest schema, easiest to verify).
Migrate the existing share-card pipeline to publish through the
adapter for X.

**Deliverable**: a share card posted to X via the auto-clip pipeline
shows up in the GHL calendar and goes out at the scheduled time.

### Phase 2, HighLevel adapter (remaining four platforms)

Add IG, FB, TikTok, LinkedIn adapter rows under the GHL surface.
Per-platform caption variants. Webhook ingress for
`post.published` + `post.failed`.

**Deliverable**: a single `publish({ surfaces: ['ig', 'fb'], ... })`
call places posts on both via GHL.

### Phase 3, Inbound reply automation (own posts)

GHL inbox webhook → classifier → human-approval queue in the new
`/dashboard/social/inbox` route. Auto-react for supportive comments
on platforms that support reactions.

**Deliverable**: comments on our X posts surface as drafts in Tim's
dashboard; he approves and the reply ships.

### Phase 4, Reddit production integration

Promote `tools/reddit-poster/` into a proper adapter under
`apps/social-router/src/adapters/reddit.ts`. Same code, just lifted
into the service. Cadence guard enforced via the shared service-level
guard, not a per-script JSON file.

**Deliverable**: Reddit posting + commenting goes through the same
publish + engage queue as the other platforms.

### Phase 5, Outbound engagement, X + Reddit

Target sourcing workers (filtered stream for X, sub-scan for Reddit).
Draft generation. Approval queue. Send via adapter.

**Deliverable**: Tim sees 10-20 outbound comment drafts in his
queue each morning, approves the good ones, and sends them with one
tap.

### Phase 6, Outbound engagement, IG + FB-Page

IG hashtag-based discovery via Graph API. FB-Page comments only (not
groups). Same approval flow.

**Deliverable**: Same as Phase 5 but for IG + FB-Page.

### Phase 7, LinkedIn + TikTok drafter

Drafter-only mode: discover candidate posts via manual URL drops,
generate the draft, show the draft + the platform URL in the queue,
Tim opens the platform, pastes, sends. No automation against the
platform itself.

**Deliverable**: Tim has 5-10 LinkedIn draft suggestions per day,
each with the platform URL + the draft body, copy + paste.

### Phase 8, Bluesky, YouTube (own-video), Threads

Round out the surface coverage. Bluesky has the simplest API; YouTube
limited to own-video replies; Threads remains drafter-only until
Meta ships a posting API.

### Phase 9, Analytics + attribution rollup

Wire the `social_engagements` data into the analytics dashboard.
Cost-per-registered-user by surface. Cohort retention by entry-source.
This is what tells Tim which of the eight surfaces are worth keeping
investment in for the 2027 season.

## 11. Open questions to resolve before Phase 1

- **GHL location id and API key**: Tim provisions when he sets up the
  Tournamental sub-account. Captured in `apps/social-router/.env`
  per `docs/56, env stubs index`.
- **Per-platform connected-account topology**: do we run one
  Tournamental brand account per platform, or one-per-locale? §2d
  assumes per-locale; if Tim prefers one brand account that posts
  multilingual captions in a single thread, the adapter still works
  but the GHL calendar collapses.
- **Approval-queue surface**: does Tim approve from the GHL inbox UI
  (we feed it via a draft channel) or from our own
  `/dashboard/social/queue`? §3 assumes our own surface; GHL's inbox
  is the fallback for non-engineer operators.
- **Browser-control allowed list**: this doc puts every browser-control
  path behind a "drafter, not sender" wall. If Tim wants to override
  for a specific platform after risk-weighing, document the override
  here and in `docs/33, security hardening checklist`.

## 12. Cross-references

- `docs/14, clip generation and social`: the *engine* feeding this
  layer.
- `docs/27, social distribution strategy`: the *cadence* this layer
  enforces.
- `docs/13, telegram bot`: a special-case adapter for our owned
  channel.
- `docs/23, analytics and marketing insights`: the destination for the
  metrics in §8.
- `docs/30, gamification and affiliate spine`: the funnel attribution
  model.
- `docs/32, auth and privacy`: data subject deletion mechanics
  referenced in §9c.
- `docs/33, security hardening checklist`: where browser-control
  override exceptions get logged.
- `docs/56, env stubs index`: where the platform credentials live.
- `docs/59, football-audience outreach playbook`: the
  relationship-led complement to this automation-led doc.
- `tools/reddit-poster/`: the Phase 0 starter, already scaffolded.

---

Last updated 2026-05-24. Owner: Tim. Reviewer: orchestrator agent.
Next review trigger: when Phase 1 ships.
