/**
 * Thin SendGrid v3 Mail Send client.
 *
 * We talk to SendGrid over HTTPS rather than SMTP because:
 *   - it's a single fetch() per send with no port wrangling
 *   - the API surfaces structured error codes we can audit-log
 *   - SendGrid's sender-authentication (DKIM/SPF) is set up against the
 *     tournamental.com domain, so emails from `login@tournamental.com`
 *     deliver cleanly without a separate SMTP relay
 *
 * The config is read once from `process.env` at boot via
 * `sendGridConfigFromEnv()`. Missing or empty `SENDGRID_API_KEY` falls
 * back to the `StubEmailSender` so dev environments still run.
 */

const ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';

export interface SendEmailInput {
  /** Single recipient address. We don't batch sends. */
  readonly to: string;
  readonly subject: string;
  /** Plain-text body, required by SendGrid. */
  readonly text: string;
  /** Optional HTML body; SendGrid renders this for capable clients. */
  readonly html?: string;
}

export interface SendEmailResult {
  /** True on 2xx from SendGrid. */
  readonly ok: boolean;
  /** SendGrid's X-Message-Id when supplied; useful for support tickets. */
  readonly messageId?: string;
  /** HTTP status of the SendGrid call (or 0 on transport failure). */
  readonly status: number;
  /** Best-effort error string for non-2xx responses. */
  readonly error?: string;
}

export interface EmailSender {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export interface SendGridConfig {
  /** API key beginning with `SG.` */
  readonly apiKey: string;
  /** Verified sender address; must be a domain SendGrid is authenticated for. */
  readonly fromEmail: string;
  /** Display name shown next to the address in mail clients. */
  readonly fromName: string;
}

export function sendGridConfigFromEnv(): SendGridConfig {
  const apiKey = process.env.SENDGRID_API_KEY ?? '';
  const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? '';
  const fromName = process.env.SENDGRID_FROM_NAME ?? 'Tournamental';
  if (!apiKey) throw new Error('SENDGRID_API_KEY is required');
  if (!fromEmail) throw new Error('SENDGRID_FROM_EMAIL is required');
  return { apiKey, fromEmail, fromName };
}

export class SendGridClient implements EmailSender {
  constructor(private readonly cfg: SendGridConfig) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const body = {
      personalizations: [
        {
          to: [{ email: input.to }],
          subject: input.subject,
        },
      ],
      from: { email: this.cfg.fromEmail, name: this.cfg.fromName },
      content: [
        { type: 'text/plain', value: input.text },
        ...(input.html ? [{ type: 'text/html', value: input.html }] : []),
      ],
    };

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message };
    }

    const messageId = res.headers.get('x-message-id') ?? undefined;
    if (res.ok) return { ok: true, status: res.status, messageId };

    // SendGrid returns a JSON body with `errors: [{ message, field }]`.
    let detail = '';
    try {
      const j = (await res.json()) as { errors?: { message?: string }[] };
      detail = j.errors?.map((e) => e.message).filter(Boolean).join('; ') ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    return {
      ok: false,
      status: res.status,
      error: detail || `sendgrid ${res.status}`,
    };
  }
}

/**
 * Logs to console rather than sending. Wired in when SendGrid env vars
 * are missing so dev environments and tests don't depend on the API.
 */
export class StubEmailSender implements EmailSender {
  constructor(private readonly log: (msg: string) => void) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.log(
      `[stub-email] to=${input.to} subject="${input.subject}"\n${input.text}`,
    );
    return { ok: true, status: 200, messageId: 'stub' };
  }
}
