/**
 * Telegram adapter — posts clips into configured Telegram channels.
 *
 * Transport (two modes):
 *
 *   1. Direct Bot API (default).
 *      POST https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVideo
 *      multipart/form-data with `chat_id`, `caption`, `video` (file).
 *      Reference: https://core.telegram.org/bots/api#sendvideo
 *
 *   2. Tournament-bot push proxy (opt-in).
 *      POST {TOURNAMENT_BOT_PUSH_URL}/v1/push
 *      JSON body: { chat_id, caption, video_url, secret }
 *      The tournament-bot project (apps/tournament-bot) doesn't currently
 *      expose this endpoint, but the env var is wired so it can later
 *      without a code change here. If the env var is unset we fall back
 *      to the direct Bot API.
 *
 * Per-tournament fan-out:
 *   `config/telegram-targets.json` maps tournamentId -> { chats: ["@x", -100...] }.
 *
 * Auth:
 *   Direct mode: bot token from `TELEGRAM_BOT_TOKEN`. Never logged.
 *   Proxy mode: shared secret in `TOURNAMENT_BOT_PUSH_SECRET`.
 *
 * Rate limits:
 *   Telegram caps Bot API at 30 messages / sec global and 20 / min to a
 *   single chat. We don't expect to exceed that in v0.1 but the adapter
 *   honours `Retry-After` on a 429 and retries once.
 *
 * Caption: `pickCaption` + hashtags joined; truncated at 1024 chars
 * (Telegram's media-caption hard cap) with U+2026 ellipsis on overflow.
 *
 * Variant: `clip.paths.v16x9` — Telegram inline video plays best at
 * 16:9 in clients (vertical gets letterboxed on desktop).
 *
 * Failure handling:
 *   Each chat is independent. If one chat fails we continue with the rest
 *   and aggregate ids; if every chat fails we throw so the orchestrator
 *   writes a `status: failed` audit row.
 *
 * Metrics:
 *   Telegram doesn't expose channel-message metrics from the Bot API.
 *   Once a future tournament-bot endpoint surfaces view counts we plug it
 *   in here. For now `pullMetrics` returns zeros.
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

/** Telegram media-caption hard cap. */
const CAPTION_MAX = 1024;
/** Number of attempts (1 original + 1 retry on 5xx / 429). */
const MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_MS = 1_000;

export interface TelegramTargetsConfig {
  enabled: boolean;
  tournaments: Record<string, { chats: Array<string | number> }>;
  default: { chats: Array<string | number> };
}

export interface TelegramSendRequest {
  /** `@channel_username` or numeric `-100xxxxxxxxxx`. */
  chatId: string | number;
  /** Caption text already truncated to <= 1024 chars. */
  caption: string;
  /** Local file path the adapter reads. */
  filePath: string;
  /** Filename presented to Telegram. */
  filename: string;
  /** MIME type — `video/mp4` for clips. */
  mimeType: string;
}

export interface TelegramSendResult {
  ok: boolean;
  /** Telegram message_id when ok. */
  messageId?: string;
  /** Telegram t.me URL when the chat is a public channel + we have a username. */
  url?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface TelegramSender {
  send(req: TelegramSendRequest): Promise<TelegramSendResult>;
}

// ---- Direct Bot API client ---------------------------------------------

export interface TelegramBotApiConfig {
  botToken: string;
  fetchImpl?: typeof fetch;
  readFile?: (path: string) => Promise<Uint8Array>;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function defaultReadFile(path: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises');
  return new Uint8Array(await readFile(path));
}

export class TelegramBotApiClient implements TelegramSender {
  private readonly botToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly readFileImpl: (path: string) => Promise<Uint8Array>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: TelegramBotApiConfig) {
    this.botToken = config.botToken;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.readFileImpl = config.readFile ?? defaultReadFile;
    this.sleep = config.sleep ?? defaultSleep;
  }

