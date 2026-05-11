/**
 * Forwarder: posts a normalised PollMessage to the dm-otp webhook
 * endpoint that owns that channel. Each platform's endpoint expects a
 * slightly different body shape (see apps/dm-otp/src/routes/webhooks/*),
 * so we shape per-channel here. Auth is a shared bearer header — the
 * bearer value matches the corresponding `*_POLLER_BEARER` env on the
 * dm-otp side.
 *
 * Retries:
 *   - Network/HTTP-5xx/HTTP-429 → exponential backoff (200ms, 400ms, 800ms).
 *   - HTTP-4xx (other than 429) → no retry (it's a permanent client bug).
 *   - HTTP-2xx → success.
 *   - After 3 retries, the message is enqueued in the dead-letter file
 *     and the caller's response indicates `deadLettered: true`.
 *
 * Constructor accepts a `fetch` for tests; defaults to `globalThis.fetch`
 * which is `undici`-backed in Node 20+.
 */

import type { Channel, ForwardResult, PollMessage } from '../types.js';
import type { DeadLetterQueue } from './dead-letter.js';
import type { Logger } from './log.js';

export interface ForwarderOptions {
  /** Base URL of the dm-otp service, e.g. https://auth.tournamental.com */
  baseUrl: string;
  /** Bearer secret shared with the dm-otp service for poller forwards. */
  bearer: string;
  /** Optional override for fetch — used in tests. */
  fetch?: typeof fetch;
  /** Optional dead-letter queue; if absent, exhausted messages are dropped after logging. */
  deadLetter?: DeadLetterQueue;
  /** Max retry attempts after the initial try. Default 3. */
  maxRetries?: number;
  /** Initial backoff in ms; doubles each retry. Default 200. */
  initialBackoffMs?: number;
  /** Sleep override for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Logger; defaults to silent. */
  log?: Logger;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 200;

const ENDPOINT: Record<Channel, string> = {
  reddit: '/v1/auth/dm-otp/webhooks/reddit',
  mastodon: '/v1/auth/dm-otp/webhooks/mastodon',
  signal: '/v1/auth/dm-otp/webhooks/signal',
};

/** Per-channel body shapes that match apps/dm-otp's webhook contracts. */
function shapeBody(message: PollMessage): Record<string, unknown> {
  switch (message.channel) {
    case 'reddit':
      return { fromUsername: message.externalId, text: message.text };
    case 'mastodon':
      return { fromHandle: message.externalId, text: message.text, visibility: 'direct' };
    case 'signal':
      return { fromNumber: message.externalId, text: message.text };
  }
}

export class Forwarder {
  private readonly baseUrl: string;
  private readonly bearer: string;
  private readonly fetch: typeof fetch;
  private readonly deadLetter?: DeadLetterQueue;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: Logger;

  constructor(opts: ForwarderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.bearer = opts.bearer;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.deadLetter = opts.deadLetter;
    this.maxRetries = opts.maxRetries ?? DEFAULT_RETRIES;
    this.initialBackoffMs = opts.initialBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.sleep = opts.sleep ?? defaultSleep;
    this.log = opts.log ?? { info: () => {}, warn: () => {}, error: () => {} };
  }

  async forward(message: PollMessage): Promise<ForwardResult> {
    const url = `${this.baseUrl}${ENDPOINT[message.channel]}`;
    const body = JSON.stringify(shapeBody(message));
    let attempts = 0;
    let lastStatus = 0;
    let lastError = '';
    while (attempts <= this.maxRetries) {
      attempts += 1;
      try {
        const res = await this.fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.bearer}`,
            'x-dm-otp-secret': this.bearer,
          },
          body,
        });
        lastStatus = res.status;
        if (res.status >= 200 && res.status < 300) {
          return { ok: true, status: res.status, attempts, retried: attempts > 1 };
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          // Permanent client error — don't retry; dead-letter so we can inspect.
          lastError = `http-${res.status}`;
          break;
        }
        // 5xx or 429: fall through to the retry path below.
        lastError = `http-${res.status}`;
      } catch (err) {
        lastError = (err as Error).message ?? 'fetch-error';
        // Network failure also retries.
      }
      if (attempts > this.maxRetries) break;
      const backoff = this.initialBackoffMs * 2 ** (attempts - 1);
      await this.sleep(backoff);
    }
    // Exhausted retries (or hit a permanent 4xx) — dead-letter.
    if (this.deadLetter) {
      await this.deadLetter.push({
        channel: message.channel,
        message,
        attempts,
        lastStatus,
        lastError,
        enqueuedAt: Date.now(),
      });
      this.log.warn(
        { channel: message.channel, externalId: message.externalId, attempts, lastStatus, lastError },
        'forward exhausted; dead-lettered',
      );
    } else {
      this.log.error(
        { channel: message.channel, externalId: message.externalId, attempts, lastStatus, lastError },
        'forward exhausted; no dead-letter configured',
      );
    }
    return {
      ok: false,
      status: lastStatus,
      attempts,
      retried: attempts > 1,
      deadLettered: Boolean(this.deadLetter),
      error: lastError,
    };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
