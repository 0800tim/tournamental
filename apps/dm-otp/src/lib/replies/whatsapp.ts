/**
 * WhatsApp Cloud API outbound reply adapter.
 *
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface WhatsAppReplyConfig {
  phoneNumberId: string;
  accessToken: string;
  graphVersion?: string;
}

export async function sendWhatsAppOtp(
  cfg: WhatsAppReplyConfig,
  toMsisdn: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const v = cfg.graphVersion ?? 'v20.0';
  const url = `https://graph.facebook.com/${v}/${cfg.phoneNumberId}/messages`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toMsisdn,
      type: 'text',
      text: { body: otpMessageBody(code), preview_url: false },
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'whatsapp-send-failed' };
  }
  const data = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
  };
  return { ok: true, status: res.status, messageId: data.messages?.[0]?.id };
}
