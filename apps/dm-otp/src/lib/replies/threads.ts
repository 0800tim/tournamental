/**
 * Threads (Meta) outbound reply adapter.
 *
 * Threads exposes a Send API on Meta Graph; same auth shape as
 * Messenger / Instagram.
 *
 * https://developers.facebook.com/docs/threads/messages
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface ThreadsReplyConfig {
  pageAccessToken: string;
  graphVersion?: string;
}

export async function sendThreadsOtp(
  cfg: ThreadsReplyConfig,
  recipientId: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const v = cfg.graphVersion ?? 'v20.0';
  const url = `https://graph.threads.net/${v}/me/messages?access_token=${encodeURIComponent(cfg.pageAccessToken)}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: otpMessageBody(code) },
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'threads-send-failed' };
  }
  const data = (await res.json().catch(() => ({}))) as { message_id?: string };
  return { ok: true, status: res.status, messageId: data.message_id };
}
