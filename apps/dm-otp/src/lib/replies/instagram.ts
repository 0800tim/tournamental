/**
 * Instagram DM reply adapter.
 *
 * Instagram Messaging API (the "Messenger Platform for Instagram"):
 *   POST https://graph.facebook.com/v19.0/me/messages
 *   query: ?access_token=<ig-page-access-token>
 *   body:  { recipient: { id: IGSID }, message: { text } }
 *
 * Same 24h-window rule as Messenger; same user-initiated escape (the
 * user just sent us "log in" via DM). Required permissions on the IG
 * Business account:
 *   - instagram_basic
 *   - instagram_manage_messages
 *   - pages_messaging  (the IG account must be linked to a Facebook Page)
 *
 * Reference: https://developers.facebook.com/docs/instagram-platform/messaging-api
 */

import type { ReplyAdapter, ReplyResult, SendSeam } from './types.js';
import { realFetchSeam } from './types.js';

export interface InstagramReplyConfig {
  pageAccessToken: string;
  graphVersion?: string;
  apiBase?: string;
  _send?: SendSeam;
}

export class InstagramReply implements ReplyAdapter {
  channel = 'instagram' as const;
  private readonly pageAccessToken: string;
  private readonly graphVersion: string;
  private readonly apiBase: string;
  private readonly send: SendSeam;

  constructor(cfg: InstagramReplyConfig) {
    if (!cfg.pageAccessToken) {
      throw new Error('InstagramReply: pageAccessToken required');
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
        errorMessage: err instanceof Error ? err.message : 'instagram send failed',
      };
    }
  }
}
