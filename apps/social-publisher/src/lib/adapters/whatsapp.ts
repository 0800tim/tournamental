/**
 * WhatsApp adapter — posts clips into configured WhatsApp groups via the
 * Aiva SMS / WhatsApp gateway.
 *
 * Transport:
 *   The Aiva gateway runs a Baileys session under the hood; pairing happens
 *   once on the gateway dashboard and the session persists. Sending media
 *   is a single HTTP call to:
 *       POST {AIVA_SMS_API_URL}/api/v1/whatsapp/sessions/{sessionId}/send-media
 *       Authorization: Bearer {AIVA_SMS_API_KEY}
 *       Content-Type: application/json
 *       body: { to, mediaUrl, mimeType, caption }
 *
 *   The text-only `send` endpoint shape is documented in
 *   `apps/auth-sms/src/whatsapp-baileys.ts` (`AivaWhatsAppClient`). We
 *   extend it here with a `send-media` shape because the OTP flow only
 *   needs text bodies. Once `packages/aiva-client` lands as a shared
 *   workspace package, migrate this client to it.
 *
 * Required env vars:
 *   AIVA_SMS_API_URL       Gateway base URL (default http://localhost:9252)
 *   AIVA_SMS_API_KEY       Bearer token for the gateway.
 *   AIVA_WA_SESSION_ID     Pre-paired Baileys session id on the gateway.
 *   WHATSAPP_GROUP_IDS     CSV of group jids to fan out to. The jid format
 *                          is `<digits>@g.us` — discover by sending any
 *                          message to the group from a paired phone and
 *                          inspecting the gateway's recent-chats endpoint
 *                          (`GET /api/v1/whatsapp/sessions/{id}/chats`),
 *                          or by reading the audit log on the gateway
 *                          dashboard. See docs/27 for ops detail.
 *
 * Variant: `clip.paths.v9x16` is preferred because most WhatsApp clients
 * are mobile and render vertical fullscreen; falls back to `v1x1` so older
 * desktop clients don't letterbox awkwardly.
 *
 * Caption: WhatsApp caps captions at 1024 chars — we truncate with a single
 * U+2026 (…) so the caption stays readable. NZ English, no emojis.
 *
 * Rate limit: the Aiva gateway accepts at most one message per group every
 * 5 seconds (Baileys' own throttle plus our internal queue). We apply a
 * per-group token-bucket sleep before each send, so multiple goals in a
 * single match don't get rejected at the gateway.
 *
 * Failure handling: each group send is retried once with a 1s back-off on
 * any non-2xx or network error. After two failures we throw — the publish
 * orchestrator catches and writes a `status: 'failed'` audit row.
 *
 * Metrics: WhatsApp does not expose any group-message analytics through
 * Baileys or the Aiva gateway. `pullMetrics` returns zeros. (TODO: forward
 * counts could land in a future gateway endpoint; if so, populate
 * `shares` from there.)
 */

import { createHash } from 'node:crypto';

import type {
  Adapter,
  ClipReady,
  PostMetrics,
  PostRecord,
  PublishContext,
  PublishResult,
} from '../../types.js';
import { mockExternalId, mockUrl, pickCaption } from '../stub.js';

/** Hard cap on a WhatsApp media caption. */
const CAPTION_MAX = 1024;
/** Aiva gateway throttle — one message per group every N ms. */
export const RATE_LIMIT_MS = 5_000;
/** Number of attempts (1 original + 1 retry on failure). */
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 1_000;

export interface AivaSendMediaRequest {
  /** Group jid (e.g. `120363041234567890@g.us`). */
  to: string;
  /** Path or URL the gateway can reach to read the MP4 from. */
  mediaUrl: string;
  /** MIME type — `video/mp4` for clips. */
  mimeType: string;
  /** Caption text already truncated to <= 1024 chars. */
  caption: string;
}

export interface AivaSendMediaResult {
  ok: boolean;
  /** Gateway-issued message id when ok. */
  messageId?: string;
  raw?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Minimal Aiva gateway client for WhatsApp media. Mirrors the shape of
 * `AivaWhatsAppClient` in apps/auth-sms/src/whatsapp-baileys.ts but for
 * the `send-media` endpoint.
 *
 * Inject a custom implementation in tests (or once a shared
 * `packages/aiva-client` exists, swap for that).
 */
export interface AivaWhatsAppMediaSender {
  sendMedia(req: AivaSendMediaRequest): Promise<AivaSendMediaResult>;
}

export interface AivaMediaClientConfig {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  fetchImpl?: typeof fetch;
}

export class AivaWhatsAppMediaClient implements AivaWhatsAppMediaSender {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly sessionId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AivaMediaClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.sessionId = config.sessionId;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async sendMedia(req: AivaSendMediaRequest): Promise<AivaSendMediaResult> {
    const url = `${this.baseUrl}/api/v1/whatsapp/sessions/${encodeURIComponent(
      this.sessionId,
    )}/send-media`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          to: req.to,
          mediaUrl: req.mediaUrl,
          mimeType: req.mimeType,
          caption: req.caption,
        }),
      });
    } catch (err) {
      return {
        ok: false,
        errorCode: 'network',
        errorMessage:
          err instanceof Error ? err.message : 'wa gateway unreachable',
      };
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      payload = undefined;
    }

    if (!res.ok) {
      return {
        ok: false,
        raw: payload,
        errorCode: `http-${res.status}`,
        errorMessage: `aiva whatsapp gateway returned ${res.status}`,
      };
    }
    const messageId =
      typeof payload === 'object' && payload !== null && 'messageId' in payload
        ? String((payload as Record<string, unknown>).messageId ?? '')
        : '';
    return { ok: true, messageId, raw: payload };
  }
}

