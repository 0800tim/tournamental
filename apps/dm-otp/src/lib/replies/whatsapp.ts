/**
 * WhatsApp reply adapter — Aiva gateway transport.
 *
 * Same gateway path as apps/auth-sms uses (AivaWhatsAppClient), reduced
 * to the bits we need. Phone format: digits only, leading "+" stripped.
 *
 * Aiva endpoint:
 *   POST {AIVA_SMS_API_URL}/api/v1/whatsapp/sessions/{sessionId}/send
 *   body: { phone, message }
 */

import type { ReplyAdapter, ReplyResult, SendSeam } from './types.js';
import { realFetchSeam } from './types.js';

export interface WhatsAppReplyConfig {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  _send?: SendSeam;
}

function normalisePhoneForWa(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^0+/, '');
}

export class WhatsAppReply implements ReplyAdapter {
  channel = 'whatsapp' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly sessionId: string;
  private readonly send: SendSeam;

  constructor(cfg: WhatsAppReplyConfig) {
    if (!cfg.apiKey) throw new Error('WhatsAppReply: apiKey required');
    if (!cfg.sessionId) throw new Error('WhatsAppReply: sessionId required');
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
    this.apiKey = cfg.apiKey;
    this.sessionId = cfg.sessionId;
    this.send = cfg._send ?? realFetchSeam;
  }

  async reply(externalId: string, message: string): Promise<ReplyResult> {
    const phone = normalisePhoneForWa(externalId);
    const url = `${this.baseUrl}/api/v1/whatsapp/sessions/${encodeURIComponent(
      this.sessionId,
    )}/send`;
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ phone, message }),
    };
    try {
      const res = await this.send({ url, init });
      if (!res.ok) {
        return {
          ok: false,
          errorCode: `http-${res.status}`,
          errorMessage: res.bodyText.slice(0, 200),
        };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        errorCode: 'network',
        errorMessage: err instanceof Error ? err.message : 'aiva-wa send failed',
      };
    }
  }
}
