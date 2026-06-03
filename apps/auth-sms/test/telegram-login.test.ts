/**
 * Tests for the Telegram Login Widget verifier — both the pure function
 * and the route-level happy / sad paths.
 *
 * The "synthetic signed payload" pattern: we hand-build a payload, run the
 * exact canonicalisation Telegram uses (sorted `key=value\n` join), HMAC
 * it with `SHA256(bot_token)`, and feed the result into the verifier.
 * This is the same algorithm Telegram's servers use to sign the widget's
 * onauth payload, so a verifier that accepts our test fixtures will also
 * accept real Telegram payloads.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { buildServer } from '../src/index.js';
import { Storage } from '../src/storage.js';
import type { AuthContext } from '../src/context.js';
import type { SmsSender, SendSmsRequest, SendSmsResult } from '../src/sms-gateway.js';
import type {
  WhatsAppSender,
  SendWhatsAppRequest,
  SendWhatsAppResult,
} from '../src/whatsapp-baileys.js';
import {
  buildDataCheckString,
  computeTelegramHash,
  verifyTelegramLogin,
  TelegramLoginVerifyError,
  TELEGRAM_AUTH_MAX_AGE_SECONDS,
} from '../src/telegram-login.js';
import { verifySessionJwt } from '../src/jwt.js';

const BOT_TOKEN = '123456789:test-bot-token-pretend-this-is-real-aaaaaaa';

interface SignablePayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  phone_number?: string;
}

/** Sign a payload the way Telegram's servers do, for use in tests. */
function signTelegramPayload(p: SignablePayload, botToken: string): SignablePayload & { hash: string } {
  const fields: Record<string, string | number> = {
    id: p.id,
    auth_date: p.auth_date,
  };
  if (p.first_name) fields.first_name = p.first_name;
  if (p.last_name) fields.last_name = p.last_name;
  if (p.username) fields.username = p.username;
  if (p.photo_url) fields.photo_url = p.photo_url;
  // phone_number is not part of the widget signature — it's added by us
  // post-hoc when the bot's request-contact step runs.
  const secret = createHash('sha256').update(botToken).digest();
  const dataCheckString = buildDataCheckString(fields);
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return { ...p, hash };
}

