/**
 * Discord adapter behaviour tests.
 *
 * Covers: multipart-form construction, multi-webhook fan-out, rate-limit
 * header absorption + sleep, 429 retry-after, 5xx retry, partial-failure
 * vs total-failure handling, caption truncation, redacted error logging,
 * and stub fallback when config is empty.
 *
 * No real HTTP is performed — the DiscordWebhookClient gets a mocked fetch
 * and a mocked readFile so the test never touches the network or the disk.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  bucketKeyForUrl,
  buildMultipart,
  createDiscordAdapter,
  DiscordWebhookClient,
  loadWebhookConfig,
  truncateCaption,
  type DiscordSendRequest,
  type DiscordSendResult,
  type DiscordWebhookSender,
  webhooksFor,
} from '../src/lib/adapters/discord.js';
import { redactWebhookUrl } from '../src/lib/adapters/shared.js';
import { makeClip } from './fixtures.js';

class StubDiscordSender implements DiscordWebhookSender {
  public readonly calls: DiscordSendRequest[] = [];
  constructor(
    private readonly responder: (req: DiscordSendRequest, idx: number) => DiscordSendResult,
  ) {}
  async send(req: DiscordSendRequest): Promise<DiscordSendResult> {
    const idx = this.calls.length;
    this.calls.push(req);
    return this.responder(req, idx);
  }
}

const okResponder =
  () =>
  (_req: DiscordSendRequest, idx: number): DiscordSendResult => ({
    ok: true,
    messageId: `1234${idx}`,
    url: `https://discord.com/channels/@me/9999/1234${idx}`,
  });

describe('truncateCaption (discord)', () => {
  it('returns input unchanged when within the 2000-char cap', () => {
    expect(truncateCaption('hello')).toBe('hello');
  });
  it('truncates with U+2026 over 2000 chars', () => {
    const long = 'a'.repeat(3000);
    const out = truncateCaption(long);
    expect(out.length).toBe(2000);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('bucketKeyForUrl', () => {
  it('extracts the webhook id segment', () => {
    expect(
      bucketKeyForUrl(
        'https://discord.com/api/webhooks/123456789012345678/abc-token',
      ),
    ).toBe('123456789012345678');
  });
  it('falls back to the full URL when shape is unfamiliar', () => {
    expect(bucketKeyForUrl('https://nope.example.com/x')).toBe(
      'https://nope.example.com/x',
    );
  });
});

describe('redactWebhookUrl', () => {
  it('returns webhook:<id> from a real-shape URL', () => {
    expect(
      redactWebhookUrl(
        'https://discord.com/api/webhooks/123456789012345678/SECRET-TOKEN-DO-NOT-LOG',
      ),
    ).toBe('webhook:123456789012345678');
  });
  it('returns webhook:unknown for malformed input', () => {
    expect(redactWebhookUrl('https://example.com/foo')).toBe('webhook:unknown');
  });
});

describe('buildMultipart', () => {
  it('builds a payload_json + files[0] body with the expected boundary', () => {
    const fileBytes = new TextEncoder().encode('FAKEMP4');
    const out = buildMultipart(fileBytes, 'clip.mp4', 'video/mp4', 'A goal.');
    const ct = out.headers['Content-Type']!;
    expect(ct.startsWith('multipart/form-data; boundary=')).toBe(true);
    const text = new TextDecoder().decode(out.body);
    expect(text).toContain('Content-Disposition: form-data; name="payload_json"');
    expect(text).toContain('"content":"A goal."');
    expect(text).toContain('"allowed_mentions":{"parse":[]}');
    expect(text).toContain(
      'Content-Disposition: form-data; name="files[0]"; filename="clip.mp4"',
    );
    expect(text).toContain('Content-Type: video/mp4');
    expect(text).toContain('FAKEMP4');
    expect(out.headers['Content-Length']).toBe(String(out.body.byteLength));
  });
});

describe('webhooksFor / loadWebhookConfig', () => {
  it('prefers the tournament list, falls back to default', () => {
    const cfg = {
      enabled: true,
      tournaments: { foo: { webhooks: ['https://x/foo'] } },
      default: { webhooks: ['https://x/default'] },
    };
    expect(webhooksFor(cfg, 'foo')).toEqual(['https://x/foo']);
    expect(webhooksFor(cfg, 'bar')).toEqual(['https://x/default']);
  });
  it('returns [] when disabled', () => {
    const cfg = {
      enabled: false,
      tournaments: { foo: { webhooks: ['https://x/foo'] } },
      default: { webhooks: ['https://x/default'] },
    };
    expect(webhooksFor(cfg, 'foo')).toEqual([]);
  });
  it('loads bundled config without throwing', () => {
    const cfg = loadWebhookConfig();
    expect(typeof cfg.enabled).toBe('boolean');
    expect(cfg.default).toBeDefined();
  });
});

describe('createDiscordAdapter', () => {
  it('falls back to deterministic stub when disabled', async () => {
    const adapter = createDiscordAdapter({
      client: () => new StubDiscordSender(okResponder()),
      webhooks: () => ['https://x/y'],
      enabled: () => false,
    });
    const a = await adapter.publish(makeClip(), {});
    const b = await adapter.publish(makeClip(), {});
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).toMatch(/^[a-f0-9]{12}$/);
    expect(a.url.startsWith('https://')).toBe(true);
  });

  it('falls back to stub when no webhooks configured for the tournament', async () => {
    const stub = new StubDiscordSender(okResponder());
    const adapter = createDiscordAdapter({
      client: () => stub,
      webhooks: () => [],
      enabled: () => true,
    });
    const result = await adapter.publish(makeClip(), {});
    expect(stub.calls).toHaveLength(0);
    expect(result.externalId).toMatch(/^[a-f0-9]{12}$/);
  });

  it('fans out to every configured webhook with the v16x9 file', async () => {
    const stub = new StubDiscordSender(okResponder());
    const adapter = createDiscordAdapter({
      client: () => stub,
      webhooks: () => [
        'https://discord.com/api/webhooks/111/aaa',
        'https://discord.com/api/webhooks/222/bbb',
      ],
      enabled: () => true,
    });
    const result = await adapter.publish(makeClip(), {});
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]?.filePath).toBe('/clips/clip_test_001_16x9.mp4');
    expect(stub.calls[0]?.mimeType).toBe('video/mp4');
    expect(stub.calls[0]?.caption).toBe('Goal! Test caption in English.');
    expect(stub.calls[0]?.filename).toBe('clip_test_001.mp4');
    expect(result.externalId).toMatch(/^[a-f0-9]{12}$/);
    expect(result.url).toBe('https://discord.com/channels/@me/9999/12340');
  });

  it('uses the single message id when only one webhook is configured', async () => {
    const stub = new StubDiscordSender(okResponder());
    const adapter = createDiscordAdapter({
      client: () => stub,
      webhooks: () => ['https://discord.com/api/webhooks/111/aaa'],
      enabled: () => true,
    });
    const result = await adapter.publish(makeClip(), {});
    expect(result.externalId).toBe('12340');
  });

  it('survives partial webhook failure but throws when every webhook fails', async () => {
    const stub = new StubDiscordSender((_req, idx) =>
      idx === 0
        ? { ok: true, messageId: 'OK1' }
        : { ok: false, errorCode: 'http-500', errorMessage: 'boom' },
    );
    const adapter = createDiscordAdapter({
      client: () => stub,
      webhooks: () => [
        'https://discord.com/api/webhooks/111/aaa',
        'https://discord.com/api/webhooks/222/bbb',
      ],
      enabled: () => true,
    });
    const result = await adapter.publish(makeClip(), {});
    // Partial success — externalId is OK1 (single id, no aggregate).
    expect(result.externalId).toBe('OK1');

    const allFailed = new StubDiscordSender(() => ({
      ok: false,
      errorCode: 'http-500',
      errorMessage: 'gone',
    }));
    const adapter2 = createDiscordAdapter({
      client: () => allFailed,
      webhooks: () => ['https://discord.com/api/webhooks/111/aaa'],
      enabled: () => true,
    });
    await expect(adapter2.publish(makeClip(), {})).rejects.toThrow(
      /every webhook failed/,
    );
    // Error message must redact the URL — only `webhook:111` should appear.
    await expect(adapter2.publish(makeClip(), {})).rejects.toThrow(
      /webhook:111/,
    );
  });

  it('pullMetrics returns zeros (Discord webhooks expose none)', async () => {
    const adapter = createDiscordAdapter({
      client: () => new StubDiscordSender(okResponder()),
      webhooks: () => ['https://x/y'],
      enabled: () => true,
    });
    const m = await adapter.pullMetrics({
      ts: 0,
      platform: 'discord',
      externalId: 'x',
      url: '',
      clipId: 'c',
      eventType: 'goal',
      status: 'published',
      tournamentId: 't',
      matchId: 'm',
    });
    expect(m).toEqual({ views: 0, likes: 0, comments: 0, shares: 0 });
  });
});

describe('DiscordWebhookClient (HTTP layer)', () => {
  it('POSTs multipart with payload_json + files[0] and parses the response id', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: '987', channel_id: '777' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '4',
          'X-RateLimit-Reset-After': '1.5',
        },
      }),
    );
    const readFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const client = new DiscordWebhookClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile,
      sleep: async () => undefined,
    });
    const result = await client.send({
      webhookUrl: 'https://discord.com/api/webhooks/111/secret',
      caption: 'a goal',
      filePath: '/clips/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('987');
    expect(result.url).toBe('https://discord.com/channels/@me/777/987');
    expect(readFile).toHaveBeenCalledWith('/clips/x.mp4');

    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const init = call[1] as RequestInit;
    expect(String(url)).toBe(
      'https://discord.com/api/webhooks/111/secret?wait=true',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toMatch(
      /^multipart\/form-data; boundary=----vtorn-/,
    );
    const bodyText = new TextDecoder().decode(init.body as Uint8Array);
    expect(bodyText).toContain('"content":"a goal"');
    expect(bodyText).toContain('files[0]');
  });

  it('sleeps when X-RateLimit-Remaining hits 0', async () => {
    const sleep = vi.fn(async () => undefined);
    let now = 1_000_000;
    const calls: Response[] = [
      new Response(JSON.stringify({ id: 'A' }), {
        status: 200,
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '2' },
      }),
      new Response(JSON.stringify({ id: 'B' }), {
        status: 200,
        headers: { 'X-RateLimit-Remaining': '5', 'X-RateLimit-Reset-After': '5' },
      }),
    ];
    const fetchMock = vi.fn(async () => calls.shift()!);
    const client = new DiscordWebhookClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile: async () => new Uint8Array([0]),
      sleep,
      now: () => now,
    });
    await client.send({
      webhookUrl: 'https://discord.com/api/webhooks/111/aaa',
      caption: 'one',
      filePath: '/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    // After the first call we recorded remaining=0, resetAt = now + 2000ms.
    // Don't advance the clock; second call's waitForBucket should sleep ~2000ms.
    await client.send({
      webhookUrl: 'https://discord.com/api/webhooks/111/bbb',
      caption: 'two',
      filePath: '/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries once on 429 honouring retry_after, then succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    const calls: Response[] = [
      new Response(JSON.stringify({ retry_after: 0.05 }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify({ id: 'OK' }), { status: 200 }),
    ];
    const fetchMock = vi.fn(async () => calls.shift()!);
    const client = new DiscordWebhookClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile: async () => new Uint8Array([0]),
      sleep,
    });
    const result = await client.send({
      webhookUrl: 'https://discord.com/api/webhooks/111/aaa',
      caption: 'x',
      filePath: '/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('OK');
    expect(sleep).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on 5xx, returning the error if both attempts fail', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 503 }));
    const client = new DiscordWebhookClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile: async () => new Uint8Array([0]),
      sleep: async () => undefined,
    });
    const result = await client.send({
      webhookUrl: 'https://discord.com/api/webhooks/111/aaa',
      caption: 'x',
      filePath: '/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('http-503');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a non-retryable error on a 4xx (other than 429)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('bad webhook', { status: 401 }),
    );
    const client = new DiscordWebhookClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile: async () => new Uint8Array([0]),
      sleep: async () => undefined,
    });
    const result = await client.send({
      webhookUrl: 'https://discord.com/api/webhooks/111/aaa',
      caption: 'x',
      filePath: '/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('http-401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a network error when fetch throws', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = new DiscordWebhookClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile: async () => new Uint8Array([0]),
      sleep: async () => undefined,
    });
    const result = await client.send({
      webhookUrl: 'https://discord.com/api/webhooks/111/aaa',
      caption: 'x',
      filePath: '/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('network');
    expect(result.errorMessage).toContain('ECONNREFUSED');
  });

  it('returns a file-read error when the clip file is missing', async () => {
    const client = new DiscordWebhookClient({
      fetchImpl: (async () => new Response('', { status: 200 })) as unknown as typeof fetch,
      readFile: async () => {
        throw new Error('ENOENT');
      },
      sleep: async () => undefined,
    });
    const result = await client.send({
      webhookUrl: 'https://discord.com/api/webhooks/111/aaa',
      caption: 'x',
      filePath: '/missing.mp4',
      filename: 'missing.mp4',
      mimeType: 'video/mp4',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('file-read');
  });
});
