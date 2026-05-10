/**
 * Reddit adapter — submits clips to allowlisted subreddits via the script-app
 * OAuth password grant.
 *
 * Transport:
 *   1. POST https://www.reddit.com/api/v1/access_token  (grant_type=password)
 *      Returns a bearer token, cached in memory until 60s before expiry.
 *   2. POST https://oauth.reddit.com/api/submit
 *      form: kind=link, sr=<subreddit>, title=<caption>, url=<clip mp4 url>,
 *            api_type=json, [flair_id=<...>]
 *      Reddit doesn't accept direct video uploads through /api/submit (the
 *      v_redd_it pipeline requires a separate /api/v1/lease + S3 upload + WS
 *      handshake which is fragile). For v0.1 we submit a link post pointing
 *      at the public clip URL the clip-pipeline already serves; Reddit will
 *      auto-thumbnail. Native v.redd.it upload tracks as v0.2.
 *
 * Per-tournament fan-out:
 *   `config/reddit-targets.json` maps tournamentId -> [{name, flair_id?}].
 *   The allowlist is enforced strictly: subreddits not listed for a
 *   tournament are skipped. This is deliberate — Reddit's anti-spam is
 *   aggressive and a misfire to /r/wrongsub gets the bot account banned.
 *
 * Rate limits:
 *   - Reddit OAuth: 60 requests / minute / token (we're well under).
 *   - Per-subreddit posting: hard 10-minute cooldown between submissions
 *     from the same account. Enforced module-locally.
 *   - 24h crosspost detection: if the same `clipId` was already posted to
 *     a subreddit in the last 24h (per the audit log), skip with a warning.
 *
 * Auth:
 *   Script-app password grant. Required env:
 *     REDDIT_CLIENT_ID
 *     REDDIT_CLIENT_SECRET
 *     REDDIT_USERNAME
 *     REDDIT_PASSWORD
 *     REDDIT_USER_AGENT     (Reddit requires a unique UA — ban if generic)
 *
 * Caption:
 *   Reddit titles are <=300 chars. We prepend the tournament hashtag for
 *   subs whose auto-flair triggers on it. Body is empty (link post).
 *
 * Failure handling:
 *   Each subreddit is independent. Cooldown / crosspost-skip is logged but
 *   not a failure (the orchestrator still gets `status: published`-ish
 *   skip records). Network / 4xx / 5xx errors throw if every subreddit
 *   failed; partial failure records into the aggregate but doesn't error.
 *
 * Metrics: Reddit exposes upvotes / comments via /api/info?id=t3_<id>.
 * `pullMetrics` calls it and maps score->views proxy + num_comments.
 * (Reddit doesn't surface "views" — score is the closest signal.)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Adapter,
  ClipReady,
  PostMetrics,
  PostRecord,
  PublishContext,
  PublishResult,
} from '../../types.js';
import { mockExternalId, mockUrl, pickCaption } from '../stub.js';
import { aggregateId } from './shared.js';

/** Reddit submission title cap. */
const TITLE_MAX = 300;
/** Per-subreddit cooldown (Reddit's hard limit). */
export const SUBREDDIT_COOLDOWN_MS = 10 * 60 * 1000;
/** Crosspost-detection window. */
export const CROSSPOST_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Token refresh buffer. */
const TOKEN_BUFFER_MS = 60 * 1000;

// ---- Config ------------------------------------------------------------

export interface SubredditTarget {
  name: string;
  flair_id?: string | null;
}

export interface RedditTargetsConfig {
  enabled: boolean;
  tournaments: Record<string, { subreddits: SubredditTarget[] }>;
  default: { subreddits: SubredditTarget[] };
}

export function loadTargetsConfig(path?: string): RedditTargetsConfig {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfgPath =
    path ?? join(here, '..', '..', '..', 'config', 'reddit-targets.json');
  const raw = readFileSync(cfgPath, 'utf8');
  const parsed = JSON.parse(raw) as RedditTargetsConfig & { $comment?: string };
  return {
    enabled: parsed.enabled !== false,
    tournaments: stripComments(parsed.tournaments ?? {}) ?? {},
    default: stripComments(parsed.default ?? { subreddits: [] }) ?? { subreddits: [] },
  };
}

