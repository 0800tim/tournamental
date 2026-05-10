/**
 * Core issuance: detect the "log in" trigger and produce a code + reply.
 *
 * Webhooks dispatch to `tryIssueOtp()` after authenticating their own
 * request. This function:
 *   1. Pattern-checks the inbound text — only `^\s*log\s*in\s*$/i` triggers.
 *   2. Generates a unique 6-digit code (collision-retry up to 4 times).
 *   3. Stores it in the code-store with channel + externalId.
 *   4. Dispatches the reply via the channel adapter.
 *   5. Writes a single audit row with the masked code.
 *
 * On any failure path the code-store row is rolled back so the user can
 * retry without waiting for TTL.
 */

import { generateOtpCode } from './otp.js';
import {
  makeIssuedEvent,
  makeVerifyEvent,
  type AuditWriter,
} from './audit.js';
import type { CodeStore, PendingCode } from './code-store.js';
import type { ReplyAdapter } from './lib/replies/types.js';
import type { DmChannel } from './jwt.js';

export const LOGIN_TRIGGER = /^\s*log\s*in\s*$/i;

export function isLoginTrigger(text: string | undefined | null): boolean {
  if (typeof text !== 'string') return false;
  return LOGIN_TRIGGER.test(text);
}

export function formatLoginMessage(opts: {
  code: string;
  productName: string;
  ttlSeconds: number;
}): string {
  const minutes = Math.max(1, Math.round(opts.ttlSeconds / 60));
  return (
    `Your ${opts.productName} login code is ${opts.code}.\n` +
    `\n` +
    `Type it on the website. Expires in ${minutes} minutes.`
  );
}

export interface IssueResult {
  ok: boolean;
  /** Set on success — the code we issued. Callers MUST NOT log this. */
  code?: string;
  errorCode?: string;
  errorMessage?: string;
}

export async function tryIssueOtp(opts: {
  store: CodeStore;
  reply: ReplyAdapter;
  audit: AuditWriter;
  channel: DmChannel;
  externalId: string;
  profile?: PendingCode['profile'];
  productName: string;
}): Promise<IssueResult> {
  // Mint a unique code (retry on the rare collision).
  let code = '';
  let inserted = false;
  for (let i = 0; i < 5; i++) {
    code = generateOtpCode();
    inserted = opts.store.put(code, {
      channel: opts.channel,
      externalId: opts.externalId,
      profile: opts.profile,
    });
    if (inserted) break;
  }
  if (!inserted) {
    return { ok: false, errorCode: 'mint-collision' };
  }

  const message = formatLoginMessage({
    code,
    productName: opts.productName,
    ttlSeconds: opts.store.ttlSeconds(),
  });

  const sent = await opts.reply.reply(opts.externalId, message);
  if (!sent.ok) {
    // Roll back so the user can retry immediately. Audit the failure.
    // We use the store's own pruning by force-expiring the entry — if
    // we delete from a missing-key path the next claim still 401s.
    opts.store.forceExpire(code);
    opts.audit.write(
      makeVerifyEvent({
        channel: opts.channel,
        externalId: opts.externalId,
        code,
        ok: false,
        reason: `send-failed:${sent.errorCode ?? 'unknown'}`,
      }),
    );
    return {
      ok: false,
      errorCode: sent.errorCode ?? 'send-failed',
      errorMessage: sent.errorMessage,
    };
  }

  opts.audit.write(
    makeIssuedEvent({
      channel: opts.channel,
      externalId: opts.externalId,
      code,
    }),
  );

  return { ok: true, code };
}