/** Truncate a caption to the WA media-caption limit, appending U+2026. */
export function truncateCaption(text: string, max = CAPTION_MAX): string {
  if (text.length <= max) return text;
  // Reserve one char for the ellipsis.
  return `${text.slice(0, max - 1)}…`;
}

/** Parse the CSV env var into a deduplicated list of jids. */
export function parseGroupIds(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const v = part.trim();
    if (v.length === 0) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export interface WhatsAppAdapterDeps {
  /** Resolves the Aiva client. Return null to skip real send (stub mode). */
  client: () => AivaWhatsAppMediaSender | null;
  /** Resolves the list of group jids to fan out to. */
  groupIds: () => string[];
  /** Sleep helper — overridable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Wall-clock — overridable for tests. */
  now?: () => number;
  /** Deterministic test override for the mock externalId. */
  hashId?: (clip: ClipReady) => string;
}

/** Default sleep based on setTimeout. */
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-group last-send timestamps. Module-scoped so that repeated calls to
 * the same `whatsappAdapter` instance (the one registered in index.ts)
 * share state. Tests use `createWhatsAppAdapter(...)` to get an isolated
 * instance.
 */
function makeRateLimiter(now: () => number, sleep: (ms: number) => Promise<void>) {
  const lastSentAt = new Map<string, number>();
  return async function waitForSlot(groupId: string): Promise<void> {
    const last = lastSentAt.get(groupId) ?? 0;
    const elapsed = now() - last;
    if (elapsed < RATE_LIMIT_MS) {
      await sleep(RATE_LIMIT_MS - elapsed);
    }
    lastSentAt.set(groupId, now());
  };
}

/**
 * Build a WhatsApp adapter with injected dependencies. The default export
 * `whatsappAdapter` is built from env at module load.
 */
export function createWhatsAppAdapter(deps: WhatsAppAdapterDeps): Adapter {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const hashId = deps.hashId ?? ((clip) => mockExternalId('whatsapp', clip));
  const waitForSlot = makeRateLimiter(now, sleep);

  return {
    platform: 'whatsapp',
    async publish(clip: ClipReady, ctx: PublishContext): Promise<PublishResult> {
      const client = deps.client();
      const groupIds = deps.groupIds();

      // Stub mode: no client configured (env missing). Keep the deterministic
      // mock-id contract every other adapter follows so the generic registry
      // tests still pass. The stub URL is a non-public marker — once the
      // env is configured the real publish path returns `url: ''` because
      // WhatsApp group messages have no permalink.
      if (!client || groupIds.length === 0) {
        const externalId = hashId(clip);
        return { externalId, url: mockUrl('whatsapp', externalId) };
      }

      const mediaUrl = clip.paths.v9x16 || clip.paths.v1x1;
      const caption = truncateCaption(pickCaption(clip, ctx.locale));

      const messageIds: string[] = [];
      for (const groupId of groupIds) {
        await waitForSlot(groupId);
        const id = await sendWithRetry(client, {
          to: groupId,
          mediaUrl,
          mimeType: 'video/mp4',
          caption,
        }, sleep);
        messageIds.push(id);
      }

      // The aggregate externalId is a stable hash of every message id, so
      // the audit row is unique per fan-out and consumers can dedupe.
      const aggregate = messageIds.length === 1
        ? messageIds[0]!
        : aggregateId(messageIds);

      return { externalId: aggregate, url: '' };
    },
    async pullMetrics(_post: PostRecord): Promise<PostMetrics> {
      // WhatsApp / Baileys does not expose group-message analytics. The
      // gateway might surface forward-counts in a later release — until
      // then, zeros so callers don't see misleading numbers.
      // TODO: poll forward-count once the Aiva gateway exposes it.
      return { views: 0, likes: 0, comments: 0, shares: 0 };
    },
  };
}

async function sendWithRetry(
  client: AivaWhatsAppMediaSender,
  req: AivaSendMediaRequest,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  let lastErr = 'whatsapp send failed';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await client.sendMedia(req);
    if (result.ok) {
      return result.messageId && result.messageId.length > 0
        ? result.messageId
        : '';
    }
    lastErr = result.errorMessage ?? result.errorCode ?? 'whatsapp send failed';
    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BACKOFF_MS);
    }
  }
  throw new Error(`whatsapp send failed: ${lastErr}`);
}

function aggregateId(messageIds: string[]): string {
  return createHash('sha256')
    .update(messageIds.join('|'))
    .digest('hex')
    .slice(0, 12);
}

// ---- Default env-backed instance (registered in adapters/index.ts) ----

function envClient(): AivaWhatsAppMediaSender | null {
  const baseUrl =
    process.env.AIVA_SMS_API_URL ?? process.env.AIVA_SMS_URL;
  const apiKey = process.env.AIVA_SMS_API_KEY;
  const sessionId = process.env.AIVA_WA_SESSION_ID;
  if (!baseUrl || !apiKey || !sessionId) return null;
  return new AivaWhatsAppMediaClient({ baseUrl, apiKey, sessionId });
}

function envGroupIds(): string[] {
  return parseGroupIds(process.env.WHATSAPP_GROUP_IDS);
}

export const whatsappAdapter: Adapter = createWhatsAppAdapter({
  client: envClient,
  groupIds: envGroupIds,
});