  async send(req: TelegramSendRequest): Promise<TelegramSendResult> {
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

    const form = buildSendVideoMultipart(
      String(req.chatId),
      req.caption,
      body,
      req.filename,
      req.mimeType,
    );
    const url = `https://api.telegram.org/bot${this.botToken}/sendVideo`;

    let lastErr: TelegramSendResult = {
      ok: false,
      errorCode: 'unknown',
      errorMessage: 'telegram send failed',
    };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'POST',
          headers: form.headers,
          body: form.body as unknown as BodyInit,
        });
      } catch (err) {
        lastErr = {
          ok: false,
          errorCode: 'network',
          errorMessage:
            err instanceof Error ? err.message : 'telegram unreachable',
        };
        if (attempt < MAX_ATTEMPTS) await this.sleep(DEFAULT_BACKOFF_MS);
        continue;
      }

      const payload = (await safeJson(res)) as
        | { ok?: boolean; result?: { message_id?: number; chat?: { username?: string } }; description?: string; parameters?: { retry_after?: number } }
        | undefined;

      if (res.ok && payload?.ok) {
        const messageId = payload.result?.message_id?.toString() ?? '';
        const username = payload.result?.chat?.username;
        const tUrl = username && messageId
          ? `https://t.me/${username}/${messageId}`
          : '';
        return { ok: true, messageId, url: tUrl };
      }

      // 429 (or 5xx): retryable.
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastErr = {
          ok: false,
          errorCode: `http-${res.status}`,
          errorMessage: payload?.description ?? `telegram ${res.status}`,
        };
        const retrySec = payload?.parameters?.retry_after ?? 0;
        if (attempt < MAX_ATTEMPTS) {
          await this.sleep(Math.max(retrySec * 1000, DEFAULT_BACKOFF_MS));
        }
        continue;
      }

      // Other 4xx — not retryable.
      return {
        ok: false,
        errorCode: `http-${res.status}`,
        errorMessage: payload?.description ?? `telegram ${res.status}`,
      };
    }
    return lastErr;
  }
}

// ---- Tournament-bot push-proxy client ----------------------------------

export interface TournamentBotPushConfig {
  baseUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

/**
 * Posts to `${baseUrl}/v1/push`. Used when the tournament-bot grows a
 * server-side push endpoint and we want fan-out to go through its
 * rate-limit / quiet-hours / push-policy layer rather than re-implement
 * here. Until that endpoint exists, leaving the env var unset routes
 * directly through the Bot API.
 */
export class TournamentBotPushClient implements TelegramSender {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: TournamentBotPushConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.secret = config.secret;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async send(req: TelegramSendRequest): Promise<TelegramSendResult> {
    const url = `${this.baseUrl}/v1/push`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Push-Secret': this.secret,
        },
        body: JSON.stringify({
          chat_id: req.chatId,
          caption: req.caption,
          video_path: req.filePath,
          mime_type: req.mimeType,
        }),
      });
    } catch (err) {
      return {
        ok: false,
        errorCode: 'network',
        errorMessage:
          err instanceof Error ? err.message : 'tournament-bot unreachable',
      };
    }
    const payload = (await safeJson(res)) as
      | { ok?: boolean; message_id?: string; url?: string; error?: string }
      | undefined;
    if (!res.ok || payload?.ok === false) {
      return {
        ok: false,
        errorCode: `http-${res.status}`,
        errorMessage: payload?.error ?? `tournament-bot ${res.status}`,
      };
    }
    return {
      ok: true,
      messageId: payload?.message_id ?? '',
      url: payload?.url ?? '',
    };
  }
}

// ---- Caption + config helpers ------------------------------------------

