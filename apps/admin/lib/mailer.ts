/**
 * Magic-link mailer.
 *
 * Three providers:
 *   - "log"     — prints the link to stderr, dev only.
 *   - "resend"  — POSTs to https://api.resend.com/emails (RESEND_API_KEY).
 *   - "mailgun" — POSTs to https://api.mailgun.net/v3/{domain}/messages.
 *
 * Default = "log" so a fresh dev clone Just Works without external deps.
 *
 * Recommendation (see PR description): start with **Resend** in
 * production. Their free tier (100 emails/day) covers internal admin
 * traffic indefinitely, the API is one POST, and the React Email
 * compatibility lets us upgrade templates later. Mailgun is the
 * fallback if Tim already has a Mailgun account configured for other
 * Aiva services.
 */

export type MailerProvider = "log" | "resend" | "mailgun";

export interface MagicLinkEmail {
  to: string;
  url: string;
  expiresAt: number;
}

export async function sendMagicLink(input: MagicLinkEmail): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = (process.env.ADMIN_MAILER ?? "log") as MailerProvider;
  const from = process.env.ADMIN_MAIL_FROM ?? "VTourn Admin <admin@vtourn.com>";

  const subject = "Your VTourn admin sign-in link";
  const expMin = Math.max(1, Math.round((input.expiresAt - Date.now()) / 60_000));
  const text = [
    `Hi,`,
    ``,
    `Click this link to sign in to the VTourn admin console.`,
    `It expires in ${expMin} minutes and can only be used once.`,
    ``,
    input.url,
    ``,
    `If you didn't request this, ignore the email — your account stays safe.`,
  ].join("\n");

  if (provider === "log") {
    // eslint-disable-next-line no-console
    console.log(`[admin-mailer:log] to=${input.to} subject="${subject}"\n${text}`);
    return { ok: true };
  }

  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: input.to, subject, text }),
    });
    if (!r.ok) return { ok: false, error: `resend ${r.status} ${await r.text()}` };
    return { ok: true };
  }

  if (provider === "mailgun") {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;
    if (!apiKey || !domain) return { ok: false, error: "MAILGUN_API_KEY or MAILGUN_DOMAIN missing" };
    const auth = Buffer.from(`api:${apiKey}`).toString("base64");
    const body = new URLSearchParams({ from, to: input.to, subject, text });
    const r = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!r.ok) return { ok: false, error: `mailgun ${r.status} ${await r.text()}` };
    return { ok: true };
  }

  return { ok: false, error: `unknown mailer: ${provider}` };
}
