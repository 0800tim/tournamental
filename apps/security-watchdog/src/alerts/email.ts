/**
 * Email sink (SMTP).
 *
 * Off by default. Wired up via env when email is desired:
 *   SECURITY_EMAIL_TO        comma-separated recipients
 *   SECURITY_EMAIL_FROM
 *   SECURITY_EMAIL_SMTP_HOST
 *   SECURITY_EMAIL_SMTP_PORT (default 465)
 *   SECURITY_EMAIL_SMTP_USER
 *   SECURITY_EMAIL_SMTP_PASS
 *
 * Implemented via dynamic import of nodemailer so the watchdog doesn't
 * require it as a hard dependency. We avoid pulling nodemailer into the
 * default install footprint.
 */

import type { Finding } from '../lib/types.js';
import type { AlertSink } from './index.js';

export interface EmailSinkOptions {
  /** Inject for tests. */
  send?: (msg: { to: string; from: string; subject: string; text: string }) => Promise<void>;
}

export function buildEmailSink(opts: EmailSinkOptions = {}): AlertSink {
  const to = (process.env.SECURITY_EMAIL_TO ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const from = process.env.SECURITY_EMAIL_FROM;
  const host = process.env.SECURITY_EMAIL_SMTP_HOST;
  const enabled = to.length > 0 && !!from && (!!host || !!opts.send);
  return {
    name: 'email',
    enabled,
    async deliver(f: Finding) {
      if (!enabled || !from) return;
      const subject = `[VTorn ${f.severity.toUpperCase()}] ${f.title}`.slice(0, 200);
      const text = [
        `Severity: ${f.severity}`,
        `Source: ${f.source}`,
        `Status: ${f.status}`,
        `Location: ${f.location ?? 'n/a'}`,
        `Finding ID: ${f.id}`,
        '',
        f.detail ?? '',
      ].join('\n');
      const send = opts.send ?? (await loadSmtpSend());
      if (!send) throw new Error('email transport unavailable');
      for (const recipient of to) {
        await send({ to: recipient, from, subject, text });
      }
    },
  };
}

async function loadSmtpSend(): Promise<EmailSinkOptions['send'] | undefined> {
  try {
    // Dynamic import — nodemailer is intentionally optional and not in deps.
    // @ts-expect-error nodemailer is an optional runtime dep
    const nm = await import('nodemailer');
    const transport = nm.createTransport({
      host: process.env.SECURITY_EMAIL_SMTP_HOST,
      port: Number(process.env.SECURITY_EMAIL_SMTP_PORT ?? 465),
      secure: Number(process.env.SECURITY_EMAIL_SMTP_PORT ?? 465) === 465,
      auth: {
        user: process.env.SECURITY_EMAIL_SMTP_USER,
        pass: process.env.SECURITY_EMAIL_SMTP_PASS,
      },
    });
    return async (msg) => {
      await transport.sendMail(msg);
    };
  } catch {
    return undefined;
  }
}
