/**
 * Facebook Messenger reply adapter.
 *
 * Send API:
 *   POST https://graph.facebook.com/v19.0/me/messages
 *   query: ?access_token=<page-access-token>
 *   body:  { recipient: { id: PSID }, message: { text }, messaging_type: "RESPONSE" }
 *
 * Why this works under the 24-hour rule: Meta allows free-form messages
 * for 24h after a user-initiated event. Our flow is user-initiated by
 * definition (they DM'd us "log in"), so messaging_type=RESPONSE is the
 * correct tag and we are inside the window.
 *
 * Reference: https://developers.facebook.com/docs/messenger-platform/reference/send-api
 */

import type { ReplyAdapter, ReplyResult, SendSeam } from './types.js';
import { realFetchSeam } from './types.js';

export interface MessengerReplyConfig {
  pageAccessToken: string;
  /** Graph API version. Defaults to v19.0. */
  graphVersion?: string;
  /** Override base for testing. */
  apiBase?: string;
  _send?: SendSeam;
}

export class MessengerReply implements ReplyAdapter {
  channel = 'messenger' as const;
  private readonly pageAccessToken: string;
  private readonly graphVersion: string;
  private readonly apiBase: string;
  private readonly send: SendSeam;

  constructor(cfg: MessengerReplyConfig) {
    if (!cfg.pageAccessToken) {
      throw new Error('MessengerReply: pageAccessToken required');
    }
    this.pageAccessToken = cfg.pageAccessToken;
    this.graphVersion = cfg.graphVersion ?? 'v19.0';
    this.apiBase = (cfg.apiBase ?? 'https://graph.facebook.com').replace(/\/$/, '');
    this.send = cfg._send ?? realFetchSeam;
  }

  async reply(externalId: string, message: string): Promise<ReplyResult> {
    const url = `${this.apiBase}/${this.graphVersion}/me/messages?access_token=${encodeURIComponent(
      this.pageAccessToken,
    )}`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: externalId },
        message: { text: message },
        messaging_type: 'RESPONSE',
      }),
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
        errorMessage: err instanceof Error ? err.message : 'messenger send failed',
      };
    }
  }
}
