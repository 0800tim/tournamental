/**
 * WhatsApp channel adapter — Aiva WhatsApp gateway.
 *
 * Wraps `AivaWhatsAppClient` from `@vtorn/auth-sms` so push-notifications
 * can deliver kickoff alerts, match results, and leaderboard moves over
 * WhatsApp using the same Baileys session that `auth-sms` already pairs
 * for OTP delivery. WhatsApp is preferred over SMS in the dispatcher
 * `auto` policy because it is cheaper per message and has a markedly
 * higher open rate, and the recipient already trusts the sender ID from
 * the OTP login flow.
 *
 * Real send goes through:
 *   POST {AIVA_SMS_API_URL}/api/v1/whatsapp/sessions/{sessionId}/send
 *   Authorization: Bearer {AIVA_SMS_API_KEY}
 *   { phone: string, message: string }
 *
 * Env required for production:
 *   AIVA_SMS_API_URL     base URL (default http://localhost:9252)
 *   AIVA_SMS_API_KEY     bearer token shared with auth-sms
 *   AIVA_WA_SESSION_ID   paired Baileys session id on the gateway
 *
 * If those env vars are missing the sender records a stub note in the
 * audit log and returns ok:true (so dev environments do not spam real
 * numbers). To exercise the real send path locally, set the three env
 * vars and point them at a sandbox gateway with a test recipient.
 *
 * TODO: migrate the import to `@vtorn/aiva-client` once that package
 * lands on origin/main; see packages/aiva-client/ proposal.
 */

import type { WhatsAppSender } from '@vtorn/auth-sms/whatsapp';
import { AivaWhatsAppClient } from '@vtorn/auth-sms/whatsapp';
import type { AuditLogger } from './audit.js';

export interface WhatsAppPayload {
  /** Plain message body (WhatsApp supports basic markdown but we keep it
   *  simple to share content with the SMS rendering). */
  body: string;
  /** Optional URL appended on its own line. WhatsApp auto-links it. */
  url?: string;
}

export interface WhatsAppResult {
  ok: boolean;
  errorMessage?: string;
}

export interface WhatsAppSenderConfig {
  audit: AuditLogger;
  /** Aiva gateway base URL (default http://localhost:9252). */
  apiUrl?: string;
  /** Bearer token. */
  apiKey?: string;
  /** Paired Baileys session id on the gateway. */
  sessionId?: string;
  /** Override the underlying transport — used by tests. */
  transport?: WhatsAppSender;
  /** Override fetch — used by tests when constructing the real client. */
  fetchImpl?: typeof fetch;
}

type Event = 'kickoff_soon' | 'match_result' | 'leaderboard_move';

/**
 * Mask a phone for the audit log: keep "+" and last 4 digits, replace the
 * rest with `*`. Examples:
 *   +64211234567 -> +*******4567
 *   64211234567  -> *******4567
 *   +1 (555) 010-1234 -> +**********1234
 */
export function maskPhone(phone: string): string {
  const hasPlus = phone.startsWith('+');
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) {
    // Too short to mask meaningfully — leave entirely starred.
    return (hasPlus ? '+' : '') + '*'.repeat(digits.length);
  }
  const last4 = digits.slice(-4);
  const masked = '*'.repeat(digits.length - 4) + last4;
  return (hasPlus ? '+' : '') + masked;
}

export class WhatsAppPushSender {
  private readonly cfg: WhatsAppSenderConfig;
  private readonly transport: WhatsAppSender | null;
  private readonly configured: boolean;

  constructor(cfg: WhatsAppSenderConfig) {
    this.cfg = cfg;
    this.configured = Boolean(cfg.apiKey && cfg.sessionId);
    if (cfg.transport) {
      this.transport = cfg.transport;
    } else if (this.configured) {
      this.transport = new AivaWhatsAppClient({
        baseUrl: cfg.apiUrl ?? 'http://localhost:9252',
        apiKey: cfg.apiKey ?? '',
        sessionId: cfg.sessionId ?? '',
        fetchImpl: cfg.fetchImpl,
      });
    } else {
      this.transport = null;
    }
  }

  async send(
    userId: string,
    phone: string,
    payload: WhatsAppPayload,
    event: Event,
  ): Promise<WhatsAppResult> {
    const body = payload.url
      ? `${payload.body}\n${payload.url}`
      : payload.body;

    // No real transport configured — log to audit and return ok so dev
    // environments don't spam recipients.
    if (!this.transport) {
      await this.cfg.audit.append({
        channel: 'whatsapp',
        userId,
        event,
        payload: {
          to: maskPhone(phone),
          body,
        },
        ok: true,
        note: 'stub: AIVA_WA not configured; would skip in prod',
      });
      return { ok: true };
    }

    const result = await this.transport.send({ to: phone, body });
    await this.cfg.audit.append({
      channel: 'whatsapp',
      userId,
      event,
      payload: {
        to: maskPhone(phone),
        body,
      },
      ok: result.ok,
      note: result.ok
        ? 'aiva-wa: delivered'
        : `aiva-wa: ${result.errorCode ?? 'unknown'} ${result.errorMessage ?? ''}`.trim(),
    });
    return {
      ok: result.ok,
      errorMessage: result.errorMessage,
    };
  }

  /** Test helper — exposes whether the real Aiva transport is wired. */
  isConfigured(): boolean {
    return this.configured;
  }
}
