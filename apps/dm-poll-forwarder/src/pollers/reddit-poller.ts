/**
 * Reddit DM poller.
 *
 * Uses Reddit's authenticated `/message/inbox.json` endpoint
 * (https://www.reddit.com/dev/api/#GET_message_inbox). Reddit returns a
 * `name` field per "thing" (e.g. `t4_abc123`) which is its globally
 * unique id; we use that as the cursor. Because the inbox is returned
 * newest-first, we pull `before=<cursor>` semantics by filtering in
 * memory after the fetch — Reddit's `before` param expects the *name*
 * of an item that must still be present in the listing, which is
 * fragile. In-memory filter is simpler and small (max 25 items per page).
 *
 * Auth: Reddit script-app OAuth password grant. The token is cached
 * in-memory until expiry; on 401 we drop the token and re-auth once.
 *
 * IMPORTANT: this implementation deliberately does NOT mark messages
 * read; dm-otp's reply path delivers the OTP and the user's response
 * implicitly closes the loop. If we marked-read here, the operator
 * would lose visibility in the bot account's UI.
 */

import type { Channel, PollMessage } from '../types.js';
import type { Poller, PollResult } from './types.js';

export interface RedditPollerOptions {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent?: string;
  fetch?: typeof fetch;
  /** Override the API host for testing. */
  apiBase?: string;
  /** Override the OAuth host for testing. */
  oauthBase?: string;
}

interface RedditInboxThing {
  kind: string;
  data: {
    name: string;
    author?: string;
    body?: string;
    created_utc?: number;
    was_comment?: boolean;
  };
}

interface RedditListing {
  kind: 'Listing';
  data: { children: RedditInboxThing[] };
}

interface OAuthCache {
  token: string;
  expiresAt: number;
}

export class RedditPoller implements Poller {
  readonly channel: Channel = 'reddit';
  readonly description = 'reddit /message/inbox';
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly apiBase: string;
  private readonly oauthBase: string;
  private auth: OAuthCache | null = null;

  constructor(private readonly opts: RedditPollerOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.userAgent = opts.userAgent ?? 'vtorn-dm-poll-forwarder/0.1 by tournamental-bot';
    this.apiBase = (opts.apiBase ?? 'https://oauth.reddit.com').replace(/\/+$/, '');
    this.oauthBase = (opts.oauthBase ?? 'https://www.reddit.com').replace(/\/+$/, '');
  }

  async poll(previousCursor: string | undefined): Promise<PollResult> {
    const token = await this.getAccessToken();
    const url = `${this.apiBase}/message/inbox.json?limit=25`;
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: `bearer ${token}`,
        'user-agent': this.userAgent,
      },
    });
    if (res.status === 401) {
      this.auth = null;
      throw new Error('reddit-auth-expired');
    }
    if (!res.ok) {
      throw new Error(`reddit-inbox-${res.status}`);
    }
    const body = (await res.json()) as RedditListing;
    const things = body?.data?.children ?? [];
    // Filter: only DMs (not comments) and only newer than cursor.
    const fresh = things
      .filter((t) => t.data && !t.data.was_comment)
      .filter((t) => (previousCursor ? t.data.name > previousCursor : true))
      .filter((t) => typeof t.data.author === 'string' && typeof t.data.body === 'string');
    // Reddit returns newest first; emit oldest-first so cursor advances monotonically.
    fresh.reverse();
    if (fresh.length === 0) return { messages: [], cursor: previousCursor };
    const messages: PollMessage[] = fresh.map((t) => ({
      channel: this.channel,
      externalId: t.data.author as string,
      text: t.data.body as string,
      cursor: t.data.name,
      receivedAt: t.data.created_utc ? Math.round(t.data.created_utc * 1000) : Date.now(),
    }));
    return { messages, cursor: fresh[fresh.length - 1]!.data.name };
  }

  private async getAccessToken(): Promise<string> {
    if (this.auth && this.auth.expiresAt > Date.now() + 30_000) return this.auth.token;
    const url = `${this.oauthBase}/api/v1/access_token`;
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString(
      'base64',
    );
    const form = new URLSearchParams({
      grant_type: 'password',
      username: this.opts.username,
      password: this.opts.password,
    });
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': this.userAgent,
      },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`reddit-oauth-${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.auth = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return this.auth.token;
  }
}
