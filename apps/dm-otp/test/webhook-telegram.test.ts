import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHarness, TELEGRAM_SECRET, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.app.close();
});

describe('POST /v1/webhooks/telegram', () => {
  it('401 without secret-token header', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/telegram',
      payload: {
        update_id: 1,
        message: { chat: { id: 42, type: 'private' }, text: 'log in' },
      },
    });
    expect(res.statusCode).toBe(401);
    // No reply attempted, no audit row.
    expect(h.replies.telegram.sent).toHaveLength(0);
    expect(h.audit.events).toHaveLength(0);
  });

  it('401 with wrong secret-token', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      payload: {
        update_id: 1,
        message: { chat: { id: 42, type: 'private' }, text: 'log in' },
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('issues a code and replies on "log in"', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': TELEGRAM_SECRET },
      payload: {
        update_id: 1,
        message: {
          chat: { id: 4242, type: 'private' },
          from: { id: 4242, username: 'alice', first_name: 'Alice' },
          text: 'log in',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.telegram.sent).toHaveLength(1);
    const code = h.replies.telegram.extractCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(h.replies.telegram.sent[0].externalId).toBe('4242');
    expect(h.audit.events).toHaveLength(1);
    expect(h.audit.events[0].type).toBe('issued');
    expect(h.audit.events[0].channel).toBe('telegram');
    expect(h.audit.events[0].codeMask).toMatch(/^\*{5}\d$/);
  });

  it('ignores non-"log in" messages', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': TELEGRAM_SECRET },
      payload: {
        update_id: 2,
        message: { chat: { id: 1, type: 'private' }, text: 'hello' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.telegram.sent).toHaveLength(0);
  });

  it('ignores group-chat messages', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': TELEGRAM_SECRET },
      payload: {
        update_id: 3,
        message: { chat: { id: 1, type: 'group' }, text: 'log in' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.telegram.sent).toHaveLength(0);
  });
});
