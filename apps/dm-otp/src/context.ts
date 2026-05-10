/**
 * DI context for routes. Same shape as apps/auth-sms/src/context.ts so
 * it stays a drop-in for tests.
 */

import type { CodeStore } from './code-store.js';
import type { ReplyAdapter } from './lib/replies/types.js';
import type { AuditWriter } from './audit.js';

export interface DmOtpConfig {
  /** HS256 secret for issued JWTs. >= 32 bytes. */
  jwtSecret: string;
  /** Telegram webhook shared-secret header. */
  telegramWebhookSecret: string;
  /** Aiva gateway webhook HMAC key. */
  aivaWebhookSecret: string;
  /** Meta App Secret used for Messenger + Instagram signature verification. */
  metaAppSecret: string;
  /** Subscription verify token presented at GET / for Meta. */
  metaVerifyToken: string;

  /** Rendered into deep-links. e.g. "vtorn_bot". */
  telegramBotUsername: string;
  /** Aiva WA phone number for wa.me link. Digits only, no leading +. */
  aivaWaPhone: string;
  /** Facebook Page username for m.me link. */
  facebookPageUsername: string;
  /** Instagram business username for ig.me link. */
  instagramBusinessUsername: string;

  /** Issued JWT TTL in seconds. Default 30d. */
  sessionTtlSeconds: number;
  /** Product name used in user-facing copy. */
  productName: string;
}

export interface DmOtpContext {
  store: CodeStore;
  replies: {
    telegram: ReplyAdapter;
    whatsapp: ReplyAdapter;
    messenger: ReplyAdapter;
    instagram: ReplyAdapter;
  };
  audit: AuditWriter;
  config: DmOtpConfig;
  now: () => number;
  log: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
}
