/**
 * AivaSmsClient + StubSmsClient unit tests.
 *
 * We never hit the real network — every test injects a mock `fetch` and
 * asserts on the URL, headers, and body the client produces.
 */

import { describe, expect, it } from 'vitest';
import {
  AivaSmsClient,
  StubSmsClient,
  aivaSmsConfigFromEnv,
} from '../src/sms.js';

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

describe('aivaSmsConfigFromEnv', () => {
  it('returns config when api key + device id are set', () => {
    const cfg = aivaSmsConfigFromEnv({
      AIVA_SMS_API_URL: 'https://sms.aiva.nz',
      AIVA_SMS_API_KEY: 'tok-xyz',
      AIVA_SMS_DEVICE_ID: 'device-1',
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'tok-xyz',
      deviceId: 'device-1',
    });
  });

  it('accepts legacy AIVA_SMS_URL', () => {
    const cfg = aivaSmsConfigFromEnv({
      AIVA_SMS_URL: 'https://legacy.aiva.nz',
      AIVA_SMS_API_KEY: 'tok',
      AIVA_SMS_DEVICE_ID: 'd',
    } as NodeJS.ProcessEnv);
    expect(cfg.baseUrl).toBe('https://legacy.aiva.nz');
  });

  it('defaults base URL when no env override', () => {
    const cfg = aivaSmsConfigFromEnv({
      AIVA_SMS_API_KEY: 'tok',
      AIVA_SMS_DEVICE_ID: 'd',
    } as NodeJS.ProcessEnv);
    expect(cfg.baseUrl).toBe('http://localhost:9252');
  });

  it('throws when api key is missing', () => {
    expect(() =>
      aivaSmsConfigFromEnv({ AIVA_SMS_DEVICE_ID: 'd' } as NodeJS.ProcessEnv),
    ).toThrow(/AIVA_SMS_API_KEY/);
  });

  it('throws when device id is missing', () => {
    expect(() =>
      aivaSmsConfigFromEnv({ AIVA_SMS_API_KEY: 'tok' } as NodeJS.ProcessEnv),
    ).toThrow(/AIVA_SMS_DEVICE_ID/);
  });
});

describe('AivaSmsClient.send', () => {
  it('POSTs to the gateway with x-api-key and recipient + message body', async () => {
    const captured = captureFetch(async () =>
      jsonResponse(200, { id: 'msg-1' }),
    );
    const client = new AivaSmsClient({
      baseUrl: 'https://sms.aiva.nz/',
      apiKey: 'tok-abc',
      deviceId: 'dev-uuid',
      fetchImpl: captured.fetch,
    });

    const result = await client.send({ to: '+6421999000', body: 'hello' });

    expect(result.ok).toBe(true);
    expect(result.raw).toEqual({ id: 'msg-1' });
    expect(captured.calls).toHaveLength(1);
    const call = captured.calls[0]!;
    expect(call.url).toBe(
      'https://sms.aiva.nz/api/v1/gateway/devices/dev-uuid/send-sms',
    );
    expect(call.init.method).toBe('POST');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('tok-abc');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call.init.body as string)).toEqual({
      message: 'hello',
      recipients: ['+6421999000'],
    });
  });

  it('prepends + to recipient when missing', async () => {
    const captured = captureFetch(async () => jsonResponse(200, {}));
    const client = new AivaSmsClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'k',
      deviceId: 'd',
      fetchImpl: captured.fetch,
    });
    await client.send({ to: '6421999000', body: 'hi' });
    const body = JSON.parse(captured.calls[0]!.init.body as string);
    expect(body.recipients).toEqual(['+6421999000']);
  });

  it('returns ok:false with http-<status> on non-2xx responses', async () => {
    const captured = captureFetch(async () =>
      jsonResponse(500, { error: 'boom' }),
    );
    const client = new AivaSmsClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'k',
      deviceId: 'd',
      fetchImpl: captured.fetch,
    });
    const r = await client.send({ to: '+6421', body: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('http-500');
    expect(r.errorMessage).toMatch(/aiva sms gateway returned 500/);
    expect(r.raw).toEqual({ error: 'boom' });
  });

  it('returns ok:false with errorCode:network on fetch throw', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('connection refused');
    };
    const client = new AivaSmsClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'k',
      deviceId: 'd',
      fetchImpl,
    });
    const r = await client.send({ to: '+6421', body: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('network');
    expect(r.errorMessage).toMatch(/connection refused/);
  });

  it('strips trailing slash from baseUrl', async () => {
    const captured = captureFetch(async () => jsonResponse(200, {}));
    const client = new AivaSmsClient({
      baseUrl: 'https://sms.aiva.nz/',
      apiKey: 'k',
      deviceId: 'd',
      fetchImpl: captured.fetch,
    });
    await client.send({ to: '+1', body: 'x' });
    expect(captured.calls[0]!.url).toBe(
      'https://sms.aiva.nz/api/v1/gateway/devices/d/send-sms',
    );
  });
});

describe('StubSmsClient', () => {
  it('logs and returns ok:true with stub raw payload', async () => {
    const messages: string[] = [];
    const stub = new StubSmsClient((m) => messages.push(m));
    const r = await stub.send({ to: '+6421', body: 'hi there' });
    expect(r.ok).toBe(true);
    expect(r.raw).toEqual({ stub: true });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/\[stub-sms\] would-send to=\+6421/);
  });
});
