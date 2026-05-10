/**
 * Discord adapter — posts clips into configured Discord channel webhooks.
 *
 * Transport:
 *   POST {webhookUrl}?wait=true
 *   multipart/form-data:
 *       payload_json = '{"content":"<caption>","allowed_mentions":{"parse":[]}}'
 *       files[0]     = <clip.mp4>            (filename + content-type set)
 *
 *   `?wait=true` makes Discord respond with the created message body so we
 *   can return a stable externalId. Reference:
 *   https://discord.com/developers/docs/resources/webhook#execute-webhook
 *
 * Per-tournament fan-out:
 *   `config/discord-webhooks.json` maps tournamentId -> { webhooks: [url, ...] }.
 *   Each tournament can target multiple channels (multi-channel fan-out is
 *   common: #goals + #news + #archive). The adapter posts to each in turn.
 *
 * Auth:
 *   The webhook URL itself is the secret — no OAuth, no bot token. NEVER log
 *   the URL; only the webhook id (the path segment between /webhooks/ and
 *   the next slash) is safe to surface. Use `redactWebhookUrl(url)` for any
 *   diagnostic output.
 *
 * Rate limits:
 *   Discord enforces 5 requests / 2 sec / webhook plus a 30 / 60 sec global.
 *   The adapter respects the `X-RateLimit-Remaining` and
 *   `X-RateLimit-Reset-After` response headers — when remaining hits 0, we
 *   sleep `reset-after` seconds before the next call. On a 429 response we
 *   honour the `retry_after` body field and retry once.
 *
 * Caption:
 *   pickCaption(clip, ctx.locale). Hashtags omitted (Discord ignores them
 *   and they read like spam). Caption is hard-capped at 2000 chars (Discord
 *   message-content limit) with a U+2026 ellipsis on overflow.
 *
 * Variant: `clip.paths.v16x9` — Discord embeds render landscape best.
 *
 * Failure handling:
 *   Each webhook send is independent. If one webhook fails after retries we
 *   log it (without the URL) and continue with the rest. We aggregate the
 *   message ids into a single externalId. If every webhook fails we throw
 *   so the orchestrator writes a `status: failed` audit row.
 *
 * Metrics: Discord webhooks expose no analytics; `pullMetrics` returns
 * zeros so callers don't see misleading numbers.
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
import { aggregateId, redactWebhookUrl } from './shared.js';

/** Discord message-content cap. */
const CAPTION_MAX = 2000;
/** Number of attempts (1 original + 1 retry on 5xx / 429). */
const MAX_ATTEMPTS = 2;
/** Polite default sleep when Discord doesn't tell us how long to wait. */
const DEFAULT_BACKOFF_MS = 1_000;

export interface DiscordWebhookConfig {
  enabled: boolean;
  tournaments: Record<string, { webhooks: string[] }>;
  default: { webhooks: string[] };
}

export interface DiscordSendRequest {
  /** Webhook URL — sensitive, never logged. */
  webhookUrl: string;
  /** Caption text already truncated to <= 2000 chars. */
  caption: string;
  /** Local file path (or URL) the adapter resolves to a Blob/Buffer. */
  filePath: string;
  /** Filename presented to Discord (becomes the attachment name). */
  filename: string;
  /** MIME type — `video/mp4` for clips. */
  mimeType: string;
}

export interface DiscordSendResult {
  ok: boolean;
  /** Discord-issued message id (snowflake) when ok. */
  messageId?: string;
  /** URL of the posted message (channel + message id) when ok. */
  url?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface DiscordWebhookSender {
  send(req: DiscordSendRequest): Promise<DiscordSendResult>;
}

export interface DiscordClientConfig {
  fetchImpl?: typeof fetch;
  /** Reads the clip file off disk (or fetches from a URL). Test override. */
  readFile?: (path: string) => Promise<Uint8Array>;
  /** Sleep helper — overridable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Wall-clock — overridable for tests. */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function defaultReadFile(path: string): Promise<Uint8Array> {
  // Late-import keeps the bundle test-friendly and lets the readFile
  // hook stay overridable without pulling node:fs into the typecheck
  // graph for browser-targeted callers.
  const { readFile } = await import('node:fs/promises');
  return new Uint8Array(await readFile(path));
}

/** Real Discord webhook client. Inject in tests via {fetchImpl, readFile, sleep, now}. */
export class DiscordWebhookClient implements DiscordWebhookSender {
  private readonly fetchImpl: typeof fetch;
  private readonly readFileImpl: (path: string) => Promise<Uint8Array>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Per-webhook-id rate-limit state, learned from response headers. */
  private readonly bucketState = new Map<string, { remaining: number; resetAt: number }>();

