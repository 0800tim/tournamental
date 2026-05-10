/**
 * End-to-end route tests using `app.inject()` (no real HTTP socket).
 * Each test builds a fresh Fastify instance with a stub SMS / WhatsApp
 * sender that captures outbound bodies — so we can extract the OTP the
 * server "sent" and feed it back to the verify endpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../src/index.js';
import { Storage } from '../src/storage.js';
import type { AuthContext } from '../src/context.js';
import type { SmsSender, SendSmsRequest, SendSmsResult } from '../src/sms-gateway.js';
import type { WhatsAppSender, SendWhatsAppRequest, SendWhatsAppResult } from '../src/whatsapp-baileys.js';

class CapturingSmsSender implements SmsSender {
  sent: SendSmsRequest[] = [];
  failNext = false;
  async send(req: SendSmsRequest): Promise<SendSmsResult> {
    this.sent.push(req);
    if (this.failNext) {
      this.failNext = false;
      return {
        ok: false,
        errorCode: 'http-500',
        errorMessage: 'forced failure',
      };
    }
    return { ok: true };
  }
}

class CapturingWaSender implements WhatsAppSender {
  sent: SendWhatsAppRequest[] = [];
  async send(req: SendWhatsAppRequest): Promise<SendWhatsAppResult> {
    this.sent.push(req);
    return { ok: true };
  }
  async pairingQr(): Promise<string | null> {
    return 'data:image/png;base64,AAA';
  }
  async shutdown(): Promise<void> {
    /* no-op */
  }
}

interface Harness {
  app: Awaited<ReturnType<typeof buildServer>>;
  storage: Storage;
  sms: CapturingSmsSender;
  wa: CapturingWaSender;
  now: { value: number };
}

async function makeHarness(): Promise<Harness> {
  const storage = new Storage({ path: ':memory:' });
  const sms = new CapturingSmsSender();
  const wa = new CapturingWaSender();
  const now = { value: 1_700_000_000_000 };
  const ctx: AuthContext = {
    storage,
    smsSender: sms,
    waSender: wa,
    config: {
      otpSecret: 'test-otp-secret-32-chars-aaaaaaa',
      jwtSecret: 'test-jwt-secret-32-chars-aaaaaaa',
      appHost: 'vtourn.test',
      productName: 'VTourn',
      adminToken: 'admin-token',
      otpTtlSeconds: 600,
      maxVerifyAttempts: 5,
      sessionTtlSeconds: 60 * 60,
      telegramBotToken: '',
      telegramBotUsername: 'VTournBot',
    },
    now: () => now.value,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };
  const app = await buildServer({ ctx });
  return { app, storage, sms, wa, now };
}

let h: Harness;

beforeEach(async () => {
  h = await makeHarness();
});

afterEach(async () => {
  await h.app.close();
});

function extractOtpFromSmsBody(body: string): string | null {
  const m = /code is (\d{6})/.exec(body);
  return m?.[1] ?? null;
}
function extractOtpFromWaBody(body: string): string | null {
  const m = /\*(\d{6})\*/.exec(body);
  return m?.[1] ?? null;
}

describe('POST /v1/auth/request', () => {
  it('happy path SMS — sends + returns masked phone', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone: '+6421999000', channel: 'sms' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.channel).toBe('sms');
    expect(body.phoneMasked).toMatch(/^\+64.+000$/);
    expect(body.expiresInSeconds).toBe(600);
    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0].to).toBe('+6421999000');
    expect(h.sms.sent[0].body).toMatch(/code is \d{6}/);
    expect(h.sms.sent[0].body).toMatch(/@vtourn\.test #\d{6}$/);
  });

  it('happy path WhatsApp — sends via wa sender', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone: '+6421999000', channel: 'whatsapp' },
    });
    expect(res.statusCode).toBe(200);
    expect(h.wa.sent).toHaveLength(1);
    expect(h.sms.sent).toHaveLength(0);
  });

  it('400 on bad phone', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone: '021abc', channel: 'sms' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 on bad channel', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone: '+6421999000', channel: 'pigeon' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('429 on second request inside cooldown', async () => {
    const a = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone: '+6421999000', channel: 'sms' },
    });
    expect(a.statusCode).toBe(200);
    const b = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone: '+6421999000', channel: 'sms' },
    });
    expect(b.statusCode).toBe(429);
    expect(b.headers['retry-after']).toBeDefined();
  });

  it('502 on send-failed and OTP is rolled back', async () => {
    h.sms.failNext = true;
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone: '+6421999000', channel: 'sms' },
    });
    expect(res.statusCode).toBe(502);
    expect(h.storage.getOtp('+6421999000')).toBeNull();
  });
});

