/**
 * Service context — DI container for routes.
 *
 * Routes import the type and read what they need; the server.ts boot
 * function builds a real instance, and tests build a mock. This keeps
 * routes pure (no module-level singletons) and makes vitest happy.
 */

import type { Storage } from './storage.js';
import type { SmsSender } from './sms-gateway.js';
import type { WhatsAppSender } from './whatsapp-baileys.js';

export interface AuthContext {
  storage: Storage;
  smsSender: SmsSender;
  waSender: WhatsAppSender;
  config: {
    /** Secret used to HMAC OTP hashes. Must be > 32 bytes. */
    otpSecret: string;
    /** Secret used to sign session JWTs. Must be > 32 bytes. */
    jwtSecret: string;
    /** Apphost for the WebOTP suffix in SMS bodies. e.g. "vtourn.com". */
    appHost: string;
    /** Product name shown in OTP messages. */
    productName: string;
    /** Admin token gating /v1/auth/whatsapp/pairing-qr. */
    adminToken: string;
    /** OTP TTL in seconds. */
    otpTtlSeconds: number;
    /** Max verify attempts per OTP before invalidation. */
    maxVerifyAttempts: number;
    /** Session JWT TTL in seconds. */
    sessionTtlSeconds: number;
    /**
     * Telegram bot token used to verify Login Widget payloads. Empty
     * string disables the Telegram callback (returns 503).
     */
    telegramBotToken: string;
    /** Telegram bot username (without @) shown on the widget. */
    telegramBotUsername: string;
  };
  /** Time source — overridable for tests. */
  now: () => number;
  /** Fastify-friendly logger. */
  log: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
}
