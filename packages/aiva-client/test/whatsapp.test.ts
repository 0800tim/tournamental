/**
 * AivaWhatsAppClient + StubWhatsAppClient unit tests.
 *
 * As with the SMS tests, every network interaction goes through an
 * injected `fetch` mock so these tests run hermetically in CI.
 */

import { describe, expect, it } from 'vitest';
import {
  AivaWhatsAppClient,
  StubWhatsAppClient,
  aivaWhatsAppConfigFromEnv,
} from '../src/whatsapp.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function captureFetch(handler: () => Promise<Response>): {
  fetch: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    calls.push({ url, init: (init ?? {}) as RequestInit });
    return handler();
  };
  return { fetch: fetchImpl, calls };
}

describe('aivaWhatsAppConfigFromEnv', () => {
  it('returns config when api key + session id are set', () => {
    const cfg = aivaWhatsAppConfigFromEnv({
      AIVA_SMS_API_URL: 'https://sms.aiva.nz',
      AIVA_SMS_API_KEY: 'tok',
      AIVA_WA_SESSION_ID: 'sess-1',
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'tok',
      sessionId: 'sess-1',
    });
  });

  it('throws if api key missing', () => {
    expect(() =>
      aivaWhatsAppConfigFromEnv({
        AIVA_WA_SESSION_ID: 's',
      } as NodeJS.ProcessEnv),
    ).toThrow(/AIVA_SMS_API_KEY/);
  });

  it('throws if session id missing', () => {
    expect(() =>
      aivaWhatsAppConfigFromEnv({
        AIVA_SMS_API_KEY: 'tok',
      } as NodeJS.ProcessEnv),
    ).toThrow(/AIVA_WA_SESSION_ID/);
  });
});

describe('AivaWhatsAppClient.send', () => {
  it('POSTs to the WA endpoint with bearer + normalised phone', async () => {
    const captured = captureFetch(async () => jsonResponse(200, { id: 'wa-1' }));
    const client = new AivaWhatsAppClient({
      baseUrl: 'https://sms.aiva.nz/',
      apiKey: 'tok',
      sessionId: 'sess-1',
      fetchImpl: captured.fetch,
    });

    const r = await client.send({ to: '+64 21 999-000', body: 'kia ora' });

    expect(r.ok).toBe(true);
    expect(r.raw).toEqual({ id: 'wa-1' });
    const call = captured.calls[0]!;
    expect(call.url).toBe(
      'https://sms.aiva.nz/api/v1/whatsapp/sessions/sess-1/send',
    );
    expect(JSON.parse(call.init.body as string)).toEqual({
      phone: '6421999000',
      message: 'kia ora',
    });
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('returns ok:false with http-<status> on non-2xx', async () => {
    const captured = captureFetch(async () =>
      jsonResponse(401, { error: 'unauth' }),
    );
    const client = new AivaWhatsAppClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'tok',
      sessionId: 's',
      fetchImpl: captured.fetch,
    });
    const r = await client.send({ to: '+1', body: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('http-401');
    expect(r.errorMessage).toMatch(/aiva whatsapp gateway returned 401/);
  });

  it('returns ok:false errorCode:network on fetch throw', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('econn');
    };
    const client = new AivaWhatsAppClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'tok',
      sessionId: 's',
      fetchImpl,
    });
    const r = await client.send({ to: '+1', body: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('network');
  });
});

describe('AivaWhatsAppClient.pairingQr', () => {
  it('returns the qrCode field from the gateway when not yet connected', async () => {
    const captured = captureFetch(async () =>
      jsonResponse(200, {
        qrCode: 'data:image/png;base64,AAA',
        status: 'pairing',
      }),
    );
    const client = new AivaWhatsAppClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'tok',
      sessionId: 's',
      fetchImpl: captured.fetch,
    });
    const qr = await client.pairingQr();
    expect(qr).toBe('data:image/png;base64,AAA');
    expect(captured.calls[0]!.url).toBe(
      'https://sms.aiva.nz/api/v1/whatsapp/sessions/s/qr',
    );
  });

  it('returns null when the session reports connected', async () => {
    const captured = captureFetch(async () =>
      jsonResponse(200, { qrCode: 'X', status: 'connected' }),
    );
    const client = new AivaWhatsAppClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'tok',
      sessionId: 's',
      fetchImpl: captured.fetch,
    });
    const qr = await client.pairingQr();
    expect(qr).toBeNull();
  });

  it('returns null when the gateway errors', async () => {
    const captured = captureFetch(async () => jsonResponse(500, {}));
    const client = new AivaWhatsAppClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'tok',
      sessionId: 's',
      fetchImpl: captured.fetch,
    });
    const qr = await client.pairingQr();
    expect(qr).toBeNull();
  });
});

describe('StubWhatsAppClient', () => {
  it('logs and returns ok:true with stub raw payload', async () => {
    const messages: string[] = [];
    const stub = new StubWhatsAppClient((m) => messages.push(m));
    const r = await stub.send({ to: '+6421', body: 'hi' });
    expect(r.ok).toBe(true);
    expect(r.raw).toEqual({ stub: true });
    expect(messages[0]).toMatch(/\[stub-wa\] would-send to=\+6421/);
  });

  it('pairingQr returns null', async () => {
    const stub = new StubWhatsAppClient(() => {});
    expect(await stub.pairingQr()).toBeNull();
  });

  it('shutdown is a noop', async () => {
    const stub = new StubWhatsAppClient(() => {});
    await expect(stub.shutdown()).resolves.toBeUndefined();
  });
});
