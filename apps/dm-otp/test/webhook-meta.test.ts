import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  makeHarness,
  META_SECRET,
  META_VERIFY_TOKEN,
  type Harness,
} from './helpers.js';
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
  return { rawBody, sig: `sha256=${hmacSha256Hex(META_SECRET, rawBody)}` };
}

function buildMessagingPayload(opts: {
  object: 'page' | 'instagram';
  senderId: string;
  text: string;
}) {
  return {
    object: opts.object,
    entry: [
      {
        id: 'page-123',
        time: 1700000000,
        messaging: [
          {
            sender: { id: opts.senderId },
            recipient: { id: 'page-123' },
            timestamp: 1700000000,
            message: { mid: 'm_1', text: opts.text },
          },
        ],
      },
    ],
  };
}

describe('GET /v1/webhooks/messenger (subscription verify)', () => {
  it('echoes hub.challenge with correct verify_token', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url:
        '/v1/webhooks/messenger?hub.mode=subscribe&hub.verify_token=' +
        encodeURIComponent(META_VERIFY_TOKEN) +
        '&hub.challenge=12345',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('12345');
  });

  it('403 with wrong verify_token', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/webhooks/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /v1/webhooks/messenger', () => {
  it('401 without signature', async () => {
    const payload = buildMessagingPayload({
      object: 'page',
      senderId: 'PSID-1',
      text: 'log in',
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/messenger',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).toBe(401);
    expect(h.replies.messenger.sent).toHaveLength(0);
  });

  it('issues code on "log in" with valid signature; routes to messenger adapter', async () => {
    const payload = buildMessagingPayload({
      object: 'page',
      senderId: 'PSID-1',
      text: 'log in',
    });
    const { rawBody, sig } = sign(payload);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/messenger',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sig,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.messenger.sent).toHaveLength(1);
    expect(h.replies.messenger.sent[0].externalId).toBe('PSID-1');
    expect(h.replies.telegram.sent).toHaveLength(0);
    expect(h.replies.whatsapp.sent).toHaveLength(0);
    expect(h.replies.instagram.sent).toHaveLength(0);
  });

  it('rejects payloads with object=instagram (would need the IG endpoint)', async () => {
    const payload = buildMessagingPayload({
      object: 'instagram',
      senderId: 'IGSID-1',
      text: 'log in',
    });
    const { rawBody, sig } = sign(payload);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/messenger',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sig,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.messenger.sent).toHaveLength(0);
  });
});

describe('POST /v1/webhooks/instagram', () => {
  it('routes to instagram adapter', async () => {
    const payload = buildMessagingPayload({
      object: 'instagram',
      senderId: 'IGSID-7',
      text: 'log in',
    });
    const { rawBody, sig } = sign(payload);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/instagram',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sig,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.instagram.sent).toHaveLength(1);
    expect(h.replies.instagram.sent[0].externalId).toBe('IGSID-7');
    expect(h.replies.messenger.sent).toHaveLength(0);
  });

  it('ignores message_echoes (is_echo)', async () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'page-123',
          time: 1700000000,
          messaging: [
            {
              sender: { id: 'IGSID-9' },
              recipient: { id: 'page-123' },
              timestamp: 1700000000,
              message: { mid: 'm_1', text: 'log in', is_echo: true },
            },
          ],
        },
      ],
    };
    const { rawBody, sig } = sign(payload);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/instagram',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sig,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(h.replies.instagram.sent).toHaveLength(0);
  });
});