describe('POST /v1/auth/verify', () => {
  async function requestOtp(phone: string, channel: 'sms' | 'whatsapp' = 'sms'): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone, channel },
    });
    expect(res.statusCode).toBe(200);
    const body =
      channel === 'sms'
        ? h.sms.sent[h.sms.sent.length - 1].body
        : h.wa.sent[h.wa.sent.length - 1].body;
    const otp =
      channel === 'sms'
        ? extractOtpFromSmsBody(body)
        : extractOtpFromWaBody(body);
    if (!otp) throw new Error('no OTP in stub body: ' + body);
    return otp;
  }

  it('happy path — verify, mint JWT, create user', async () => {
    const code = await requestOtp('+6421999000');
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.jwt.split('.').length).toBe(3);
    expect(body.user.phone).toBe('+6421999000');
    expect(body.user.id).toMatch(/^u_/);
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('returning user — same id on second verify', async () => {
    const code1 = await requestOtp('+6421999000');
    const r1 = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code: code1 },
    });
    const id1 = r1.json().user.id;

    // Advance time past cooldown to request again.
    h.now.value += 70 * 1000;
    const code2 = await requestOtp('+6421999000');
    const r2 = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code: code2 },
    });
    expect(r2.json().user.id).toBe(id1);
  });

  it('401 on wrong code', async () => {
    await requestOtp('+6421999000');
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code: '000000' },
    });
    // unless we got astronomically lucky, this is wrong
    if (res.statusCode === 200) {
      // The actual code happened to be 000000; legal but vanishingly unlikely.
      return;
    }
    expect(res.statusCode).toBe(401);
  });

  it('401 on no OTP requested', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('429 after 5 wrong attempts; OTP invalidated', async () => {
    const code = await requestOtp('+6421999000');
    // Construct a guaranteed-wrong code by flipping the last digit.
    const wrong = (parseInt(code, 10) + 1).toString().padStart(6, '0').slice(-6);
    for (let i = 0; i < 4; i++) {
      const r = await h.app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { phone: '+6421999000', code: wrong },
      });
      expect(r.statusCode).toBe(401);
    }
    const fifth = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code: wrong },
    });
    expect(fifth.statusCode).toBe(429);

    // Even the correct code is now invalid (OTP was deleted).
    const after = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code },
    });
    expect(after.statusCode).toBe(401);
  });

  it('OTP single-use — verifying again fails', async () => {
    const code = await requestOtp('+6421999000');
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code },
    });
    expect(ok.statusCode).toBe(200);
    const replay = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('expired OTP — 401', async () => {
    const code = await requestOtp('+6421999000');
    // Advance the clock past the OTP TTL.
    h.now.value += 11 * 60 * 1000;
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/auth/me + session lifecycle', () => {
  async function login(phone = '+6421999000'): Promise<string> {
    const reqRes = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone, channel: 'sms' },
    });
    expect(reqRes.statusCode).toBe(200);
    const code = extractOtpFromSmsBody(h.sms.sent[h.sms.sent.length - 1].body)!;
    const verifyRes = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone, code },
    });
    expect(verifyRes.statusCode).toBe(200);
    return verifyRes.json().jwt;
  }

  it('GET /v1/auth/me with valid JWT returns user', async () => {
    const jwt = await login();
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.phone).toBe('+6421999000');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('GET /v1/auth/me without JWT returns 401', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /v1/auth/me with malformed bearer returns 401', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refresh rotates the session (old jti revoked)', async () => {
    const jwt = await login();
    const r = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/session/refresh',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(r.statusCode).toBe(200);
    const newJwt = r.json().jwt;
    expect(newJwt).not.toBe(jwt);

    // Old JWT should now fail (session row revoked).
    const oldCheck = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(oldCheck.statusCode).toBe(401);

    // New JWT works.
    const newCheck = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${newJwt}` },
    });
    expect(newCheck.statusCode).toBe(200);
  });

  it('logout revokes the session', async () => {
    const jwt = await login();
    const out = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/session/logout',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(out.statusCode).toBe(200);
    const me = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(me.statusCode).toBe(401);
  });
});

describe('GET /v1/auth/whatsapp/pairing-qr', () => {
  it('401 without admin token', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/whatsapp/pairing-qr',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns HTML with the QR data URL when authed', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/whatsapp/pairing-qr',
      headers: { 'x-admin-token': 'admin-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('data:image/png;base64,AAA');
  });
});

describe('infra', () => {
  it('GET / returns service descriptor', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('vtourn-auth-sms');
  });

  it('GET /health returns ok with no-store', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