describe('telegram-login: pure verifier', () => {
  const NOW = 1_700_000_000;

  it('round-trips a known-good signed payload', () => {
    const payload = signTelegramPayload(
      {
        id: 42,
        first_name: 'Alice',
        last_name: 'Liddell',
        username: 'alicewonders',
        photo_url: 'https://t.me/i/userpic/320/alice.jpg',
        auth_date: NOW - 30,
      },
      BOT_TOKEN,
    );
    const v = verifyTelegramLogin({
      payload,
      botToken: BOT_TOKEN,
      nowSeconds: NOW,
    });
    expect(v.id).toBe(42);
    expect(v.firstName).toBe('Alice');
    expect(v.lastName).toBe('Liddell');
    expect(v.username).toBe('alicewonders');
    expect(v.photoUrl).toContain('alice.jpg');
  });

  it('round-trips a minimal payload (id + auth_date only)', () => {
    const payload = signTelegramPayload({ id: 7, auth_date: NOW }, BOT_TOKEN);
    const v = verifyTelegramLogin({
      payload,
      botToken: BOT_TOKEN,
      nowSeconds: NOW,
    });
    expect(v.id).toBe(7);
    expect(v.firstName).toBeNull();
    expect(v.lastName).toBeNull();
    expect(v.username).toBeNull();
  });

  it('rejects an expired payload (auth_date > 24 h old)', () => {
    const payload = signTelegramPayload(
      { id: 42, first_name: 'A', auth_date: NOW - TELEGRAM_AUTH_MAX_AGE_SECONDS - 1 },
      BOT_TOKEN,
    );
    expect(() =>
      verifyTelegramLogin({
        payload,
        botToken: BOT_TOKEN,
        nowSeconds: NOW,
      }),
    ).toThrowError(TelegramLoginVerifyError);
    try {
      verifyTelegramLogin({ payload, botToken: BOT_TOKEN, nowSeconds: NOW });
    } catch (err) {
      expect((err as TelegramLoginVerifyError).code).toBe('expired');
    }
  });

  it('rejects a payload with an auth_date too far in the future', () => {
    const payload = signTelegramPayload(
      { id: 42, first_name: 'A', auth_date: NOW + 1000 },
      BOT_TOKEN,
    );
    try {
      verifyTelegramLogin({ payload, botToken: BOT_TOKEN, nowSeconds: NOW });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TelegramLoginVerifyError).code).toBe('future');
    }
  });

  it('rejects a tampered payload (first_name mutated post-sign)', () => {
    const payload = signTelegramPayload(
      { id: 42, first_name: 'Alice', auth_date: NOW },
      BOT_TOKEN,
    );
    const tampered = { ...payload, first_name: 'Mallory' };
    try {
      verifyTelegramLogin({ payload: tampered, botToken: BOT_TOKEN, nowSeconds: NOW });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TelegramLoginVerifyError).code).toBe('bad-hash');
    }
  });

  it('rejects a payload signed with a different bot token', () => {
    const payload = signTelegramPayload(
      { id: 42, first_name: 'Alice', auth_date: NOW },
      'WRONG:bot-token-32-chars-aaaaaaaaaaa',
    );
    try {
      verifyTelegramLogin({ payload, botToken: BOT_TOKEN, nowSeconds: NOW });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TelegramLoginVerifyError).code).toBe('bad-hash');
    }
  });

  it('rejects a payload with a bogus hash length', () => {
    const payload = signTelegramPayload(
      { id: 42, first_name: 'Alice', auth_date: NOW },
      BOT_TOKEN,
    );
    const broken = { ...payload, hash: 'aaaa' };
    try {
      verifyTelegramLogin({ payload: broken, botToken: BOT_TOKEN, nowSeconds: NOW });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TelegramLoginVerifyError).code).toBe('bad-payload');
    }
  });

  it('computeTelegramHash matches the documented sorted-keys recipe', () => {
    // Spot-check the algorithm: sorted keys joined with \n, HMAC over the
    // SHA256 of the bot token.
    const fields = { id: 1, auth_date: 100, first_name: 'A' };
    const direct = computeTelegramHash(fields, BOT_TOKEN);
    const expected = createHmac('sha256', createHash('sha256').update(BOT_TOKEN).digest())
      .update('auth_date=100\nfirst_name=A\nid=1')
      .digest('hex');
    expect(direct).toBe(expected);
  });
});

// ---- Route-level integration ----

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
  async shutdown(): Promise<void> {
    /* no-op */
  }
}

interface Harness {
  app: Awaited<ReturnType<typeof buildServer>>;
  storage: Storage;
  now: { value: number };
  config: AuthContext['config'];
}

