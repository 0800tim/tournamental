/**
 * Telegram adapter behaviour tests.
 *
 * Covers: per-tournament chat fan-out, caption + hashtag join + truncation,
 * direct Bot API multipart shape, push-proxy JSON shape, retry on 429
 * honouring `parameters.retry_after`, partial vs total failure, and stub
 * fallback when env / config is missing.
 *
 * Mocks fetch — never posts to Telegram.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildCaption,
  buildSendVideoMultipart,
  chatsFor,
  createTelegramAdapter,
  loadTargetsConfig,
  TelegramBotApiClient,
  TournamentBotPushClient,
  truncateCaption,
  type TelegramSender,
  type TelegramSendRequest,
  type TelegramSendResult,
} from '../src/lib/adapters/telegram.js';
import { makeClip } from './fixtures.js';

class StubSender implements TelegramSender {
  public readonly calls: TelegramSendRequest[] = [];
  constructor(
    private readonly responder: (req: TelegramSendRequest, idx: number) => TelegramSendResult,
  ) {}
  async send(req: TelegramSendRequest): Promise<TelegramSendResult> {
    const idx = this.calls.length;
    this.calls.push(req);
    return this.responder(req, idx);
  }
}

const okResponder =
  () =>
  (req: TelegramSendRequest, idx: number): TelegramSendResult => ({
    ok: true,
    messageId: `${idx + 100}`,
    url: `https://t.me/${String(req.chatId).replace(/^@/, '')}/${idx + 100}`,
  });

describe('truncateCaption (telegram)', () => {
  it('caps at 1024 chars with U+2026', () => {
    const long = 'b'.repeat(2000);
    const out = truncateCaption(long);
    expect(out.length).toBe(1024);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildCaption', () => {
  it('joins caption + hashtags with a blank line', () => {
    const out = buildCaption(
      makeClip({
        captions: { en: 'Goal in extra time.' },
        hashtags: ['#WC2022', '#ARG'],
      }),
      'en',
    );
    expect(out).toBe('Goal in extra time.\n\n#WC2022 #ARG');
  });
  it('truncates the joined caption + hashtags at 1024 chars', () => {
    const long = 'x'.repeat(1100);
    const out = buildCaption(makeClip({ captions: { en: long } }), 'en');
    expect(out.length).toBe(1024);
    expect(out.endsWith('…')).toBe(true);
  });
  it('uses requested locale when present', () => {
    const out = buildCaption(makeClip(), 'es');
    expect(out.startsWith('Gol! Caption en español.')).toBe(true);
  });
});

describe('chatsFor / loadTargetsConfig', () => {
  it('prefers tournament list over default', () => {
    const cfg = {
      enabled: true,
      tournaments: { foo: { chats: ['@foo'] } },
      default: { chats: ['@default'] },
    };
    expect(chatsFor(cfg, 'foo')).toEqual(['@foo']);
    expect(chatsFor(cfg, 'bar')).toEqual(['@default']);
  });
  it('returns [] when disabled', () => {
    expect(
      chatsFor(
        { enabled: false, tournaments: { foo: { chats: ['@foo'] } }, default: { chats: [] } },
        'foo',
      ),
    ).toEqual([]);
  });
  it('loads bundled config without throwing', () => {
    const cfg = loadTargetsConfig();
    expect(typeof cfg.enabled).toBe('boolean');
  });
});

describe('createTelegramAdapter', () => {
  it('falls back to deterministic stub when disabled', async () => {
    const adapter = createTelegramAdapter({
      client: () => new StubSender(okResponder()),
      chats: () => ['@vtorn'],
      enabled: () => false,
    });
    const a = await adapter.publish(makeClip(), {});
    const b = await adapter.publish(makeClip(), {});
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).toMatch(/^[a-f0-9]{12}$/);
    expect(a.url.startsWith('https://t.me/')).toBe(true);
  });

  it('fans out to every chat with the v16x9 file', async () => {
    const stub = new StubSender(okResponder());
    const adapter = createTelegramAdapter({
      client: () => stub,
      chats: () => ['@vtorn', -1001234567890],
      enabled: () => true,
    });
    const result = await adapter.publish(makeClip(), {});
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]?.chatId).toBe('@vtorn');
    expect(stub.calls[1]?.chatId).toBe(-1001234567890);
    expect(stub.calls[0]?.filePath).toBe('/clips/clip_test_001_16x9.mp4');
    expect(stub.calls[0]?.caption).toContain('Goal! Test caption in English.');
    expect(stub.calls[0]?.caption).toContain('#Test #WorldCup2026');
    expect(result.externalId).toMatch(/^[a-f0-9]{12}$/);
    expect(result.url).toBe('https://t.me/vtorn/100');
  });

  it('survives partial chat failure but throws when every chat fails', async () => {
    const stub = new StubSender((_req, idx) =>
      idx === 0
        ? { ok: true, messageId: '111' }
        : { ok: false, errorCode: 'http-403', errorMessage: 'bot kicked' },
    );
    const adapter = createTelegramAdapter({
      client: () => stub,
      chats: () => ['@first', '@second'],
      enabled: () => true,
    });
    const r = await adapter.publish(makeClip(), {});
    // Single success → externalId is the chat-prefixed id, not a hash.
    expect(r.externalId).toBe('@first:111');

    const allFail = new StubSender(() => ({
      ok: false,
      errorCode: 'http-403',
      errorMessage: 'bot kicked',
    }));
    const adapter2 = createTelegramAdapter({
      client: () => allFail,
      chats: () => [-1001111111111],
      enabled: () => true,
    });
    await expect(adapter2.publish(makeClip(), {})).rejects.toThrow(/every chat failed/);
    // Numeric chat id should be redacted in the error message.
    await expect(adapter2.publish(makeClip(), {})).rejects.toThrow(/chat:redacted/);
  });

  it('aggregates message ids across multiple chats', async () => {
    const stub = new StubSender(okResponder());
    const adapter = createTelegramAdapter({
      client: () => stub,
      chats: () => ['@a', '@b', '@c'],
      enabled: () => true,
    });
    const r = await adapter.publish(makeClip(), {});
    expect(r.externalId).toMatch(/^[a-f0-9]{12}$/);
  });

  it('pullMetrics returns zeros (no Bot API view counts)', async () => {
    const adapter = createTelegramAdapter({
      client: () => new StubSender(okResponder()),
      chats: () => ['@x'],
      enabled: () => true,
    });
    const m = await adapter.pullMetrics({
      ts: 0,
      platform: 'telegram',
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

describe('buildSendVideoMultipart', () => {
  it('builds chat_id + caption + video parts', () => {
    const out = buildSendVideoMultipart(
      '@vtorn',
      'Cap',
      new TextEncoder().encode('VID'),
      'clip.mp4',
      'video/mp4',
    );
    const text = new TextDecoder().decode(out.body);
    expect(text).toContain('name="chat_id"');
    expect(text).toContain('@vtorn');
    expect(text).toContain('name="caption"');
    expect(text).toContain('Cap');
    expect(text).toContain('name="video"; filename="clip.mp4"');
    expect(text).toContain('VID');
  });
});

describe('TelegramBotApiClient', () => {
  it('POSTs to /bot{token}/sendVideo and parses message_id', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 42, chat: { username: 'vtorn' } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new TelegramBotApiClient({
      botToken: 'TOKEN-X',
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile: async () => new Uint8Array([1]),
      sleep: async () => undefined,
    });
    const r = await client.send({
      chatId: '@vtorn',
      caption: 'cap',
      filePath: '/clips/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('42');
    expect(r.url).toBe('https://t.me/vtorn/42');
    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toBe('https://api.telegram.org/botTOKEN-X/sendVideo');
  });

  it('retries once on 429 honouring parameters.retry_after', async () => {
    const sleep = vi.fn(async () => undefined);
    const calls: Response[] = [
      new Response(
        JSON.stringify({ ok: false, parameters: { retry_after: 0.5 }, description: 'flood' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
      new Response(
        JSON.stringify({ ok: true, result: { message_id: 7 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ];
    const fetchMock = vi.fn(async () => calls.shift()!);
    const client = new TelegramBotApiClient({
      botToken: 'TOKEN-Y',
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile: async () => new Uint8Array([1]),
      sleep,
    });
    const r = await client.send({
      chatId: -1,
      caption: 'cap',
      filePath: '/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('7');
    expect(sleep).toHaveBeenCalled();
  });

  it('does not retry on a 4xx that is not 429', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: false, description: 'chat not found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new TelegramBotApiClient({
      botToken: 'T',
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile: async () => new Uint8Array([1]),
      sleep: async () => undefined,
    });
    const r = await client.send({
      chatId: '@x',
      caption: 'cap',
      filePath: '/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('http-400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a network error when fetch throws', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const client = new TelegramBotApiClient({
      botToken: 'T',
      fetchImpl: fetchMock as unknown as typeof fetch,
      readFile: async () => new Uint8Array([1]),
      sleep: async () => undefined,
    });
    const r = await client.send({
      chatId: '@x',
      caption: 'cap',
      filePath: '/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('network');
  });
});

describe('TournamentBotPushClient', () => {
  it('POSTs JSON to {baseUrl}/v1/push with the shared secret header', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ ok: true, message_id: '99', url: 'https://t.me/vtorn/99' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new TournamentBotPushClient({
      baseUrl: 'https://bot.vtourn.com/',
      secret: 'shh',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await client.send({
      chatId: '@vtorn',
      caption: 'cap',
      filePath: '/clips/x.mp4',
      filename: 'x.mp4',
      mimeType: 'video/mp4',
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('99');
    expect(r.url).toBe('https://t.me/vtorn/99');
    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const init = call[1] as RequestInit;
    expect(String(url)).toBe('https://bot.vtourn.com/v1/push');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Push-Secret']).toBe('shh');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      chat_id: '@vtorn',
      caption: 'cap',
      video_path: '/clips/x.mp4',
      mime_type: 'video/mp4',
    });
  });
});