  constructor(config: DiscordClientConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.readFileImpl = config.readFile ?? defaultReadFile;
    this.sleep = config.sleep ?? defaultSleep;
    this.now = config.now ?? Date.now;
  }

  async send(req: DiscordSendRequest): Promise<DiscordSendResult> {
    const bucketKey = bucketKeyForUrl(req.webhookUrl);
    await this.waitForBucket(bucketKey);

    let body: Uint8Array;
    try {
      body = await this.readFileImpl(req.filePath);
    } catch (err) {
      return {
        ok: false,
        errorCode: 'file-read',
        errorMessage:
          err instanceof Error ? err.message : 'failed to read clip file',
      };
    }

    const form = buildMultipart(body, req.filename, req.mimeType, req.caption);

    let lastErr: DiscordSendResult = {
      ok: false,
      errorCode: 'unknown',
      errorMessage: 'discord send failed',
    };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${req.webhookUrl}?wait=true`, {
          method: 'POST',
          headers: form.headers,
          // Casting because node:fetch + undici both accept Uint8Array as a
          // BodyInit at runtime; lib.dom's RequestInit only widens to
          // BufferSource in newer TS.
          body: form.body as unknown as BodyInit,
        });
      } catch (err) {
        lastErr = {
          ok: false,
          errorCode: 'network',
          errorMessage: err instanceof Error ? err.message : 'discord unreachable',
        };
        if (attempt < MAX_ATTEMPTS) await this.sleep(DEFAULT_BACKOFF_MS);
        continue;
      }

      this.absorbRateHeaders(bucketKey, res);

      if (res.ok) {
        const payload = (await safeJson(res)) as
          | { id?: string; channel_id?: string }
          | undefined;
        const messageId = payload?.id ?? '';
        const url =
          payload?.id && payload.channel_id
            ? `https://discord.com/channels/@me/${payload.channel_id}/${payload.id}`
            : '';
        return { ok: true, messageId, url };
      }

      // 429: honour retry_after from the body or X-RateLimit-Reset-After.
      if (res.status === 429) {
        const retryMs = await readRetryAfter(res);
        lastErr = { ok: false, errorCode: 'http-429', errorMessage: 'rate limited' };
        if (attempt < MAX_ATTEMPTS) {
          await this.sleep(Math.max(retryMs, DEFAULT_BACKOFF_MS));
        }
        continue;
      }

      // 5xx: retryable.
      if (res.status >= 500 && res.status < 600) {
        lastErr = {
          ok: false,
          errorCode: `http-${res.status}`,
          errorMessage: `discord ${res.status}`,
        };
        if (attempt < MAX_ATTEMPTS) await this.sleep(DEFAULT_BACKOFF_MS);
        continue;
      }

      // 4xx (other than 429): not retryable.
      const text = await safeText(res);
      return {
        ok: false,
        errorCode: `http-${res.status}`,
        errorMessage: text || `discord ${res.status}`,
      };
    }
    return lastErr;
  }

  private absorbRateHeaders(bucketKey: string, res: Response): void {
    const remaining = Number(res.headers.get('X-RateLimit-Remaining') ?? 'NaN');
    const resetAfterSec = Number(res.headers.get('X-RateLimit-Reset-After') ?? 'NaN');
    if (Number.isFinite(remaining) && Number.isFinite(resetAfterSec)) {
      this.bucketState.set(bucketKey, {
        remaining,
        resetAt: this.now() + resetAfterSec * 1000,
      });
    }
  }

