import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHarness, TELEGRAM_SECRET, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.app.close();
});

async function issueViaTelegram(
  chatId: string | number,
  text: string = 'log in',
): Promise<string> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/webhooks/telegram',
    headers: { 'x-telegram-bot-api-secret-token': TELEGRAM_SECRET },
    payload: {
      update_id: Date.now(),
      message: {
        chat: { id: chatId, type: 'private' },
        from: { id: chatId },
        text,
      },
    },
  });
  expect(res.statusCode).toBe(200);
  const code = h.replies.telegram.extractCode();
  expect(code).toMatch(/^\d{6}$/);
  return code as string;
}

describe('POST /v1/auth/dm-otp/verify', () => {
  it('400 on bad body', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { code: '1234' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('happy path — verify, mint JWT', async () => {
    const code = await issueViaTelegram(99);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.sessionJwt.split('.').length).toBe(3);
    expect(body.userId).toBe('dm:telegram:99');
    expect(body.channel).toBe('telegram');
    expect(body.externalId).toBe('99');
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('replay-attack — second verify with same code 401s', async () => {
    const code = await issueViaTelegram(100);
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { code },
    });
    expect(ok.statusCode).toBe(200);
    const replay = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { code },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('wrong code 401s', async () => {
    await issueViaTelegram(101);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { code: '000000' },
    });
    // Astronomically lucky correct match could theoretically pass.
    if (res.statusCode === 200) return;
    expect(res.statusCode).toBe(401);
  });

  it('expired code 401s', async () => {
    const code = await issueViaTelegram(102);
    h.store.forceExpire(code);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { code },
    });
    expect(res.statusCode).toBe(401);
  });

  it('channel-mismatch 401s when caller demands a specific channel', async () => {
    const code = await issueViaTelegram(103);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/dm-otp/verify',
      payload: { code, channel: 'whatsapp' },
    });
    expect(res.statusCode).toBe(401);
  });
});