async function makeHarness(opts: { telegramBotToken?: string } = {}): Promise<Harness> {
  const storage = new Storage({ path: ':memory:' });
  const now = { value: 1_700_000_000_000 };
  const config: AuthContext['config'] = {
    otpSecret: 'test-otp-secret-32-chars-aaaaaaa',
    jwtSecret: 'test-jwt-secret-32-chars-aaaaaaa',
    appHost: 'tournamental.test',
    productName: 'Tournamental',
    adminToken: 'admin-token',
    otpTtlSeconds: 600,
    maxVerifyAttempts: 5,
    sessionTtlSeconds: 60 * 60,
    telegramBotToken: opts.telegramBotToken ?? BOT_TOKEN,
    telegramBotUsername: 'TournamentalBot',
    inboundLoginSecret: '',
    inboundMagicMaxAttempts: 5,
    inboundCodeIpFailureMax: 60,
    inboundCookieDomain: '.tournamental.com',
    magicLinkBaseUrl: 'https://play.tournamental.com/',
  };
  const ctx: AuthContext = {
    storage,
    smsSender: new StubSms(),
    waSender: new StubWa(),
    config,
    now: () => now.value,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  const app = await buildServer({ ctx });
  return { app, storage, now, config };
}

describe('POST /v1/auth/telegram/callback', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('happy path — verifies, upserts user, mints JWT', async () => {
    const nowSec = Math.floor(h.now.value / 1000);
    const payload = signTelegramPayload(
      {
        id: 12345,
        first_name: 'Tim',
        last_name: 'Thomas',
        username: 'timt',
        photo_url: 'https://t.me/i/userpic/320/timt.jpg',
        auth_date: nowSec - 5,
      },
      BOT_TOKEN,
    );
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram/callback',
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.jwt.split('.').length).toBe(3);
    expect(body.user.telegramId).toBe(12345);
    expect(body.user.telegramUsername).toBe('timt');
    expect(body.user.displayName).toBe('Tim Thomas');
    expect(body.user.phone).toBeNull();

    // The JWT verifies and carries the same shape SMS-OTP issues.
    const claims = await verifySessionJwt({
      secret: h.config.jwtSecret,
      token: body.jwt,
    });
    expect(claims.sub).toBe(body.user.id);
    expect(claims.phone).toBe('');
    expect(claims.jti).toBeTruthy();

    // /v1/auth/me works with the issued JWT.
    const me = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${body.jwt}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(body.user.id);
  });

  it('returning user — second login resolves to the same id', async () => {
    const nowSec = Math.floor(h.now.value / 1000);
    const a = signTelegramPayload(
      { id: 12345, first_name: 'Tim', auth_date: nowSec - 5 },
      BOT_TOKEN,
    );
    const r1 = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram/callback',
      payload: a,
    });
    expect(r1.statusCode).toBe(200);
    const id1 = r1.json().user.id;

    h.now.value += 60_000;
    const nowSec2 = Math.floor(h.now.value / 1000);
    const b = signTelegramPayload(
      { id: 12345, first_name: 'Tim', username: 'timt', auth_date: nowSec2 - 5 },
      BOT_TOKEN,
    );
    const r2 = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram/callback',
      payload: b,
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().user.id).toBe(id1);
    // Username metadata picked up on the refresh.
    expect(r2.json().user.telegramUsername).toBe('timt');
  });

  it('401 on tampered hash', async () => {
    const nowSec = Math.floor(h.now.value / 1000);
    const payload = signTelegramPayload(
      { id: 12345, first_name: 'Alice', auth_date: nowSec },
      BOT_TOKEN,
    );
    const tampered = { ...payload, first_name: 'Mallory' };
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram/callback',
      payload: tampered,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('bad-hash');
  });

  it('401 on expired payload', async () => {
    const nowSec = Math.floor(h.now.value / 1000);
    const payload = signTelegramPayload(
      {
        id: 12345,
        first_name: 'Alice',
        auth_date: nowSec - TELEGRAM_AUTH_MAX_AGE_SECONDS - 10,
      },
      BOT_TOKEN,
    );
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram/callback',
      payload,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('expired');
  });

  it('400 on bad body shape', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram/callback',
      payload: { id: 'not-a-number' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('503 when no bot token configured', async () => {
    const dis = await makeHarness({ telegramBotToken: '' });
    try {
      const nowSec = Math.floor(dis.now.value / 1000);
      const payload = signTelegramPayload(
        { id: 12345, first_name: 'Alice', auth_date: nowSec },
        BOT_TOKEN,
      );
      const res = await dis.app.inject({
        method: 'POST',
        url: '/v1/auth/telegram/callback',
        payload,
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('not-configured');
    } finally {
      await dis.app.close();
    }
  });

  it('SEC-AUTH-07: phone_number in the widget payload is IGNORED (Telegram does not verify it)', async () => {
    const nowSec = Math.floor(h.now.value / 1000);
    const payload = signTelegramPayload(
      { id: 99, first_name: 'Bob', auth_date: nowSec },
      BOT_TOKEN,
    );
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram/callback',
      payload: { ...payload, phone_number: '+6421000999' },
    });
    expect(res.statusCode).toBe(200);
    // The widget payload's phone_number is attacker-controlled (Telegram
    // does not verify phone ownership), so the callback MUST NOT trust it.
    // Phone-linking lives behind the OTP-verified
    // /v1/internal/telegram-link-phone endpoint instead.
    expect(res.json().user.phone).toBeNull();
  });
});
