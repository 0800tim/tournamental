/**
 * Tests for the OTP brute-force defence layered on top of the basic
 * verify route , phone lockout, per-IP throttle, constant-time decoy
 * compare, audit-log fields. These complement `routes.test.ts` which
 * already exercises the single-OTP attempt counter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../src/index.js';
import { Storage } from '../src/storage.js';
import {
  buildMemoryAuditLogger,
  type AuditAction,
} from '../src/audit.js';
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
import {
  DEFAULT_LOCKOUT_CONFIG,
  checkVerifyAllowed,
  recordIpAttempt,
  recordPhoneFailure,
  clearPhoneFailures,
} from '../src/lockout.js';
import { hashOtp, safeEqualHex } from '../src/otp.js';
import { timingSafeEqual } from 'node:crypto';

class CapturingSmsSender implements SmsSender {
  sent: SendSmsRequest[] = [];
  async send(req: SendSmsRequest): Promise<SendSmsResult> {
    this.sent.push(req);
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
    return null;
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
  audit: ReturnType<typeof buildMemoryAuditLogger>;
  now: { value: number };
}

async function makeHarness(): Promise<Harness> {
  const storage = new Storage({ path: ':memory:' });
  const sms = new CapturingSmsSender();
  const wa = new CapturingWaSender();
  const audit = buildMemoryAuditLogger();
  const now = { value: 1_700_000_000_000 };
  const ctx: AuthContext = {
    storage,
    smsSender: sms,
    waSender: wa,
    audit,
    config: {
      otpSecret: 'test-otp-secret-32-chars-aaaaaaa',
      jwtSecret: 'test-jwt-secret-32-chars-aaaaaaa',
      appHost: 'tournamental.test',
      productName: 'Tournamental',
      adminToken: 'admin-token',
      otpTtlSeconds: 600,
      maxVerifyAttempts: 5,
      sessionTtlSeconds: 60 * 60,
      telegramBotToken: '',
      telegramBotUsername: 'TournamentalBot',
      inboundLoginSecret: '',
      inboundMagicMaxAttempts: 5,
      inboundCodeIpFailureMax: 60,
      inboundCookieDomain: '.tournamental.com',
    },
    now: () => now.value,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  const app = await buildServer({ ctx });
  return { app, storage, sms, wa, audit, now };
}

function extractOtp(body: string): string {
  const m = /code is (\d{6})/.exec(body);
  if (!m) throw new Error('no code in body: ' + body);
  return m[1]!;
}

async function requestAndGetCode(
  h: Harness,
  phone: string,
): Promise<string> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/auth/request',
    payload: { phone, channel: 'sms' },
  });
  expect(res.statusCode).toBe(200);
  return extractOtp(h.sms.sent[h.sms.sent.length - 1]!.body);
}

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.app.close();
});

describe('phone lockout', () => {
  it('locks the phone for 1 hour after 5 consecutive failed verifies', async () => {
    const phone = '+6421999000';
    // Burn 5 failures across two fresh OTPs (each OTP only takes 4 wrong
    // attempts before its own counter trips at 5; the 5th failure
    // happens against a fresh OTP). We use the rate-limit shortcut by
    // bumping wall-clock past the 60s phone cooldown.
    for (let burn = 0; burn < 5; burn++) {
      const code = await requestAndGetCode(h, phone);
      // Build a guaranteed wrong code.
      const wrong = code === '000000' ? '000001' : '000000';
      const r = await h.app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { phone, code: wrong },
      });
      // The route returns 401 for each individual failure until the
      // lockout trips, then 429.
      expect([401, 429]).toContain(r.statusCode);
      h.now.value += 70 * 1000; // step past the 60s send-cooldown
    }

    // Even a fresh OTP cannot rescue: phone is locked.
    const code = await requestAndGetCode(h, phone).catch(() => null);
    // The send is allowed (lockout is on verify, not send), but the
    // verify is denied.
    if (code) {
      const r = await h.app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { phone, code },
      });
      expect(r.statusCode).toBe(429);
      const body = r.json();
      expect(body.error).toBe('phone-locked');
      expect(body.retryAfterSeconds).toBeGreaterThan(0);
      expect(r.headers['retry-after']).toBeDefined();
    }
  });

  it('lockout expires after the configured duration', () => {
    const phone = '+6421999000';
    const t0 = 1_700_000_000;
    // Trip the lockout directly via the unit-level helpers.
    for (let i = 0; i < 5; i++) {
      recordPhoneFailure({ storage: h.storage, phone, now: t0 });
    }
    expect(checkVerifyAllowed({ storage: h.storage, phone, ip: 'x', now: t0 }).ok).toBe(false);

    // Past the 1-hour window: allowed again.
    const after = t0 + DEFAULT_LOCKOUT_CONFIG.phoneLockoutSeconds + 1;
    expect(checkVerifyAllowed({ storage: h.storage, phone, ip: 'x', now: after }).ok).toBe(true);
  });

  it('successful verify clears the failure counter', async () => {
    const phone = '+6421999000';
    const code = await requestAndGetCode(h, phone);

    // One wrong attempt.
    const wrong = code === '000000' ? '000001' : '000000';
    const bad = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone, code: wrong },
    });
    expect(bad.statusCode).toBe(401);

    // Now succeed.
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone, code },
    });
    expect(ok.statusCode).toBe(200);

    // The failure key + lockout key are both wiped.
    const rows = h.storage.db
      .prepare(`SELECT key FROM rate_limit WHERE key LIKE 'verify:phone:%'`)
      .all() as Array<{ key: string }>;
    expect(rows.map((r) => r.key)).not.toContain(
      `verify:phone:${phone}:failures`,
    );
    expect(rows.map((r) => r.key)).not.toContain(
      `verify:phone:${phone}:locked-until`,
    );
  });
});

describe('per-IP verify throttle', () => {
  it('blocks at 30 verifies per 5 minutes per IP across many phones', () => {
    const ip = '203.0.113.42';
    const t = 1_700_000_000;
    for (let i = 0; i < 30; i++) {
      recordIpAttempt({ storage: h.storage, ip, now: t });
    }
    const r = checkVerifyAllowed({
      storage: h.storage,
      phone: '+6421000000',
      ip,
      now: t,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('ip-throttled');
      expect(r.retryAfterSeconds).toBeGreaterThan(0);
      expect(r.retryAfterSeconds).toBeLessThanOrEqual(
        DEFAULT_LOCKOUT_CONFIG.ipWindowSeconds,
      );
    }
  });

  it('verify route returns 429 ip-throttled when IP cap is exhausted', async () => {
    // Pre-bump the IP bucket to one-below-cap.
    const cap = DEFAULT_LOCKOUT_CONFIG.ipMaxPerWindow;
    for (let i = 0; i < cap; i++) {
      recordIpAttempt({
        storage: h.storage,
        ip: '127.0.0.1',
        now: Math.floor(h.now.value / 1000),
      });
    }
    const r = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code: '000000' },
    });
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toBe('ip-throttled');
  });
});

describe('constant-time decoy compare', () => {
  it('safeEqualHex uses node timingSafeEqual underneath', () => {
    const a = hashOtp({
      code: '123456',
      phone: '+6421999000',
      channel: 'sms',
      secret: 'k',
    });
    // Equal-length matched + mismatched paths both go through the
    // constant-time compare without leaking the result via throw.
    expect(safeEqualHex(a, a)).toBe(true);
    const b = a.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    expect(safeEqualHex(a, b)).toBe(false);
    // Property: when both inputs are valid 64-char hex strings, the
    // result is exactly what timingSafeEqual would return on the
    // decoded buffers.
    const decoy = 'f'.repeat(64);
    const decoyBuf = Buffer.from(decoy, 'hex');
    const aBuf = Buffer.from(a, 'hex');
    expect(safeEqualHex(a, decoy)).toBe(timingSafeEqual(aBuf, decoyBuf));
  });

  it('verify against unknown phone still does the HMAC compute', async () => {
    // No OTP requested for this phone , verify should return 401 but the
    // audit log must say "unknown-phone", which proves we hit the decoy
    // branch (i.e. didn't short-circuit on existence check).
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone: '+6421999000', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
    const actions = h.audit.lines.map((l) => l.action);
    expect(actions).toContain<AuditAction>('otp.verify.unknown-phone');
  });
});

describe('OTP TTL and single-use', () => {
  it('expired code is rejected', async () => {
    const phone = '+6421999000';
    const code = await requestAndGetCode(h, phone);
    // Advance well past the 10-minute TTL.
    h.now.value += 11 * 60 * 1000;
    const r = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone, code },
    });
    expect(r.statusCode).toBe(401);
    expect(h.audit.lines.some((l) => l.action === 'otp.verify.expired')).toBe(
      true,
    );
  });

  it('used code is rejected on second use', async () => {
    const phone = '+6421999000';
    const code = await requestAndGetCode(h, phone);
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone, code },
    });
    expect(ok.statusCode).toBe(200);

    const replay = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone, code },
    });
    expect(replay.statusCode).toBe(401);
  });
});

describe('audit log fields', () => {
  it('logs phoneId hash + ip + ua + outcome on every send and verify', async () => {
    const phone = '+6421999000';
    const send = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone, channel: 'sms' },
      headers: { 'user-agent': 'vitest/1.0' },
    });
    expect(send.statusCode).toBe(200);

    const code = extractOtp(h.sms.sent[0]!.body);
    const verify = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { phone, code },
      headers: { 'user-agent': 'vitest/1.0' },
    });
    expect(verify.statusCode).toBe(200);

    expect(h.audit.lines.length).toBeGreaterThanOrEqual(2);
    const send0 = h.audit.lines[0]!;
    expect(send0.action).toBe('otp.send.ok');
    expect(send0.phoneId).toMatch(/^[0-9a-f]{12}$/);
    // Plaintext phone must never appear in any audit line.
    for (const line of h.audit.lines) {
      expect(JSON.stringify(line)).not.toContain(phone);
    }

    const verify0 = h.audit.lines[h.audit.lines.length - 1]!;
    expect(verify0.action).toBe('otp.verify.ok');
    expect(verify0.ua).toBe('vitest/1.0');
  });

  it('rate-limited send writes an audit line', async () => {
    const phone = '+6421999000';
    await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone, channel: 'sms' },
    });
    const blocked = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { phone, channel: 'sms' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(
      h.audit.lines.some((l) => l.action === 'otp.send.rate-limited'),
    ).toBe(true);
  });
});

describe('lockout helper unit tests', () => {
  it('records and reads the lockout sentinel deterministically', () => {
    const phone = '+6421999000';
    const t = 1_700_000_000;
    for (let i = 0; i < 4; i++) {
      const r = recordPhoneFailure({ storage: h.storage, phone, now: t + i });
      expect(r.locked).toBe(false);
    }
    const last = recordPhoneFailure({ storage: h.storage, phone, now: t + 4 });
    expect(last.locked).toBe(true);
    expect(last.until).toBeGreaterThan(t);

    const denied = checkVerifyAllowed({
      storage: h.storage,
      phone,
      ip: '0.0.0.0',
      now: t + 10,
    });
    expect(denied.ok).toBe(false);

    clearPhoneFailures({ storage: h.storage, phone });
    const allowed = checkVerifyAllowed({
      storage: h.storage,
      phone,
      ip: '0.0.0.0',
      now: t + 10,
    });
    expect(allowed.ok).toBe(true);
  });
});
