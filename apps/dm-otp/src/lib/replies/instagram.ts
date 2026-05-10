/**
 * Instagram (Meta Page-linked) outbound reply adapter.
 *
 * Same Send API surface as Messenger, scoped to the IG-linked page.
 * https://developers.facebook.com/docs/messenger-platform/instagram/send-messages
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface InstagramReplyConfig {
  pageAccessToken: string;
  graphVersion?: string;
}

export async function sendInstagramOtp(
  cfg: InstagramReplyConfig,
  igsid: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const v = cfg.graphVersion ?? 'v20.0';
  const url = `https://graph.facebook.com/${v}/me/messages?access_token=${encodeURIComponent(cfg.pageAccessToken)}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: igsid },
      message: { text: otpMessageBody(code) },
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'instagram-send-failed' };
  }
  const data = (await res.json().catch(() => ({}))) as {
    message_id?: string;
  };
  return { ok: true, status: res.status, messageId: data.message_id };
}
