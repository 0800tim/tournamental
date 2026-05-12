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
import type { AuditLogger } from './audit.js';
import type { EmailSender } from './sendgrid.js';

export interface AuthContext {
  storage: Storage;
  smsSender: SmsSender;
  waSender: WhatsAppSender;
  /**
   * SendGrid (or stub) client for email OTPs. Optional: if SENDGRID_API_KEY
   * is unset the field is null and /v1/auth/email/* return 503.
   */
  emailSender: EmailSender | null;
  /**
   * Append-only OTP audit logger. Every send + verify outcome writes
   * a line. Defaults to a JSONL file at `AUDIT_LOG_PATH`; tests inject
   * an in-memory implementation.
   */
  audit: AuditLogger;
  config: {
    /** Secret used to HMAC OTP hashes. Must be > 32 bytes. */
    otpSecret: string;
    /** Secret used to sign session JWTs. Must be > 32 bytes. */
    jwtSecret: string;
    /** Apphost for the WebOTP suffix in SMS bodies. e.g. "tournamental.com". */
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
    /**
     * Shared secret the upstream Aiva SMS / WhatsApp gateway sends as
     * `x-inbound-secret` when calling /v1/auth/inbound-login. Empty
     * string disables the inbound-login endpoint (returns 401).
     * MUST be a high-entropy random string (>= 32 bytes); generate with
     * `openssl rand -hex 32` and store in .env, never in the repo.
     */
    inboundLoginSecret: string;
    /**
     * Per-code attempt cap. After this many failed magic-verify /
     * verify-by-code attempts against the same OTP row, the row is
     * burned. Default 5; this is the primary brute-force defence
     * and is IP-independent.
     */
    inboundMagicMaxAttempts: number;
    /**
     * Per-IP cap for verify-by-code attempts that match NO active OTP
     * (the "blind guessing" pattern). Generous on purpose so 20+
     * users behind a shared office NAT don't trip it; legitimate
     * verifications never count against this bucket.
     */
    inboundCodeIpFailureMax: number;
    /**
     * Cookie domain set on the inbound-flow session cookie. Default
     * `.tournamental.com` so the cookie is sent on both
     * tournamental.com (marketing) and play.tournamental.com (web app).
     */
    inboundCookieDomain: string;
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
