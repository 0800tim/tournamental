// Slim Aiva-gateway WhatsApp client. Mirrors the shape of
// `apps/auth-sms/src/whatsapp-baileys.ts → AivaWhatsAppClient` without
// dragging in the qrcode / Baileys deps. Send-only — pairing is managed
// in the Aiva admin UI.

export interface AivaWhatsAppConfig {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  fetchImpl?: typeof fetch;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
  raw?: unknown;
}

export function aivaConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AivaWhatsAppConfig | null {
  const baseUrl =
    env.AIVA_SMS_API_URL ?? env.AIVA_SMS_URL ?? "http://localhost:9252";
  const apiKey = env.AIVA_SMS_API_KEY ?? "";
  const sessionId = env.AIVA_WA_SESSION_ID ?? "";
  if (!apiKey || !sessionId) return null;
  return { baseUrl, apiKey, sessionId };
}

export class AivaWhatsAppClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly sessionId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AivaWhatsAppConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.sessionId = config.sessionId;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /**
   * Send a WhatsApp message. `to` accepts either a JID
   * (`64211234567@s.whatsapp.net`) or a bare phone number; the gateway
   * normalises either form.
   */
  async sendMessage(to: string, body: string): Promise<SendResult> {
    const phone = jidToPhone(to);
    const url = `${this.baseUrl}/api/v1/whatsapp/sessions/${encodeURIComponent(
      this.sessionId,
    )}/send`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ phone, message: body }),
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "wa gateway unreachable",
      };
    }
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      payload = undefined;
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `aiva whatsapp gateway returned ${res.status}`,
        raw: payload,
      };
    }
    return { ok: true, status: res.status, raw: payload };
  }
}

/**
 * Strip the `@s.whatsapp.net` suffix to leave a digits-only phone string.
 * Idempotent for already-bare numbers.
 */
export function jidToPhone(jid: string): string {
  const at = jid.indexOf("@");
  const left = at >= 0 ? jid.slice(0, at) : jid;
  return left.replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * WhatsApp displays Telegram-flavoured `*bold*` and `_italic_` natively but
 * does not understand backticks-as-code or `[text](url)`. We strip backticks
 * and unwrap any markdown link syntax to plain URL text. Newlines pass
 * through.
 */
export function renderForWhatsApp(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2");
}
