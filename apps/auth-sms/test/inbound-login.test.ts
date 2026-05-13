/**
 * End-to-end tests for the inbound-login flow:
 *
 *   1. POST /v1/auth/inbound-login (gateway-callable)
 *   2. POST /v1/auth/magic-verify (frontend, tapping ?v=<token>)
 *   3. POST /v1/auth/verify-by-code (frontend, code-paste fallback)
 *
 * Covers the security requirements specific to this flow:
 *   - x-inbound-secret enforcement on /inbound-login.
 *   - Per-code attempt cap (`inboundMagicMaxAttempts`).
 *   - IP + UA fingerprint binding on first use (not at issuance).
 *   - Generous per-IP failure cap only on the no-match path.
 *   - Set-Cookie on success with the right domain + flags.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../src/index.js';
import { Storage } from '../src/storage.js';
import type { AuthContext } from '../src/context.js';
import type {
  SmsSender,
  SendSmsRequest,
  SendSmsResult,
} from '../src/sms-gateway.js';
import type {
  WhatsAppSender,
  SendWhatsAppRequest,
  SendWhatsAppResult,
} from '../src/whatsapp-baileys.js';
import { buildMemoryAuditLogger } from '../src/audit.js';

class StubSms implements SmsSender {
  async send(_req: SendSmsRequest): Promise<SendSmsResult> {
    return { ok: true };
  }
}
class StubWa implements WhatsAppSender {
  async send(_req: SendWhatsAppRequest): Promise<SendWhatsAppResult> {
    return { ok: true };
  }
  async pairingQr(): Promise<string | null> {
    return null;
  }
  async shutdown(): Promise<void> {}
}

const INBOUND_SECRET = 'test-inbound-secret-32-chars-aaaaa';

async function makeHarness() {
  const storage = new Storage({ path: ':memory:' });
  const now = { value: 1_700_000_000_000 };
  const ctx: AuthContext = {
    storage,
    smsSender: new StubSms(),
    waSender: new StubWa(),
    audit: buildMemoryAuditLogger(),
    config: {
      otpSecret: 'test-otp-secret-32-chars-aaaaaaa',
      jwtSecret: 'test-jwt-secret-32-chars-aaaaaaa',
      appHost: 'tournamental.test',
      productName: 'Tournamental',
      adminToken: 'admin',
      otpTtlSeconds: 300,
      maxVerifyAttempts: 5,
      sessionTtlSeconds: 60 * 60,
      telegramBotToken: '',
      telegramBotUsername: 'TournamentalBot',
      inboundLoginSecret: INBOUND_SECRET,
      inboundMagicMaxAttempts: 3,
      inboundCodeIpFailureMax: 5,
      inboundCookieDomain: '.tournamental.com',
      magicLinkBaseUrl: 'https://play.tournamental.com/',
    },
    now: () => now.value,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  const app = await buildServer({ ctx });
  return { app, storage, now };
}

let h: Awaited<ReturnType<typeof makeHarness>>;

beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.app.close();
});

describe('POST /v1/auth/inbound-login', () => {
  it('rejects requests without x-inbound-secret', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      payload: { phone: '+6421000001', channel: 'whatsapp' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('bad-secret');
  });

  it('rejects requests with the wrong secret', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      headers: { 'x-inbound-secret': 'wrong' },
      payload: { phone: '+6421000001', channel: 'whatsapp' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns code + magicToken + magicLinkUrl on a valid call', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      headers: { 'x-inbound-secret': INBOUND_SECRET },
      payload: { phone: '+6421000001', channel: 'whatsapp' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.magicToken).toMatch(/^[a-f0-9]{64}$/);
    // magicLinkUrl pastes the token into the configured base URL so
    // the gateway can paste it verbatim into the user's reply.
    expect(body.magicLinkUrl).toBe(
      `https://play.tournamental.com/?v=${body.magicToken}`,
    );
  });

  it('persists the OTP row with challenge + null binding fields', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      headers: { 'x-inbound-secret': INBOUND_SECRET },
      payload: { phone: '+6421000001', channel: 'whatsapp' },
    });
    const { magicToken } = res.json();
    const row = h.storage.getOtpByChallenge(magicToken);
    expect(row).not.toBeNull();
    expect(row?.bound_ip).toBeNull();
    expect(row?.bound_ua_fp).toBeNull();
    expect(row?.magic_attempts).toBe(0);
  });

  it('rejects bad phone numbers', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      headers: { 'x-inbound-secret': INBOUND_SECRET },
      payload: { phone: 'not-a-phone', channel: 'whatsapp' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rate-limits per-phone (cooldown) — second request within 60s is 429', async () => {
    // First request succeeds.
    const r1 = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      headers: { 'x-inbound-secret': INBOUND_SECRET },
      payload: { phone: '+6421000100', channel: 'whatsapp' },
    });
    expect(r1.statusCode).toBe(200);
    // Second request within the cooldown window is throttled. This is
    // the primary SMS/WhatsApp-flood defence: an attacker cannot use
    // our gateway to spam a victim's phone.
    const r2 = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      headers: { 'x-inbound-secret': INBOUND_SECRET },
      payload: { phone: '+6421000100', channel: 'whatsapp' },
    });
    expect(r2.statusCode).toBe(429);
    expect(r2.json().reason).toBe('phone-cooldown');
  });

  it('rate-limits per-phone (hourly cap) — 5+ requests per phone per hour is 429', async () => {
    const phone = '+6421000101';
    // Five requests, each beyond the 60s cooldown.
    for (let i = 0; i < 5; i += 1) {
      h.now.value = 1_700_000_000_000 + i * 70 * 1000;
      const r = await h.app.inject({
        method: 'POST',
        url: '/v1/auth/inbound-login',
        headers: { 'x-inbound-secret': INBOUND_SECRET },
        payload: { phone, channel: 'whatsapp' },
      });
      expect(r.statusCode).toBe(200);
    }
    h.now.value = 1_700_000_000_000 + 6 * 70 * 1000;
    const blocked = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      headers: { 'x-inbound-secret': INBOUND_SECRET },
      payload: { phone, channel: 'whatsapp' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().reason).toBe('phone-hourly');
  });

  it('does NOT rate-limit per-IP (the gateway is the only legitimate caller)', async () => {
    // Hammer with many different phones from the same source IP. Per
    // /v1/auth/request the IP cap kicks in at 30/hour; here we go
    // well past it with different phones and expect all to succeed.
    for (let i = 0; i < 40; i += 1) {
      const phone = `+64210010${String(i).padStart(3, '0')}`;
      const r = await h.app.inject({
        method: 'POST',
        url: '/v1/auth/inbound-login',
        headers: { 'x-inbound-secret': INBOUND_SECRET },
        remoteAddress: '203.0.113.99',
        payload: { phone, channel: 'whatsapp' },
      });
      expect(r.statusCode).toBe(200);
    }
  });
});

describe('POST /v1/auth/magic-verify', () => {
  async function issue(phone = '+6421000001', channel: 'sms' | 'whatsapp' = 'whatsapp') {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      headers: { 'x-inbound-secret': INBOUND_SECRET },
      payload: { phone, channel },
    });
    return res.json() as { code: string; magicToken: string };
  }

  it('happy path — mints a JWT and sets Set-Cookie on .tournamental.com', async () => {
    const { magicToken } = await issue();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-verify',
      headers: { 'user-agent': 'tnm-test/1.0', 'accept-language': 'en-NZ' },
      payload: { token: magicToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.user.phone).toBe('+6421000001');
    const setCookie = res.headers['set-cookie'];
    expect(String(setCookie)).toContain('tnm_session=');
    expect(String(setCookie)).toContain('Domain=.tournamental.com');
    expect(String(setCookie)).toContain('HttpOnly');
    expect(String(setCookie)).toContain('Secure');
    expect(String(setCookie)).toContain('SameSite=Lax');
  });

  it('consumes the OTP row on success (single-use)', async () => {
    const { magicToken } = await issue();
    await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-verify',
      payload: { token: magicToken },
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-verify',
      payload: { token: magicToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unknown tokens', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-verify',
      payload: { token: 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('binds to first-use IP and rejects subsequent calls from a different IP', async () => {
    const { magicToken } = await issue();
    // First call from a "phone" UA — binds the row.
    const firstUa = 'Mozilla/5.0 (Android)';
    await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-verify',
      headers: { 'user-agent': firstUa, 'accept-language': 'en-NZ' },
      remoteAddress: '203.0.113.10',
      payload: { token: magicToken },
    });
    // The above CONSUMED the row, so we issue a fresh one and then
    // simulate a re-entry from a different IP/UA on a bound (not
    // consumed) row. We synthesise this by binding manually.
    const fresh = await issue('+6421000002', 'whatsapp');
    h.storage.bindOtpToFingerprint({
      phone: '+6421000002',
      ip: '203.0.113.10',
      uaFp: 'deadbeef00000000',
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-verify',
      headers: { 'user-agent': 'Other/1.0', 'accept-language': 'en-US' },
      remoteAddress: '198.51.100.99',
      payload: { token: fresh.magicToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('fingerprint-mismatch');
  });

  it('burns the row after inboundMagicMaxAttempts fingerprint mismatches', async () => {
    const { magicToken } = await issue('+6421000003');
    h.storage.bindOtpToFingerprint({
      phone: '+6421000003',
      ip: '203.0.113.99',
      uaFp: 'cafebabe00000000',
    });
    for (let i = 0; i < 3; i += 1) {
      await h.app.inject({
        method: 'POST',
        url: '/v1/auth/magic-verify',
        headers: { 'user-agent': `Attacker${i}`, 'accept-language': 'en' },
        payload: { token: magicToken },
      });
    }
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-verify',
      headers: { 'user-agent': 'AttackerN', 'accept-language': 'en' },
      payload: { token: magicToken },
    });
    expect(res.statusCode).toBe(401);
    // Row should be burned.
    expect(h.storage.getOtpByChallenge(magicToken)).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const { magicToken } = await issue('+6421000004');
    h.now.value += (300 + 1) * 1000; // TTL is 300s.
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-verify',
      payload: { token: magicToken },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/auth/verify-by-code', () => {
  async function issue(phone = '+6421000010') {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/inbound-login',
      headers: { 'x-inbound-secret': INBOUND_SECRET },
      payload: { phone, channel: 'whatsapp' },
    });
    return res.json() as { code: string; magicToken: string };
  }

  it('happy path — pastes the 6-digit code, gets a session', async () => {
    const { code } = await issue();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify-by-code',
      headers: { 'user-agent': 'tnm-test', 'accept-language': 'en-NZ' },
      payload: { code },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().jwt).toMatch(/^[A-Za-z0-9_-]+/);
  });

  it('rejects codes that match no active OTP', async () => {
    await issue();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify-by-code',
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('throttles per-IP after inboundCodeIpFailureMax no-match attempts', async () => {
    // Default test cap is 5. Six attempts, last should be 429.
    for (let i = 0; i < 5; i += 1) {
      await h.app.inject({
        method: 'POST',
        url: '/v1/auth/verify-by-code',
        remoteAddress: '203.0.113.50',
        payload: { code: String(100000 + i).padStart(6, '0') },
      });
    }
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify-by-code',
      remoteAddress: '203.0.113.50',
      payload: { code: '999999' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('ip-throttled');
  });

  it('successful verifies do NOT count against the IP no-match bucket', async () => {
    // 4 successful verifies from one IP — must not trip the cap (=5).
    for (let i = 0; i < 4; i += 1) {
      const phone = `+642100099${i}`;
      const { code } = await issue(phone);
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/auth/verify-by-code',
        remoteAddress: '203.0.113.200',
        payload: { code },
      });
      expect(res.statusCode).toBe(200);
    }
    // One more failing attempt from the same IP must still be allowed.
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify-by-code',
      remoteAddress: '203.0.113.200',
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed codes', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify-by-code',
      payload: { code: 'abcdef' },
    });
    expect(res.statusCode).toBe(400);
  });
});