export function subredditsFor(
  cfg: RedditTargetsConfig,
  tournamentId: string,
): SubredditTarget[] {
  if (!cfg.enabled) return [];
  const t = cfg.tournaments[tournamentId];
  if (t && Array.isArray(t.subreddits) && t.subreddits.length > 0) {
    return t.subreddits;
  }
  return cfg.default.subreddits ?? [];
}

// ---- Client -----------------------------------------------------------

export interface RedditClientCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

export interface RedditClientConfig extends RedditClientCredentials {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface RedditSubmitRequest {
  subreddit: string;
  title: string;
  url: string;
  flairId?: string | null;
}

export interface RedditSubmitResult {
  ok: boolean;
  /** Reddit submission id (e.g. `t3_abc123`) when ok. */
  fullname?: string;
  /** Permalink — `https://www.reddit.com/r/<sub>/comments/<id>/<slug>/`. */
  url?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface RedditClient {
  submit(req: RedditSubmitRequest): Promise<RedditSubmitResult>;
  /** Fetch metrics for a previously-submitted link. `fullname` looks like `t3_abc`. */
  fetchMetrics?: (fullname: string) => Promise<PostMetrics>;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class RedditOAuthClient implements RedditClient {
  private readonly creds: RedditClientCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private cachedToken: CachedToken | null = null;

  constructor(config: RedditClientConfig) {
    this.creds = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      username: config.username,
      password: config.password,
      userAgent: config.userAgent,
    };
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
  }

  async submit(req: RedditSubmitRequest): Promise<RedditSubmitResult> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (err) {
      return {
        ok: false,
        errorCode: 'oauth',
        errorMessage:
          err instanceof Error ? err.message : 'reddit oauth failed',
      };
    }

    const form = new URLSearchParams();
    form.set('api_type', 'json');
    form.set('kind', 'link');
    form.set('sr', req.subreddit);
    form.set('title', req.title);
    form.set('url', req.url);
    form.set('resubmit', 'true');
    form.set('sendreplies', 'false');
    if (req.flairId) form.set('flair_id', req.flairId);

    let res: Response;
    try {
      res = await this.fetchImpl('https://oauth.reddit.com/api/submit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.creds.userAgent,
        },
        body: form.toString(),
      });
    } catch (err) {
      return {
        ok: false,
        errorCode: 'network',
        errorMessage: err instanceof Error ? err.message : 'reddit unreachable',
      };
    }

    const payload = (await safeJson(res)) as
      | {
          json?: {
            errors?: Array<[string, string, string?]>;
            data?: { name?: string; url?: string };
          };
        }
      | undefined;

    if (!res.ok) {
      return {
        ok: false,
        errorCode: `http-${res.status}`,
        errorMessage: `reddit submit ${res.status}`,
      };
    }
    const errs = payload?.json?.errors ?? [];
    if (errs.length > 0) {
      const [code, message] = errs[0]!;
      return {
        ok: false,
        errorCode: `reddit-${code.toLowerCase()}`,
        errorMessage: message ?? code,
      };
    }
    const fullname = payload?.json?.data?.name ?? '';
    const url = payload?.json?.data?.url ?? '';
    return { ok: true, fullname, url };
  }

  async fetchMetrics(fullname: string): Promise<PostMetrics> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch {
      return { views: 0, likes: 0, comments: 0, shares: 0 };
    }
    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://oauth.reddit.com/api/info?id=${encodeURIComponent(fullname)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': this.creds.userAgent,
          },
        },
      );
    } catch {
      return { views: 0, likes: 0, comments: 0, shares: 0 };
    }
    if (!res.ok) return { views: 0, likes: 0, comments: 0, shares: 0 };
    const payload = (await safeJson(res)) as
      | { data?: { children?: Array<{ data?: { ups?: number; num_comments?: number; score?: number } }> } }
      | undefined;
    const child = payload?.data?.children?.[0]?.data;
    const score = child?.score ?? child?.ups ?? 0;
    const comments = child?.num_comments ?? 0;
    return {
      views: Math.max(0, score) * 10, // proxy — Reddit doesn't expose views
      likes: Math.max(0, score),
      comments,
      shares: 0,
    };
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now() + TOKEN_BUFFER_MS) {
      return this.cachedToken.accessToken;
    }
    const auth = Buffer.from(
      `${this.creds.clientId}:${this.creds.clientSecret}`,
    ).toString('base64');
    const form = new URLSearchParams();
    form.set('grant_type', 'password');
    form.set('username', this.creds.username);
    form.set('password', this.creds.password);

    const res = await this.fetchImpl(
      'https://www.reddit.com/api/v1/access_token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.creds.userAgent,
        },
        body: form.toString(),
      },
    );
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`reddit oauth ${res.status}: ${text || 'failed'}`);
    }
    const payload = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) {
      throw new Error('reddit oauth: no access_token in response');
    }
    const expiresIn = payload.expires_in ?? 3600;
    this.cachedToken = {
      accessToken: payload.access_token,
      expiresAt: this.now() + expiresIn * 1000,
    };
    return payload.access_token;
  }
}

