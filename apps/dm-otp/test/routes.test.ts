import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHmac, generateKeyPairSync, sign as edSign } from 'node:crypto';
import { buildServer } from '../src/index.js';
import { CodeStore } from '../src/lib/code-store.js';
import { IdentityStore } from '../src/lib/identity-store.js';
import type { DmOtpContext } from '../src/context.js';
import type { SendFn } from '../src/lib/dispatcher.js';

const SECRET = 'a-test-secret-of-at-least-32-chars-1234';

function makeCtx(overrides: Partial<DmOtpContext> = {}): DmOtpContext {
  const senders = new Map<string, SendFn>();
  return {
    store: new CodeStore({ secret: SECRET }),
    identityStore: new IdentityStore(),
    senders,
    magicLinkChannels: new Set(['email']),
    config: {
      otpSecret: SECRET,
      jwtSecret: SECRET,
      productName: 'Tournamental',
      appHost: 'tournamental.com',
      appBaseUrl: 'https://tournamental.com',
      codeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
      metaAppSecret: 'meta-secret',
      telegramBotToken: 'tg-tok',
      telegramWebhookSecret: 'tg-webhook-secret',
      discordPublicKey: '',
      slackSigningSecret: 'slack-secret',
      lineChannelSecret: 'line-secret',
      viberAuthToken: 'viber-token',
      xConsumerSecret: 'x-secret',
      mailgunSigningKey: 'mg-key',
      mastodonInboundBearer: 'mast-bearer',
      redditPollerBearer: 'rd-bearer',
      signalPollerBearer: 'sg-bearer',
      teamsAppId: '',
      teamsAppPassword: 'teams-pw',
      enabledChannels: '',
    },
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    now: () => Date.UTC(2026, 4, 10, 0, 0, 0),
    ...overrides,
  };
}

describe('GET /v1/auth/dm-otp/channels', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildServer({ ctx: makeCtx() });
  });
  afterEach(async () => {
    await app.close();
  });

  it('returns at least 12 channels with status flags', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/dm-otp/channels?include=all',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { channels: Array<{ id: string; status: string; deepLink: string; delivery: string }> };
    expect(body.channels.length).toBeGreaterThanOrEqual(16);
    const ids = body.channels.map((c) => c.id);
    for (const expected of [
      'telegram', 'whatsapp', 'messenger', 'instagram',
      'discord', 'x', 'reddit', 'threads', 'slack', 'mastodon',
      'line', 'viber', 'teams', 'linkedin', 'signal', 'email',
    ]) {
      expect(ids).toContain(expected);
    }
    const linkedin = body.channels.find((c) => c.id === 'linkedin');
    expect(linkedin?.status).toBe('partner_gated');
    const x = body.channels.find((c) => c.id === 'x');
    expect(x?.status).toBe('partner_gated');
    const email = body.channels.find((c) => c.id === 'email');
    expect(email?.delivery).toBe('magic_link');
  });

  it('start-info returns the visible-channels list with phrase + ttl', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/dm-otp/start-info',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { phrase: string; ttlSeconds: number; channels: unknown[] };
    expect(body.phrase).toBe('log in');
    expect(body.ttlSeconds).toBe(300);
    expect(Array.isArray(body.channels)).toBe(true);
  });
});