  private async waitForBucket(bucketKey: string): Promise<void> {
    const state = this.bucketState.get(bucketKey);
    if (!state) return;
    if (state.remaining > 0) return;
    const waitMs = state.resetAt - this.now();
    if (waitMs > 0) await this.sleep(waitMs);
  }
}

/** Truncate a Discord message-content string to <=2000 chars with a U+2026. */
export function truncateCaption(text: string, max = CAPTION_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Load + validate the per-tournament webhook config from disk. */
export function loadWebhookConfig(path?: string): DiscordWebhookConfig {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfgPath =
    path ?? join(here, '..', '..', '..', 'config', 'discord-webhooks.json');
  const raw = readFileSync(cfgPath, 'utf8');
  const parsed = JSON.parse(raw) as DiscordWebhookConfig & {
    $comment?: string;
  };
  return {
    enabled: parsed.enabled !== false,
    tournaments: stripComments(parsed.tournaments ?? {}) ?? {},
    default: stripComments(parsed.default ?? { webhooks: [] }) ?? { webhooks: [] },
  };
}

/** Pick the webhook URL list for a given tournament. */
export function webhooksFor(
  cfg: DiscordWebhookConfig,
  tournamentId: string,
): string[] {
  if (!cfg.enabled) return [];
  const t = cfg.tournaments[tournamentId];
  if (t && Array.isArray(t.webhooks) && t.webhooks.length > 0) return t.webhooks;
  return cfg.default.webhooks ?? [];
}

export interface DiscordAdapterDeps {
  /** Resolves the Discord client. Return null to fall back to stub mode. */
  client: () => DiscordWebhookSender | null;
  /** Resolves the webhook URL list for a tournament. */
  webhooks: (tournamentId: string) => string[];
  /** Whether real publishing is enabled (config + env both required). */
  enabled: () => boolean;
  /** Deterministic test override for the mock externalId. */
  hashId?: (clip: ClipReady) => string;
}

/** Build a Discord adapter with injected dependencies. */
export function createDiscordAdapter(deps: DiscordAdapterDeps): Adapter {
  const hashId = deps.hashId ?? ((clip) => mockExternalId('discord', clip));

  return {
    platform: 'discord',
    async publish(clip: ClipReady, ctx: PublishContext): Promise<PublishResult> {
      const client = deps.client();
      const webhooks = deps.webhooks(clip.tournamentId);

      if (!deps.enabled() || !client || webhooks.length === 0) {
        // Stub fallback — keeps generic adapters.test.ts deterministic.
        const externalId = hashId(clip);
        return { externalId, url: mockUrl('discord', externalId) };
      }

      const caption = truncateCaption(pickCaption(clip, ctx.locale));
      const filePath = clip.paths.v16x9 || clip.paths.v9x16 || clip.paths.v1x1;
      const filename = `${clip.clipId}.mp4`;

      const messageIds: string[] = [];
      const messageUrls: string[] = [];
      const errors: string[] = [];

      for (const webhookUrl of webhooks) {
        const result = await client.send({
          webhookUrl,
          caption,
          filePath,
          filename,
          mimeType: 'video/mp4',
        });
        if (result.ok && result.messageId) {
          messageIds.push(result.messageId);
          if (result.url) messageUrls.push(result.url);
        } else {
          errors.push(
            `${redactWebhookUrl(webhookUrl)}: ${result.errorCode ?? 'unknown'}` +
              (result.errorMessage ? ` (${result.errorMessage})` : ''),
          );
        }
      }

      if (messageIds.length === 0) {
        throw new Error(`discord: every webhook failed: ${errors.join('; ')}`);
      }

      const externalId =
        messageIds.length === 1 ? messageIds[0]! : aggregateId(messageIds);
      const url = messageUrls[0] ?? '';
      return { externalId, url };
    },
    async pullMetrics(_post: PostRecord): Promise<PostMetrics> {
      // Discord webhooks expose no metrics. Reactions / views require a real
      // bot token + a Gateway connection. Zeros so callers don't see
      // misleading numbers.
      return { views: 0, likes: 0, comments: 0, shares: 0 };
    },
  };
}

// ---- multipart builder --------------------------------------------------

/**
 * Build a multipart/form-data body matching Discord's executeWebhook contract.
 * We hand-roll it (rather than leaning on FormData) so it's deterministic in
 * tests and there's no Blob round-trip cost on a Node 20 server.
 */
export function buildMultipart(
  fileBytes: Uint8Array,
  filename: string,
  mimeType: string,
  caption: string,
): { body: Uint8Array; headers: Record<string, string> } {
  const boundary = `----vtorn-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const enc = new TextEncoder();
  const payloadJson = JSON.stringify({
    content: caption,
    allowed_mentions: { parse: [] },
  });
  const parts: Uint8Array[] = [];
  // payload_json part
  parts.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${payloadJson}\r\n`,
    ),
  );
  // files[0] part
  parts.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
  );
  parts.push(fileBytes);
  parts.push(enc.encode(`\r\n--${boundary}--\r\n`));

  const totalLen = parts.reduce((n, p) => n + p.byteLength, 0);
  const body = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.byteLength;
  }
  return {
    body,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(totalLen),
    },
  };
}