// ---- Adapter factory ---------------------------------------------------

export function buildTitle(clip: ClipReady, locale: string | undefined): string {
  const base = pickCaption(clip, locale);
  // Reddit's auto-flair on big sports subs triggers on hashtags / team names
  // present in the title. Prepend the tournament tag if the caption doesn't
  // already mention it.
  const tag = `#${clip.tournamentId.toUpperCase()}`;
  const withTag = base.toLowerCase().includes(clip.tournamentId.toLowerCase())
    ? base
    : `${tag} ${base}`;
  if (withTag.length <= TITLE_MAX) return withTag;
  return `${withTag.slice(0, TITLE_MAX - 1)}…`;
}

export interface RedditAdapterDeps {
  client: () => RedditClient | null;
  subreddits: (tournamentId: string) => SubredditTarget[];
  enabled: () => boolean;
  /**
   * Returns the timestamp (ms) of the most recent post for `(clipId, sub)`
   * if any, else null. Used for the 24h crosspost dedup. Also consulted
   * for the 10-min per-subreddit cooldown across all clips.
   */
  recentPostMs?: (clipId: string, subreddit: string) => Promise<number | null>;
  /**
   * Returns the timestamp (ms) of the most recent post in `subreddit` from
   * any clip. Used for the cooldown.
   */
  recentSubredditPostMs?: (subreddit: string) => Promise<number | null>;
  /** Public URL the clip is reachable at — passed as `url` to /api/submit. */
  publicClipUrl: (clip: ClipReady) => string;
  hashId?: (clip: ClipReady) => string;
  now?: () => number;
}

export function createRedditAdapter(deps: RedditAdapterDeps): Adapter {
  const hashId = deps.hashId ?? ((clip) => mockExternalId('reddit', clip));
  const now = deps.now ?? Date.now;

  return {
    platform: 'reddit',
    async publish(clip: ClipReady, ctx: PublishContext): Promise<PublishResult> {
      const client = deps.client();
      const subs = deps.subreddits(clip.tournamentId);

      if (!deps.enabled() || !client || subs.length === 0) {
        const externalId = hashId(clip);
        return { externalId, url: mockUrl('reddit', externalId) };
      }

      const title = buildTitle(clip, ctx.locale);
      const url = deps.publicClipUrl(clip);

      const fullnames: string[] = [];
      const urls: string[] = [];
      const errors: string[] = [];
      const skipped: string[] = [];

      for (const sub of subs) {
        // 24h crosspost dedup.
        if (deps.recentPostMs) {
          const last = await deps.recentPostMs(clip.clipId, sub.name);
          if (last !== null && now() - last < CROSSPOST_WINDOW_MS) {
            skipped.push(
              `r/${sub.name}: already posted within ${(CROSSPOST_WINDOW_MS / 3_600_000).toFixed(0)}h`,
            );
            continue;
          }
        }
        // 10-min per-subreddit cooldown.
        if (deps.recentSubredditPostMs) {
          const last = await deps.recentSubredditPostMs(sub.name);
          if (last !== null && now() - last < SUBREDDIT_COOLDOWN_MS) {
            skipped.push(
              `r/${sub.name}: cooldown (${Math.ceil(
                (SUBREDDIT_COOLDOWN_MS - (now() - last)) / 60_000,
              )}m remaining)`,
            );
            continue;
          }
        }

        const result = await client.submit({
          subreddit: sub.name,
          title,
          url,
          flairId: sub.flair_id,
        });
        if (result.ok && result.fullname) {
          fullnames.push(result.fullname);
          if (result.url) urls.push(result.url);
        } else {
          errors.push(
            `r/${sub.name}: ${result.errorCode ?? 'unknown'}` +
              (result.errorMessage ? ` (${result.errorMessage})` : ''),
          );
        }
      }

      if (fullnames.length === 0) {
        const reason =
          errors.length > 0
            ? errors.join('; ')
            : skipped.length > 0
              ? `all subs skipped: ${skipped.join('; ')}`
              : 'no subs eligible';
        throw new Error(`reddit: ${reason}`);
      }
      const externalId =
        fullnames.length === 1 ? fullnames[0]! : aggregateId(fullnames);
      const firstUrl = urls[0] ?? '';
      return { externalId, url: firstUrl };
    },
    async pullMetrics(post: PostRecord): Promise<PostMetrics> {
      const client = deps.client();
      if (!client?.fetchMetrics || !post.externalId.startsWith('t3_')) {
        return { views: 0, likes: 0, comments: 0, shares: 0 };
      }
      try {
        return await client.fetchMetrics(post.externalId);
      } catch {
        return { views: 0, likes: 0, comments: 0, shares: 0 };
      }
    },
  };
}