describe('POST /v1/auth/dm-otp/verify', () => {
  let app: FastifyInstance;
  let ctx: DmOtpContext;
  beforeEach(async () => {
    ctx = makeCtx();
    app = await buildServer({ ctx });
  });
  afterEach(async () => {
    await app.close();
  });

  it('accepts a valid code and returns a JWT', async () => {
    ctx.store.put({ channel: 'discord', externalId: 'u1', code: '123456' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { channel: 'discord', externalId: 'u1', code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; jwt: string };
    expect(body.ok).toBe(true);
    expect(body.jwt.split('.').length).toBe(3);
  });

  it('rejects bad code with 401', async () => {
    ctx.store.put({ channel: 'discord', externalId: 'u1', code: '123456' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { channel: 'discord', externalId: 'u1', code: '999999' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('email magic-link click verifies via token only', async () => {
    ctx.store.put({ channel: 'email', externalId: 'a@b.com', code: 'tok-X' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/dm-otp/email/click?code=tok-X',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; user: { externalId: string } };
    expect(body.ok).toBe(true);
    expect(body.user.externalId).toBe('a@b.com');
  });
});

describe('webhook signature gates', () => {
  let app: FastifyInstance;
  let ctx: DmOtpContext;
  beforeEach(async () => {
    ctx = makeCtx();
    app = await buildServer({ ctx });
  });
  afterEach(async () => {
    await app.close();
  });

  it('telegram rejects without secret token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/telegram',
      payload: { message: { chat: { id: 1 }, text: 'log in' } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('telegram dispatches with the right secret', async () => {
    let sent: { id: string; code: string } | null = null;
    ctx.senders.set('telegram', async (id, code) => {
      sent = { id, code };
      return { ok: true };
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': 'tg-webhook-secret' },
      payload: { message: { chat: { id: 42 }, text: 'log in' } },
    });
    expect(res.statusCode).toBe(200);
    expect(sent).not.toBeNull();
    expect(sent!.id).toBe('42');
  });

  it('meta webhook rejects bad signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/messenger',
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
      payload: { entry: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('meta webhook accepts valid signature', async () => {
    let got: { id: string } | null = null;
    ctx.senders.set('messenger', async (psid) => {
      got = { id: psid };
      return { ok: true };
    });
    const body = { entry: [{ messaging: [{ sender: { id: 'PSID-1' }, message: { text: 'log in' } }] }] };
    const raw = JSON.stringify(body);
    const sig = createHmac('sha256', 'meta-secret').update(raw).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/messenger',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${sig}`,
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    expect(got!.id).toBe('PSID-1');
  });

  it('slack webhook handles url_verification challenge', async () => {
    const ts = String(Math.floor(ctx.now() / 1000));
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
    const sig = `v0=${createHmac('sha256', 'slack-secret').update(`v0:${ts}:${body}`).digest('hex')}`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/slack',
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': ts,
        'x-slack-signature': sig,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ challenge: 'abc' });
  });

  it('line webhook rejects bad signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/line',
      headers: { 'x-line-signature': 'no' },
      payload: { events: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('line webhook accepts valid signature and dispatches', async () => {
    let captured: { id: string } | null = null;
    ctx.senders.set('line', async (id) => {
      captured = { id };
      return { ok: true };
    });
    const body = JSON.stringify({
      events: [{ type: 'message', source: { userId: 'U1' }, message: { type: 'text', text: 'log in' } }],
    });
    const sig = createHmac('sha256', 'line-secret').update(body).digest('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/line',
      headers: { 'content-type': 'application/json', 'x-line-signature': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(captured!.id).toBe('U1');
  });

  it('viber webhook accepts valid signature', async () => {
    let captured: string | null = null;
    ctx.senders.set('viber', async (id) => {
      captured = id;
      return { ok: true };
    });
    const body = JSON.stringify({
      event: 'message',
      sender: { id: 'V1' },
      message: { type: 'text', text: 'log in' },
    });
    const sig = createHmac('sha256', 'viber-token').update(body).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/viber',
      headers: { 'content-type': 'application/json', 'x-viber-content-signature': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(captured).toBe('V1');
  });

  it('mastodon bearer-only webhook accepts a forwarded direct message', async () => {
    let captured: { id: string } | null = null;
    ctx.senders.set('mastodon', async (h) => {
      captured = { id: h };
      return { ok: true };
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/mastodon',
      headers: { authorization: 'Bearer mast-bearer' },
      payload: { fromHandle: 'alice@social', text: 'log in', visibility: 'direct' },
    });
    expect(res.statusCode).toBe(200);
    expect(captured!.id).toBe('alice@social');
  });

  it('linkedin returns 503 when not configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/linkedin',
      payload: {},
    });
    expect(res.statusCode).toBe(503);
  });

  it('discord ed25519 signature verifies and PING returns PONG', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).slice(-32).toString('hex');
    const customCtx = makeCtx({
      config: { ...makeCtx().config, discordPublicKey: pubRaw },
    });
    await app.close();
    app = await buildServer({ ctx: customCtx });
    const ts = String(Math.floor(customCtx.now() / 1000));
    const body = JSON.stringify({ type: 1 });
    const sig = edSign(null, Buffer.from(ts + body, 'utf8'), privateKey).toString('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/discord',
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': sig,
        'x-signature-timestamp': ts,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ type: 1 });
  });

  it('x webhook CRC GET returns sha256= response_token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/dm-otp/webhooks/x?crc_token=challenge',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { response_token: string };
    expect(body.response_token.startsWith('sha256=')).toBe(true);
  });

  it('reddit poller-forward bearer-protected webhook dispatches', async () => {
    let captured: string | null = null;
    ctx.senders.set('reddit', async (u) => {
      captured = u;
      return { ok: true };
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/reddit',
      headers: { authorization: 'Bearer rd-bearer' },
      payload: { fromUsername: 'alice', text: 'log in' },
    });
    expect(res.statusCode).toBe(200);
    expect(captured).toBe('alice');
  });

  it('signal poller-forward bearer-protected webhook dispatches', async () => {
    let captured: string | null = null;
    ctx.senders.set('signal', async (n) => {
      captured = n;
      return { ok: true };
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/signal',
      headers: { authorization: 'Bearer sg-bearer' },
      payload: { fromNumber: '+6421000', text: 'log in' },
    });
    expect(res.statusCode).toBe(200);
    expect(captured).toBe('+6421000');
  });

  it('teams dev-mode bearer-protected webhook captures the conversation ref', async () => {
    let captured: { meta?: Record<string, string> } = {};
    ctx.senders.set('teams', async (_id, _code, meta) => {
      captured = { meta };
      return { ok: true };
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/teams',
      headers: { authorization: 'Bearer teams-pw' },
      payload: {
        type: 'message',
        text: 'log in',
        from: { id: 'aad-1' },
        conversation: { id: 'c-1' },
        serviceUrl: 'https://smba.x/au/',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(captured.meta?.conversationId).toBe('c-1');
    expect(captured.meta?.serviceUrl).toBe('https://smba.x/au/');
  });

  it('email mailgun-signed webhook dispatches with the sender as externalId', async () => {
    let captured: string | null = null;
    ctx.senders.set('email', async (to) => {
      captured = to;
      return { ok: true };
    });
    const ts = String(Math.floor(ctx.now() / 1000));
    const token = 'tk';
    const sig = createHmac('sha256', 'mg-key').update(`${ts}${token}`).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/webhooks/email',
      payload: {
        signature: { timestamp: ts, token, signature: sig },
        sender: 'alice@example.com',
        subject: 'log in',
        'body-plain': '',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(captured).toBe('alice@example.com');
  });
});
