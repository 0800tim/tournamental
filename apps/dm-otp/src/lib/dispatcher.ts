/**
 * Inbound-message dispatcher.
 *
 * All channel webhooks parse their wire-format and call dispatch() with
 * a normalised `IncomingMessage`. The dispatcher:
 *   1. Checks the message text matches the login phrase.
 *   2. Generates an OTP (6-digit numeric) — or magic token for email.
 *   3. Stores it in the code-store under (channel, externalId).
 *   4. Calls the channel's reply adapter to deliver the code/link.
 *
 * Returns a record of what happened so callers (and tests) can assert
 * on it. Never throws on an unrecognised message — the contract is
 * "ignore non-login text politely".
 */

import { generateMagicToken, generateOtpCode, maskCode } from '../otp.js';
import type { CodeStore } from './code-store.js';
import { externalIdHash, maskExternalId } from './log.js';
import type { ReplyResult } from './replies/types.js';

export interface IncomingMessage {
  channel: string;
  /** Stable platform-specific id for the sender. */
  externalId: string;
  /** The raw text the user sent (already trimmed). */
  text: string;
  /** Optional metadata from the inbound webhook (e.g. Discord channel id). */
  meta?: Record<string, string>;
}

export type SendFn = (
  externalId: string,
  code: string,
  meta?: Record<string, string>,
) => Promise<ReplyResult>;

export interface DispatcherDeps {
  store: CodeStore;
  /** channel id -> sender. The sender controls the wire (code or link). */
  senders: Map<string, SendFn>;
  /** Channels that should issue magic tokens instead of 6-digit codes. */
  magicLinkChannels?: Set<string>;
  log?: {
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
  };
}

const LOGIN_PHRASES = new Set([
  'log in',
  'login',
  'log-in',
  'sign in',
  'signin',
  'sign-in',
  'auth',
  'verify',
]);

export function isLoginPhrase(s: string): boolean {
  return LOGIN_PHRASES.has(s.trim().toLowerCase());
}

export interface DispatchResult {
  ok: boolean;
  channel: string;
  /** Whether the message was a recognised login request. */
  recognised: boolean;
  /** Whether the reply send succeeded (only meaningful when recognised). */
  sent?: boolean;
  /** Reply detail / error (never user-facing). */
  detail?: string;
}

export async function dispatch(
  deps: DispatcherDeps,
  msg: IncomingMessage,
): Promise<DispatchResult> {
  const { store, senders, log, magicLinkChannels } = deps;
  if (!isLoginPhrase(msg.text)) {
    log?.info(
      {
        channel: msg.channel,
        ext: maskExternalId(msg.channel, msg.externalId),
        extHash: externalIdHash(msg.channel, msg.externalId),
      },
      'dm-otp: ignored non-login message',
    );
    return { ok: true, channel: msg.channel, recognised: false };
  }

  const sender = senders.get(msg.channel);
  if (!sender) {
    log?.warn(
      { channel: msg.channel },
      'dm-otp: no sender configured for channel',
    );
    return {
      ok: false,
      channel: msg.channel,
      recognised: true,
      sent: false,
      detail: 'no-sender',
    };
  }

  const useMagicLink = magicLinkChannels?.has(msg.channel) ?? false;
  const code = useMagicLink ? generateMagicToken() : generateOtpCode();

  store.put({
    channel: msg.channel,
    externalId: msg.externalId,
    code,
    meta: msg.meta,
  });

  const result = await sender(msg.externalId, code, msg.meta);

  log?.info(
    {
      channel: msg.channel,
      ext: maskExternalId(msg.channel, msg.externalId),
      extHash: externalIdHash(msg.channel, msg.externalId),
      codeMask: maskCode(code),
      sent: result.ok,
      status: result.status,
    },
    result.ok ? 'dm-otp: code issued' : 'dm-otp: code issued but reply failed',
  );

  return {
    ok: result.ok,
    channel: msg.channel,
    recognised: true,
    sent: result.ok,
    detail: result.detail,
  };
}