export function truncateCaption(text: string, max = CAPTION_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function buildCaption(clip: ClipReady, locale: string | undefined): string {
  const base = pickCaption(clip, locale);
  const tags = (clip.hashtags ?? []).join(' ').trim();
  const joined = tags ? `${base}\n\n${tags}` : base;
  return truncateCaption(joined);
}

export function loadTargetsConfig(path?: string): TelegramTargetsConfig {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfgPath =
    path ?? join(here, '..', '..', '..', 'config', 'telegram-targets.json');
  const raw = readFileSync(cfgPath, 'utf8');
  const parsed = JSON.parse(raw) as TelegramTargetsConfig & { $comment?: string };
  return {
    enabled: parsed.enabled !== false,
    tournaments: stripComments(parsed.tournaments ?? {}) ?? {},
    default: stripComments(parsed.default ?? { chats: [] }) ?? { chats: [] },
  };
}

export function chatsFor(
  cfg: TelegramTargetsConfig,
  tournamentId: string,
): Array<string | number> {
  if (!cfg.enabled) return [];
  const t = cfg.tournaments[tournamentId];
  if (t && Array.isArray(t.chats) && t.chats.length > 0) return t.chats;
  return cfg.default.chats ?? [];
}

// ---- Adapter factory ---------------------------------------------------

export interface TelegramAdapterDeps {
  client: () => TelegramSender | null;
  chats: (tournamentId: string) => Array<string | number>;
  enabled: () => boolean;
  hashId?: (clip: ClipReady) => string;
}

export function createTelegramAdapter(deps: TelegramAdapterDeps): Adapter {
  const hashId = deps.hashId ?? ((clip) => mockExternalId('telegram', clip));

  return {
    platform: 'telegram',
    async publish(clip: ClipReady, ctx: PublishContext): Promise<PublishResult> {
      const client = deps.client();
      const chats = deps.chats(clip.tournamentId);

      if (!deps.enabled() || !client || chats.length === 0) {
        const externalId = hashId(clip);
        return { externalId, url: mockUrl('telegram', externalId) };
      }

      const caption = buildCaption(clip, ctx.locale);
      const filePath = clip.paths.v16x9 || clip.paths.v9x16 || clip.paths.v1x1;
      const filename = `${clip.clipId}.mp4`;

      const messageIds: string[] = [];
      const messageUrls: string[] = [];
      const errors: string[] = [];

      for (const chatId of chats) {
        const result = await client.send({
          chatId,
          caption,
          filePath,
          filename,
          mimeType: 'video/mp4',
        });
        if (result.ok && result.messageId) {
          messageIds.push(`${chatId}:${result.messageId}`);
          if (result.url) messageUrls.push(result.url);
        } else {
          errors.push(
            `${redactChatId(chatId)}: ${result.errorCode ?? 'unknown'}` +
              (result.errorMessage ? ` (${result.errorMessage})` : ''),
          );
        }
      }

      if (messageIds.length === 0) {
        throw new Error(`telegram: every chat failed: ${errors.join('; ')}`);
      }

      const externalId =
        messageIds.length === 1 ? messageIds[0]! : aggregateId(messageIds);
      const url = messageUrls[0] ?? '';
      return { externalId, url };
    },
    async pullMetrics(_post: PostRecord): Promise<PostMetrics> {
      // Telegram Bot API doesn't expose channel post views to bots.
      // (Channel admins see them in the client; the API doesn't return
      // them on sendVideo.) Once tournament-bot grows a /v1/views helper,
      // wire it in here. Zeros until then.
      return { views: 0, likes: 0, comments: 0, shares: 0 };
    },
  };
}

// ---- helpers -----------------------------------------------------------

export function buildSendVideoMultipart(
  chatId: string,
  caption: string,
  fileBytes: Uint8Array,
  filename: string,
  mimeType: string,
): { body: Uint8Array; headers: Record<string, string> } {
  const boundary = `----vtorn-tg-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  parts.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`,
    ),
  );
  parts.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`,
    ),
  );
  parts.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
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

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function redactChatId(id: string | number): string {
  // Public usernames are non-sensitive; numeric ids are; redact only the
  // numeric path.
  if (typeof id === 'string' && id.startsWith('@')) return id;
  return `chat:redacted`;
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

function envClient(): TelegramSender | null {
  if (process.env.SOCIAL_PUBLISHER_TELEGRAM_MODE === 'stub') return null;
  const proxyUrl = process.env.TOURNAMENT_BOT_PUSH_URL;
  const proxySecret = process.env.TOURNAMENT_BOT_PUSH_SECRET;
  if (proxyUrl && proxySecret) {
    return new TournamentBotPushClient({
      baseUrl: proxyUrl,
      secret: proxySecret,
    });
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return null;
  return new TelegramBotApiClient({ botToken });
}

function loadEnvConfig(): TelegramTargetsConfig {
  try {
    return loadTargetsConfig(process.env.SOCIAL_PUBLISHER_TELEGRAM_CONFIG);
  } catch {
    return { enabled: false, tournaments: {}, default: { chats: [] } };
  }
}

const ENV_CONFIG = loadEnvConfig();

export const telegramAdapter: Adapter = createTelegramAdapter({
  client: envClient,
  chats: (tournamentId) => chatsFor(ENV_CONFIG, tournamentId),
  enabled: () => {
    if (process.env.SOCIAL_PUBLISHER_TELEGRAM_MODE === 'stub') return false;
    return ENV_CONFIG.enabled;
  },
});

export function telegramAdapterMode(): 'real' | 'stub' {
  if (process.env.SOCIAL_PUBLISHER_TELEGRAM_MODE === 'stub') return 'stub';
  if (!ENV_CONFIG.enabled) return 'stub';
  const proxyConfigured =
    !!process.env.TOURNAMENT_BOT_PUSH_URL &&
    !!process.env.TOURNAMENT_BOT_PUSH_SECRET;
  const directConfigured = !!process.env.TELEGRAM_BOT_TOKEN;
  if (!proxyConfigured && !directConfigured) return 'stub';
  const tHas = Object.values(ENV_CONFIG.tournaments).some(
    (t) => (t.chats ?? []).length > 0,
  );
  const dHas = (ENV_CONFIG.default.chats ?? []).length > 0;
  return tHas || dHas ? 'real' : 'stub';
}
