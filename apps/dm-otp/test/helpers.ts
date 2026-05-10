/**
 * Shared test harness: capturing reply adapters + a freshly built
 * Fastify instance per test. Keeps the test files focused on assertions.
 */

import { buildServer } from '../src/index.js';
import { CodeStore } from '../src/code-store.js';
import { MemoryAuditWriter } from '../src/audit.js';
import type { DmOtpContext } from '../src/context.js';
import type {
  ReplyAdapter,
  ReplyResult,
} from '../src/lib/replies/types.js';

export class CapturingReply implements ReplyAdapter {
  sent: { externalId: string; message: string }[] = [];
  failNext = false;
  constructor(
    public channel: 'telegram' | 'whatsapp' | 'messenger' | 'instagram',
  ) {}
  async reply(externalId: string, message: string): Promise<ReplyResult> {
    if (this.failNext) {
      this.failNext = false;
      return {
        ok: false,
        errorCode: 'forced',
        errorMessage: 'forced failure',
      };
    }
    this.sent.push({ externalId, message });
    return { ok: true };
  }
  lastBody(): string | null {
    return this.sent.at(-1)?.message ?? null;
  }
  extractCode(): string | null {
    const body = this.lastBody();
    if (!body) return null;
    const m = /\b(\d{6})\b/.exec(body);
    return m?.[1] ?? null;
  }
}

export interface Harness {
  app: Awaited<ReturnType<typeof buildServer>>;
  store: CodeStore;
  audit: MemoryAuditWriter;
  replies: {
    telegram: CapturingReply;
    whatsapp: CapturingReply;
    messenger: CapturingReply;
    instagram: CapturingReply;
  };
  ctx: DmOtpContext;
}

export const TELEGRAM_SECRET = 'tg-secret-32-chars-aaaaaaaaaaaaaaaaaa';
export const AIVA_SECRET = 'aiva-secret-32-chars-bbbbbbbbbbbbbbbbbb';
export const META_SECRET = 'meta-secret-32-chars-cccccccccccccccccc';
export const META_VERIFY_TOKEN = 'meta-verify-token-yyy';

export async function makeHarness(): Promise<Harness> {
  const store = new CodeStore({ ttlMs: 5 * 60 * 1000 });
  const audit = new MemoryAuditWriter();
  const replies = {
    telegram: new CapturingReply('telegram'),
    whatsapp: new CapturingReply('whatsapp'),
    messenger: new CapturingReply('messenger'),
    instagram: new CapturingReply('instagram'),
  };
  const ctx: DmOtpContext = {
    store,
    replies,
    audit,
    config: {
      jwtSecret: 'jwt-secret-32-chars-eeeeeeeeeeeeeeeeeeee',
      telegramWebhookSecret: TELEGRAM_SECRET,
      aivaWebhookSecret: AIVA_SECRET,
      metaAppSecret: META_SECRET,
      metaVerifyToken: META_VERIFY_TOKEN,
      telegramBotUsername: 'vtorn_bot',
      aivaWaPhone: '64210000000',
      facebookPageUsername: 'vtorn',
      instagramBusinessUsername: 'vtorn',
      sessionTtlSeconds: 60 * 60,
      productName: 'VTourn',
    },
    now: () => Date.now(),
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };
  const app = await buildServer({ ctx });
  return { app, store, audit, replies, ctx };
}
