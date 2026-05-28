/**
 * Aiva SMS gateway client.
 *
 * Aiva SMS is a self-hosted gateway that delivers SMS via Android
 * phones over FCM push. The gateway exposes a REST API; we hit it
 * with a Bearer token (JWT or API key). Any other gateway that
 * implements the same shape can plug in by overriding the base URL.
 *
 * Reference (relative to your gateway's base URL):
 *   - POST /api/v1/gateway/devices/{deviceId}/send-sms
 *     body: { message: string, recipients: string[] }
 *
 * Phone number format for SMS recipients: E.164 with leading "+".
 *
 * Configuration via environment:
 *   AIVA_SMS_API_URL      base URL, default http://localhost:9252
 *                         (legacy AIVA_SMS_URL is also accepted)
 *   AIVA_SMS_API_KEY      bearer token
 *   AIVA_SMS_DEVICE_ID    Android device UUID to send from
 */

export interface AivaSmsConfig {
  baseUrl: string;
  apiKey: string;
  deviceId: string;
  /** Optional fetch impl override for tests. */
  fetchImpl?: typeof fetch;
}

export interface SendSmsRequest {
  to: string; // E.164 with leading +
  body: string;
}

export interface SendSmsResult {
  ok: boolean;
  /** Raw response payload from the gateway, useful for logging / replays. */
  raw?: unknown;
  /** When ok===false, an opaque code suitable for logging. */
  errorCode?: string;
  /** When ok===false, a non-PII message safe to log. */
  errorMessage?: string;
}

/**
 * Resolve the Aiva SMS config from environment. Throws if required
 * values are missing — callers should fail closed rather than silently
 * skip OTP sends.
 */
export function aivaSmsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AivaSmsConfig {
  const baseUrl =
    env.AIVA_SMS_API_URL ?? env.AIVA_SMS_URL ?? 'http://localhost:9252';
  const apiKey = env.AIVA_SMS_API_KEY ?? '';
  const deviceId = env.AIVA_SMS_DEVICE_ID ?? '';
  if (!apiKey) throw new Error('AIVA_SMS_API_KEY is required');
  if (!deviceId) throw new Error('AIVA_SMS_DEVICE_ID is required');
  return { baseUrl, apiKey, deviceId };
}

export class AivaSmsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly deviceId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AivaSmsConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.deviceId = config.deviceId;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async send(req: SendSmsRequest): Promise<SendSmsResult> {
    const phone = req.to.startsWith('+') ? req.to : `+${req.to}`;
    const url = `${this.baseUrl}/api/v1/gateway/devices/${encodeURIComponent(
      this.deviceId,
    )}/send-sms`;

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
        body: JSON.stringify({
          message: req.body,
          recipients: [phone],
        }),
      });
    } catch (err) {
      return {
        ok: false,
        errorCode: 'network',
        errorMessage:
          err instanceof Error ? err.message : 'sms gateway unreachable',
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
        errorMessage: `aiva sms gateway returned ${res.status}`,
      };
    }
    return { ok: true, raw: payload };
  }
}

/**
 * No-op stub used in dev when AIVA_SMS_API_KEY is not set. Returns ok:true
 * and logs the OTP to the local logger so the operator can read it back.
 */
export class StubSmsClient {
  constructor(private readonly log: (msg: string) => void) {}

  async send(req: SendSmsRequest): Promise<SendSmsResult> {
    this.log(`[stub-sms] would-send to=${req.to} body=${req.body.replace(/\s+/g, ' ')}`);
    return { ok: true, raw: { stub: true } };
  }
}

export type SmsSender = AivaSmsClient | StubSmsClient;
