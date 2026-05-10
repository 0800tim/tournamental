import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHarness, AIVA_SECRET, type Harness } from './helpers.js';
import { hmacSha256Hex } from '../src/lib/signatures.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.app.close();
});

function sign(body: object): { rawBody: string; sig: string } {
  const rawBody = JSON.stringify(body);
  return { rawBody, sig: `sha256=${hmacSha256Hex(AIVA_SECRET, rawBody)}` };
}

describe('POST /v1/webhooks/whatsapp', () => {
  it('401 without signature', async () => {
    const body = { from: '+6421999000', text: 'log in' };
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/whatsapp',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
    expect(res.statusCode).toBe(401);
    expect(h.replies.whatsapp.sent).toHaveLength(0);
  });

  it('401 with wrong signature', async () => {
    const body = { from: '+6421999000', text: 'log in' };
    const rawBody = JSON.stringify(body);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-aiva-signature': 'sha256=deadbeef',
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('issues a code and replies on "log in" with valid signature', async () => {
    const body = {
      event: 'message.received',
      from: '+6421999000',
      text: 'log in',
      pushName: 'Alice',
    };
    const { rawBody, sig } = sign(body);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-aiva-signature': sig,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.whatsapp.sent).toHaveLength(1);
    expect(h.replies.whatsapp.sent[0].externalId).toBe('+6421999000');
    const code = h.replies.whatsapp.extractCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('strips @s.whatsapp.net suffix from "from"', async () => {
    const body = {
      from: '6421999000@s.whatsapp.net',
      text: 'log in',
    };
    const { rawBody, sig } = sign(body);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-aiva-signature': sig },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.whatsapp.sent[0].externalId).toBe('6421999000');
  });

  it('ignores non-trigger messages', async () => {
    const body = { from: '+64', text: 'hello' };
    const { rawBody, sig } = sign(body);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-aiva-signature': sig },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.whatsapp.sent).toHaveLength(0);
  });
});
