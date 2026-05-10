/**
 * Signal outbound reply adapter — talks to a self-hosted signal-cli
 * REST API gateway (https://github.com/bbernhard/signal-cli-rest-api).
 *
 * Each Tournamental region needs its own signal-cli instance bound to a
 * single phone number. SIGNAL_BOT_NUMBER is the bot's E.164 number;
 * SIGNAL_API_URL is the base URL of the gateway.
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface SignalReplyConfig {
  apiBaseUrl: string;
  botNumber: string;
}

export async function sendSignalOtp(
  cfg: SignalReplyConfig,
  recipientNumber: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const url = `${cfg.apiBaseUrl.replace(/\/+$/, '')}/v2/send`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: cfg.botNumber,
      recipients: [recipientNumber],
      message: otpMessageBody(code),
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'signal-send-failed' };
  }
  return { ok: true, status: res.status };
}

/**
 * Poll the signal-cli REST gateway for received messages.
 *
 * Returns parsed inbound items with the sender E.164 and message text.
 */
export interface SignalInboundMessage {
  id: string;
  fromNumber: string;
  body: string;
  timestamp: number;
}

export async function pollSignalInbox(
  cfg: SignalReplyConfig,
  deps: AdapterDeps = {},
): Promise<SignalInboundMessage[]> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const url = `${cfg.apiBaseUrl.replace(/\/+$/, '')}/v1/receive/${encodeURIComponent(cfg.botNumber)}`;
  const res = await fetchImpl(url);
  if (!res.ok) return [];
  const items = (await res.json().catch(() => [])) as Array<{
    envelope?: {
      source?: string;
      timestamp?: number;
      dataMessage?: { message?: string; timestamp?: number };
    };
  }>;
  const out: SignalInboundMessage[] = [];
  for (const it of items) {
    const env = it.envelope ?? {};
    const from = env.source ?? '';
    const body = env.dataMessage?.message ?? '';
    const ts = env.dataMessage?.timestamp ?? env.timestamp ?? Date.now();
    if (from && body) {
      out.push({
        id: `${from}:${ts}`,
        fromNumber: from,
        body,
        timestamp: ts,
      });
    }
  }
  return out;
}
