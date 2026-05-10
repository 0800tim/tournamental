/**
 * LinkedIn Messaging outbound reply adapter.
 *
 * Gated behind LinkedIn Marketing Developer Platform / Messages API
 * partner approval. Adapter is shaped so it works the moment access
 * lands; until then, the channel ships as `partner_gated` in the
 * /channels endpoint and the route handler returns 503 if env is
 * missing.
 *
 * https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community/messages-api
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface LinkedInReplyConfig {
  accessToken: string;
  /** URN of the bot's authenticated user/org. */
  fromUrn: string;
}

export async function sendLinkedInOtp(
  cfg: LinkedInReplyConfig,
  recipientUrn: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const url = 'https://api.linkedin.com/rest/messages';
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.accessToken}`,
      'LinkedIn-Version': '202404',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      recipients: [recipientUrn],
      from: cfg.fromUrn,
      subject: 'Tournamental login',
      body: otpMessageBody(code),
      messageContentType: 'TEXT',
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'linkedin-send-failed' };
  }
  return { ok: true, status: res.status };
}
