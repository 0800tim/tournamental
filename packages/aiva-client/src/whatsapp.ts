/**
 * WhatsApp client (HTTP gateway transport).
 *
 * Talks to the Aiva SMS gateway's WhatsApp endpoint. The gateway runs a
 * Baileys session under the hood; pairing happens once on the gateway
 * dashboard and the session persists. Sending is a single HTTP call.
 *
 * Phone format: digits only, no leading "+", country-code first
 * (e.g. "6421123456" for an NZ mobile). Inputs are normalised here.
 *
 * The optional in-process Baileys transport (`LocalBaileysClient`) lives
 * in `apps/auth-sms/src/whatsapp-baileys.ts` because Baileys is a heavy
 * runtime dep; consumers that only need the HTTP path import from this
 * package and avoid pulling it in.
 */

export interface SendWhatsAppRequest {
  /** E.164 with or without leading "+" — we'll normalise. */
  to: string;
  body: string;
}

export interface SendWhatsAppResult {
  ok: boolean;
  raw?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export interface WhatsAppSender {
  send(req: SendWhatsAppRequest): Promise<SendWhatsAppResult>;
  /**
   * Returns the latest pairing QR code as a data URL, or null if the
   * session is already paired (or this transport doesn't expose one).
   */
  pairingQr(): Promise<string | null>;
  shutdown(): Promise<void>;
}

function normalisePhoneForWa(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^0+/, '');
}

// ---- Aiva gateway transport (HTTP) ----

export interface AivaWhatsAppConfig {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  fetchImpl?: typeof fetch;
}

export function aivaWhatsAppConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AivaWhatsAppConfig {
  const baseUrl =
    env.AIVA_SMS_API_URL ?? env.AIVA_SMS_URL ?? 'http://localhost:9252';
  const apiKey = env.AIVA_SMS_API_KEY ?? '';
  const sessionId = env.AIVA_WA_SESSION_ID ?? '';
  if (!apiKey) throw new Error('AIVA_SMS_API_KEY is required for WhatsApp');
  if (!sessionId) throw new Error('AIVA_WA_SESSION_ID is required for WhatsApp');
  return { baseUrl, apiKey, sessionId };
}

export class AivaWhatsAppClient implements WhatsAppSender {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly sessionId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AivaWhatsAppConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.sessionId = config.sessionId;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async send(req: SendWhatsAppRequest): Promise<SendWhatsAppResult> {
    const phone = normalisePhoneForWa(req.to);
    const url = `${this.baseUrl}/api/v1/whatsapp/sessions/${encodeURIComponent(
      this.sessionId,
    )}/send`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Aiva gateway expects x-api-key for server-to-server calls.
          // The Bearer path is reserved for JWT (dashboard auth) and
          // 401s for plain API keys (Tim's sysadmin 2026-05-28).
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ phone, message: req.body }),
      });
    } catch (err) {
      return {
        ok: false,
        errorCode: 'network',
        errorMessage:
          err instanceof Error ? err.message : 'wa gateway unreachable',
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
        raw: payload,
        errorCode: `http-${res.status}`,
        errorMessage: `aiva whatsapp gateway returned ${res.status}`,
      };
    }
    return { ok: true, raw: payload };
  }

  async pairingQr(): Promise<string | null> {
    // Aiva gateway exposes /api/v1/whatsapp/sessions/{id}/qr.
    const url = `${this.baseUrl}/api/v1/whatsapp/sessions/${encodeURIComponent(
      this.sessionId,
    )}/qr`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { 'x-api-key': this.apiKey },
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    try {
      const body = (await res.json()) as { qrCode?: string; status?: string };
      if (body.status === 'connected') return null;
      return body.qrCode ?? null;
    } catch {
      return null;
    }
  }

  async shutdown(): Promise<void> {
    // HTTP client — nothing to close.
  }
}

// ---- Stub ----

export class StubWhatsAppClient implements WhatsAppSender {
  constructor(private readonly log: (msg: string) => void) {}

  async send(req: SendWhatsAppRequest): Promise<SendWhatsAppResult> {
    this.log(
      `[stub-wa] would-send to=${req.to} body=${req.body.replace(/\s+/g, ' ')}`,
    );
    return { ok: true, raw: { stub: true } };
  }

  async pairingQr(): Promise<string | null> {
    return null;
  }

  async shutdown(): Promise<void> {
    /* no-op */
  }
}
