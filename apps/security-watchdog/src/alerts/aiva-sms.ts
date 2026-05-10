/**
 * Aiva SMS sink — pages on-call via SMS.
 *
 * Reuses the @vtorn/aiva-client gateway client. Multiple recipients are
 * supported by comma-separating phone numbers in SECURITY_ONCALL_PHONES.
 *
 * Env:
 *   AIVA_SMS_API_URL, AIVA_SMS_API_KEY, AIVA_SMS_DEVICE_ID    (gateway)
 *   SECURITY_ONCALL_PHONES                                     (E.164, comma)
 *
 * NOTE: We import lazily and softly so the watchdog can boot without
 * the aiva-client being installed (e.g. in CI dry-run).
 */

import type { Finding } from '../lib/types.js';
import type { AlertSink } from './index.js';

export interface AivaSmsSinkOptions {
  recipients?: string[];
  /** Lazily-injected sender for tests. */
  sender?: { send(req: { to: string; body: string }): Promise<{ ok: boolean; errorMessage?: string }> };
}

function parseRecipients(): string[] {
  const raw = process.env.SECURITY_ONCALL_PHONES ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\+[1-9][0-9]{6,14}$/.test(s));
}

export function buildAivaSmsSink(opts: AivaSmsSinkOptions = {}): AlertSink {
  const recipients = opts.recipients ?? parseRecipients();
  const haveCreds =
    !!process.env.AIVA_SMS_API_URL && !!process.env.AIVA_SMS_API_KEY && !!process.env.AIVA_SMS_DEVICE_ID;
  const enabled = recipients.length > 0 && (haveCreds || !!opts.sender);

  return {
    name: 'aiva-sms',
    enabled,
    async deliver(f: Finding) {
      if (!enabled) return;
      const body = `[VTorn ${f.severity.toUpperCase()}] ${f.title} — ${f.id}`.slice(0, 320);
      const sender =
        opts.sender ??
        (await loadAivaSender().catch(() => undefined));
      if (!sender) {
        throw new Error('aiva-sms client unavailable');
      }
      const errors: string[] = [];
      for (const to of recipients) {
        const res = await sender.send({ to, body });
        if (!res.ok) errors.push(`${to}:${res.errorMessage ?? 'unknown'}`);
      }
      if (errors.length === recipients.length) {
        throw new Error(`aiva-sms all recipients failed: ${errors.join('; ')}`);
      }
    },
  };
}

async function loadAivaSender(): Promise<AivaSmsSinkOptions['sender'] | undefined> {
  try {
    // @ts-expect-error @vtorn/aiva-client is an optional runtime dep
    const mod = await import('@vtorn/aiva-client');
    const cfg = mod.aivaSmsConfigFromEnv();
    return new mod.AivaSmsClient(cfg) as unknown as AivaSmsSinkOptions['sender'];
  } catch {
    return undefined;
  }
}