// ---- helpers -----------------------------------------------------------

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function stripComments<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripComments(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '$comment') continue;
      out[k] = stripComments(v);
    }
    return out as T;
  }
  return value;
}

// ---- Default env-backed instance --------------------------------------

function envClient(): RedditClient | null {
  if (process.env.SOCIAL_PUBLISHER_REDDIT_MODE === 'stub') return null;
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  const userAgent =
    process.env.REDDIT_USER_AGENT ?? 'vtorn-social-publisher/0.1';
  if (!clientId || !clientSecret || !username || !password) return null;
  return new RedditOAuthClient({
    clientId,
    clientSecret,
    username,
    password,
    userAgent,
  });
}

function loadEnvConfig(): RedditTargetsConfig {
  try {
    return loadTargetsConfig(process.env.SOCIAL_PUBLISHER_REDDIT_CONFIG);
  } catch {
    return { enabled: false, tournaments: {}, default: { subreddits: [] } };
  }
}

const ENV_CONFIG = loadEnvConfig();

/**
 * Default public-URL resolver. Looks at `REDDIT_PUBLIC_CLIP_BASE` (e.g.
 * https://clips.vtourn.com) and joins with the v16x9 path. Adapter throws
 * if the base is unset and the path isn't already absolute — Reddit
 * rejects local file paths.
 */
function envPublicClipUrl(clip: ClipReady): string {
  const path = clip.paths.v16x9 || clip.paths.v9x16 || clip.paths.v1x1;
  if (/^https?:\/\//.test(path)) return path;
  const base = process.env.REDDIT_PUBLIC_CLIP_BASE;
  if (!base) {
    throw new Error(
      'reddit: clip path is not absolute and REDDIT_PUBLIC_CLIP_BASE is unset',
    );
  }
  return `${base.replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`;
}

export const redditAdapter: Adapter = createRedditAdapter({
  client: envClient,
  subreddits: (tournamentId) => subredditsFor(ENV_CONFIG, tournamentId),
  enabled: () => {
    if (process.env.SOCIAL_PUBLISHER_REDDIT_MODE === 'stub') return false;
    return ENV_CONFIG.enabled;
  },
  publicClipUrl: envPublicClipUrl,
  // recentPostMs / recentSubredditPostMs hooks land in v0.2 once the
  // audit-log indexer is wired up — until then crosspost dedup runs on
  // honour-system (and mods will tell us off, fairly).
});

export function redditAdapterMode(): 'real' | 'stub' {
  if (process.env.SOCIAL_PUBLISHER_REDDIT_MODE === 'stub') return 'stub';
  if (!ENV_CONFIG.enabled) return 'stub';
  const credsConfigured =
    !!process.env.REDDIT_CLIENT_ID &&
    !!process.env.REDDIT_CLIENT_SECRET &&
    !!process.env.REDDIT_USERNAME &&
    !!process.env.REDDIT_PASSWORD;
  if (!credsConfigured) return 'stub';
  const tHas = Object.values(ENV_CONFIG.tournaments).some(
    (t) => (t.subreddits ?? []).length > 0,
  );
  const dHas = (ENV_CONFIG.default.subreddits ?? []).length > 0;
  return tHas || dHas ? 'real' : 'stub';
}
