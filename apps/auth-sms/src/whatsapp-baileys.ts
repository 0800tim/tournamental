/**
 * WhatsApp client.
 *
 * Two transport options, selected at boot via env:
 *
 *   1. WHATSAPP_TRANSPORT=aiva  (default — recommended)
 *      Use the Aiva SMS gateway's WhatsApp endpoint. The gateway runs
 *      a Baileys session under the hood; pairing happens once on the
 *      gateway dashboard and the session persists. Sending is a single
 *      HTTP call. This is the path Tim's existing Sdeal stack uses.
 *
 *   2. WHATSAPP_TRANSPORT=baileys
 *      Run Baileys in-process. Useful for environments where we don't
 *      want to share the Aiva gateway, or for local dev without
 *      gateway access. First-run pairing is via QR code printed to a
 *      PNG file and exposed at /v1/auth/whatsapp/pairing-qr (admin
 *      only).
 *
 * If neither transport is configured we fall back to a stub that logs
 * the OTP locally — same shape as the SMS stub.
 *
 * Phone format for both paths: digits only, no leading "+",
 * country-code first (e.g. "6421123456" for an NZ mobile).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import QRCode from 'qrcode';

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
          Authorization: `Bearer ${this.apiKey}`,
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
        headers: { Authorization: `Bearer ${this.apiKey}` },
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

// ---- Local Baileys transport ----

export interface LocalBaileysConfig {
  /** Directory for persistent auth credentials. Default ./baileys-auth. */
  authDir: string;
  /** File path for the most recent pairing QR PNG. */
  qrPngPath: string;
  /** Logger for connection events. */
  log: (msg: string, meta?: Record<string, unknown>) => void;
}

export function localBaileysConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LocalBaileysConfig {
  return {
    authDir: env.BAILEYS_AUTH_DIR ?? './baileys-auth',
    qrPngPath: env.BAILEYS_QR_PATH ?? './baileys-auth/last-qr.png',
    log: () => {
      /* injected at construction */
    },
  };
}

/**
 * Baileys is heavy and ESM-incompatible at the top level. We import
 * lazily so unit tests can run without pulling in `@whiskeysockets/baileys`
 * + `libsignal` + `link-preview-js`.
 */
export class LocalBaileysClient implements WhatsAppSender {
  private readonly config: LocalBaileysConfig;
  private sock: any = null;
  private latestQr: string | null = null;
  private connected = false;
  private starting: Promise<void> | null = null;

  constructor(config: LocalBaileysConfig) {
    this.config = config;
    mkdirSync(this.config.authDir, { recursive: true });
    mkdirSync(dirname(this.config.qrPngPath), { recursive: true });
  }

  private async ensureSocket(): Promise<void> {
    if (this.sock && this.connected) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const baileys = await import('@whiskeysockets/baileys');
      const makeWASocket =
        (baileys as any).default ?? (baileys as any).makeWASocket;
      const { useMultiFileAuthState, DisconnectReason } = baileys as any;
      const { state, saveCreds } = await useMultiFileAuthState(
        this.config.authDir,
      );
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
      });
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on(
        'connection.update',
        async (update: {
          connection?: 'open' | 'close' | 'connecting';
          lastDisconnect?: { error?: { output?: { statusCode?: number } } };
          qr?: string;
        }) => {
          if (update.qr) {
            this.latestQr = update.qr;
            try {
              await QRCode.toFile(this.config.qrPngPath, update.qr, {
                width: 320,
              });
              this.config.log('baileys: pairing QR saved', {
                path: this.config.qrPngPath,
              });
            } catch (err) {
              this.config.log('baileys: failed to save QR', {
                error: String(err),
              });
            }
          }
          if (update.connection === 'open') {
            this.connected = true;
            this.latestQr = null;
            this.config.log('baileys: connected');
          }
          if (update.connection === 'close') {
            this.connected = false;
            const code =
              update.lastDisconnect?.error?.output?.statusCode ?? 0;
            const shouldReconnect = code !== DisconnectReason.loggedOut;
            this.config.log('baileys: disconnected', {
              code,
              shouldReconnect,
            });
            if (shouldReconnect) {
              // Recreate the socket on next send.
              this.sock = null;
              this.starting = null;
            }
          }
        },
      );
      this.sock = sock;
    })();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async send(req: SendWhatsAppRequest): Promise<SendWhatsAppResult> {
    try {
      await this.ensureSocket();
    } catch (err) {
      return {
        ok: false,
        errorCode: 'baileys-init',
        errorMessage: err instanceof Error ? err.message : 'baileys init failed',
      };
    }
    if (!this.connected || !this.sock) {
      return {
        ok: false,
        errorCode: 'not-paired',
        errorMessage:
          'baileys session not connected — check /v1/auth/whatsapp/pairing-qr',
      };
    }
    const phone = normalisePhoneForWa(req.to);
    try {
      const result = await this.sock.sendMessage(`${phone}@s.whatsapp.net`, {
        text: req.body,
      });
      return { ok: true, raw: result };
    } catch (err) {
      return {
        ok: false,
        errorCode: 'send-failed',
        errorMessage: err instanceof Error ? err.message : 'baileys send failed',
      };
    }
  }

  async pairingQr(): Promise<string | null> {
    if (!this.starting && !this.sock) {
      this.ensureSocket().catch(() => {
        /* surface via send() */
      });
    }
    if (!this.latestQr) return null;
    // Return as data URL so the admin endpoint can inline it.
    try {
      return await QRCode.toDataURL(this.latestQr, { width: 320 });
    } catch {
      return null;
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.sock?.end?.(undefined);
    } catch {
      // ignore
    }
    this.sock = null;
    this.connected = false;
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
