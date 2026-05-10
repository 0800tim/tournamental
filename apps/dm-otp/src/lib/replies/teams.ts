/**
 * Microsoft Teams (Bot Framework) outbound reply adapter.
 *
 * Sends a message activity to a previously-known conversation. The
 * inbound webhook handler captures `serviceUrl` and `conversation.id`
 * on first contact and we reply within that scope.
 *
 * Auth uses a service-to-service Bearer token from MSAL (client_credentials).
 *
 * https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface TeamsReplyConfig {
  appId: string;
  appPassword: string;
  tenantId?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(
  cfg: TeamsReplyConfig,
  fetchImpl: typeof globalThis.fetch,
): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }
  const tenant = cfg.tenantId ?? 'botframework.com';
  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.appId,
    client_secret: cfg.appPassword,
    scope: 'https://api.botframework.com/.default',
  });
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`teams-token-failed:${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

/** Test helper. */
export function _resetTeamsTokenCacheForTests(): void {
  cachedToken = null;
}

export interface TeamsConversationRef {
  /** Per-tenant Bot Framework service URL (captured from inbound). */
  serviceUrl: string;
  /** Bot Framework conversation id (captured from inbound). */
  conversationId: string;
}

export async function sendTeamsOtp(
  cfg: TeamsReplyConfig,
  ref: TeamsConversationRef,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  let token: string;
  try {
    token = await getToken(cfg, fetchImpl);
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
  const base = ref.serviceUrl.replace(/\/+$/, '');
  const url = `${base}/v3/conversations/${encodeURIComponent(ref.conversationId)}/activities`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'message', text: otpMessageBody(code) }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'teams-send-failed' };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, status: res.status, messageId: data.id };
}
