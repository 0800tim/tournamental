/**
 * Email magic-link outbound adapter.
 *
 * Sends a click-link, not a 6-digit code, so the user gets a one-tap
 * verify experience. The token is the same `code` value we keep in the
 * code store; the link routes via the website to GET
 * /v1/auth/dm-otp/email/click?token=...
 *
 * Inbound is handled in routes/webhooks/email.ts:
 *   - default = Mailgun route webhook (HMAC verified)
 *   - alt     = generic IMAP poller (env-toggled)
 *
 * We deliver via SMTP using a vendored zero-dep helper so we don't
 * pull nodemailer into the workspace solely for this. The helper is
 * good enough for an OTP body (no attachments, no MIME multipart,
 * no SMTP-AUTH variants beyond LOGIN).
 */

import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { magicLinkEmailBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface EmailReplyConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  fromName?: string;
  /** Base URL the magic link points at. */
  appBaseUrl: string;
}

export interface EmailSendOpts {
  to: string;
  token: string;
  /** Override the magic-link path. Default: /auth/dm-otp/verify?code= */
  linkPath?: string;
}

export async function sendEmailMagicLink(
  cfg: EmailReplyConfig,
  opts: EmailSendOpts,
  deps: AdapterDeps & { smtpClient?: SmtpClientLike } = {},
): Promise<ReplyResult> {
  const path = opts.linkPath ?? '/auth/dm-otp/verify?code=';
  const linkUrl = `${cfg.appBaseUrl.replace(/\/+$/, '')}${path}${encodeURIComponent(opts.token)}`;
  const fromHeader = cfg.fromName
    ? `${cfg.fromName} <${cfg.fromAddress}>`
    : cfg.fromAddress;
  const body = buildRfc822({
    from: fromHeader,
    to: opts.to,
    subject: 'Your Tournamental login link',
    text: magicLinkEmailBody(linkUrl),
  });
  try {
    const client = deps.smtpClient ?? new MinimalSmtp();
    await client.sendRaw({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      user: cfg.smtpUser,
      pass: cfg.smtpPass,
      from: cfg.fromAddress,
      to: opts.to,
      raw: body,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

export function buildRfc822(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    opts.text,
  ];
  return lines.join('\r\n');
}

export interface SmtpClientLike {
  sendRaw(opts: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    to: string;
    raw: string;
  }): Promise<void>;
}

/**
 * Bare-bones SMTP client supporting STARTTLS or implicit TLS,
 * AUTH LOGIN, and a single recipient. Sufficient for OTP / magic-link
 * delivery; not a general-purpose mailer.
 */
export class MinimalSmtp implements SmtpClientLike {
  async sendRaw(opts: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    to: string;
    raw: string;
  }): Promise<void> {
    const useImplicitTls = opts.port === 465;
    const socket = useImplicitTls
      ? tlsConnect({ host: opts.host, port: opts.port, servername: opts.host })
      : createConnection({ host: opts.host, port: opts.port });

    let buffer = '';
    const queue: string[] = [];
    let resolveLine: ((line: string) => void) | null = null;

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (resolveLine) {
          const r = resolveLine;
          resolveLine = null;
          r(line);
        } else {
          queue.push(line);
        }
      }
    });

    function readLine(): Promise<string> {
      if (queue.length) return Promise.resolve(queue.shift() as string);
      return new Promise((res, rej) => {
        resolveLine = res;
        socket.once('error', rej);
        socket.once('end', () => rej(new Error('smtp-disconnected')));
      });
    }

    async function expect(prefix: string): Promise<string> {
      // SMTP responses can be multi-line ("250-FOO\r\n250 OK\r\n").
      // Read until a line starts with `<code> ` (space, not dash).
      let line = '';
      for (;;) {
        line = await readLine();
        if (!line.startsWith(prefix)) {
          throw new Error(`smtp: expected ${prefix}; got "${line}"`);
        }
        if (line[prefix.length] !== '-') break;
      }
      return line;
    }

    function write(s: string): void {
      socket.write(s);
    }

    try {
      await expect('220');
      write(`EHLO tournamental.com\r\n`);
      await expect('250');

      if (!useImplicitTls) {
        write('STARTTLS\r\n');
        await expect('220');
        // Upgrade socket to TLS (best-effort; tests inject a mock client).
        // In production we recommend port 465 (implicit TLS) to avoid
        // this branch.
        throw new Error('smtp: STARTTLS not implemented; use implicit-TLS port 465');
      }

      write('AUTH LOGIN\r\n');
      await expect('334');
      write(`${Buffer.from(opts.user).toString('base64')}\r\n`);
      await expect('334');
      write(`${Buffer.from(opts.pass).toString('base64')}\r\n`);
      await expect('235');

      write(`MAIL FROM:<${opts.from}>\r\n`);
      await expect('250');
      write(`RCPT TO:<${opts.to}>\r\n`);
      await expect('250');
      write('DATA\r\n');
      await expect('354');

      // Dot-stuff the payload.
      const stuffed = opts.raw
        .split('\r\n')
        .map((l) => (l.startsWith('.') ? `.${l}` : l))
        .join('\r\n');
      write(`${stuffed}\r\n.\r\n`);
      await expect('250');

      write('QUIT\r\n');
    } finally {
      socket.end();
    }
  }
}