/** Bucket key = the webhook id segment of the URL. */
export function bucketKeyForUrl(url: string): string {
  const m = url.match(/\/webhooks\/(\d+)\//);
  return m?.[1] ?? url;
}

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

async function readRetryAfter(res: Response): Promise<number> {
  const headerSec = Number(res.headers.get('X-RateLimit-Reset-After') ?? 'NaN');
  if (Number.isFinite(headerSec) && headerSec > 0) return headerSec * 1000;
  const body = (await safeJson(res)) as { retry_after?: number } | undefined;
  if (body?.retry_after && Number.isFinite(body.retry_after)) {
    return body.retry_after * 1000;
  }
  return DEFAULT_BACKOFF_MS;
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

// ---- Default env-backed instance (registered in adapters/index.ts) ----

function envClient(): DiscordWebhookSender | null {
  // The webhook URL is stored in the per-tournament config, so the only env
  // gate is whether real-mode is requested. We default to "real if configured"
  // -- that is, real when at least one webhook is populated. The admin can
  // force stub mode by setting `enabled: false` in discord-webhooks.json or
  // by setting SOCIAL_PUBLISHER_DISCORD_MODE=stub.
  if (process.env.SOCIAL_PUBLISHER_DISCORD_MODE === 'stub') return null;
  return new DiscordWebhookClient();
}

function envEnabled(cfg: DiscordWebhookConfig): boolean {
  if (process.env.SOCIAL_PUBLISHER_DISCORD_MODE === 'stub') return false;
  return cfg.enabled;
}

function loadEnvConfig(): DiscordWebhookConfig {
  try {
    return loadWebhookConfig(process.env.SOCIAL_PUBLISHER_DISCORD_CONFIG);
  } catch {
    return { enabled: false, tournaments: {}, default: { webhooks: [] } };
  }
}

const ENV_CONFIG = loadEnvConfig();

export const discordAdapter: Adapter = createDiscordAdapter({
  client: envClient,
  webhooks: (tournamentId) => webhooksFor(ENV_CONFIG, tournamentId),
  enabled: () => envEnabled(ENV_CONFIG),
});

/** Boot-time mode reporter — used by /healthz. */
export function discordAdapterMode(): 'real' | 'stub' {
  if (process.env.SOCIAL_PUBLISHER_DISCORD_MODE === 'stub') return 'stub';
  if (!ENV_CONFIG.enabled) return 'stub';
  // Real if any tournament has at least one webhook.
  const tHas = Object.values(ENV_CONFIG.tournaments).some(
    (t) => (t.webhooks ?? []).length > 0,
  );
  const dHas = (ENV_CONFIG.default.webhooks ?? []).length > 0;
  return tHas || dHas ? 'real' : 'stub';
}
