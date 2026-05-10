/**
 * SMS channel adapter — Aiva SMS gateway.
 *
 * Stubbed for v0.1. The signature mirrors the auth-sms `AivaSmsClient`
 * (apps/auth-sms/src/sms-gateway.ts) so the real implementation drops in
 * by replacing `send` with a fetch to the gateway:
 *
 *   POST {AIVA_SMS_API_URL}/api/v1/gateway/devices/{deviceId}/send-sms
 *   Authorization: Bearer {AIVA_SMS_API_KEY}
 *   { message: string, recipients: string[] }
 *
 * Env required for production:
 *   AIVA_SMS_API_URL    base URL (default http://localhost:9252)
 *   AIVA_SMS_API_KEY    bearer token
 *   AIVA_SMS_DEVICE_ID  Android device UUID to send from
 */

import type { AuditLogger } from './audit.js';

export interface SmsPayload {
  /** Plain SMS body (no markdown). */
  body: string;
}

export interface SmsResult {
  ok: boolean;
  errorMessage?: string;
}

export interface SmsSenderConfig {
  audit: AuditLogger;
  apiUrl?: string;
  apiKey?: string;
  deviceId?: string;
}

export class StubSmsSender {
  constructor(private readonly cfg: SmsSenderConfig) {}

  async send(
    userId: string,
    phone: string,
    payload: SmsPayload,
    event: 'kickoff_soon' | 'match_result' | 'leaderboard_move',
  ): Promise<SmsResult> {
    const configured = Boolean(this.cfg.apiKey && this.cfg.deviceId);
    const e164 = phone.startsWith('+') ? phone : `+${phone}`;
    await this.cfg.audit.append({
      channel: 'sms',
      userId,
      event,
      payload: {
        to: e164,
        body: payload.body,
      },
      ok: true,
      note: configured
        ? 'stub: AIVA_SMS configured but real send is not wired in v0.1'
        : 'stub: AIVA_SMS_API_KEY not configured; would skip in prod',
    });
    return { ok: true };
  }
}
