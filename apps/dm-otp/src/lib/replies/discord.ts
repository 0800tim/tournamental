/**
 * Discord outbound reply adapter.
 *
 * Bot user posts to a DM channel id. The webhook handler is responsible
 * for resolving (or opening) a DM channel and passing the channelId
 * through to us.
 *
 * https://discord.com/developers/docs/resources/channel#create-message
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface DiscordReplyConfig {
  botToken: string;
  apiVersion?: string;
}

export async function sendDiscordOtp(
  cfg: DiscordReplyConfig,
  channelId: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const v = cfg.apiVersion ?? 'v10';
  const url = `https://discord.com/api/${v}/channels/${channelId}/messages`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${cfg.botToken}`,
    },
    body: JSON.stringify({
      content: otpMessageBody(code),
      allowed_mentions: { parse: [] },
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'discord-send-failed' };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, status: res.status, messageId: data.id };
}

/**
 * Open (or resolve) a DM channel between the bot and a user.
 * https://discord.com/developers/docs/resources/user#create-dm
 */
export async function createDmChannel(
  cfg: DiscordReplyConfig,
  recipientUserId: string,
  deps: AdapterDeps = {},
): Promise<{ ok: true; channelId: string } | { ok: false; status: number }> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const v = cfg.apiVersion ?? 'v10';
  const url = `https://discord.com/api/${v}/users/@me/channels`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${cfg.botToken}`,
    },
    body: JSON.stringify({ recipient_id: recipientUserId }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  if (!data.id) return { ok: false, status: 500 };
  return { ok: true, channelId: data.id };
}
