/**
 * RealGhlClient — header shape, body shape, retry/backoff, and
 * failure-log behaviour. No real network calls: every test injects a
 * fake `fetch` so we can assert exactly what would have been sent.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RealGhlClient,
  type GhlFailedCallRecord,
} from '../src/lib/ghl-client.js';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeFetch(
  responses: Array<Response | Error>,
): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fn: typeof fetch = async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push({ url, init: init ?? {} });
    const r = responses[idx++];
    if (!r) throw new Error(`no response queued for call #${calls.length}`);
    if (r instanceof Error) throw r;
    return r;
  };
  return { fn: fn as typeof fetch, calls };
}

let tmpDir: string;
let failedLogPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'crm-real-'));
  failedLogPath = join(tmpDir, 'ghl-failed.jsonl');
});

describe('RealGhlClient construction', () => {
  it('throws without apiKey', () => {
    expect(
      () =>
        new RealGhlClient({
          apiKey: '',
          locationId: 'loc_1',
          failedLogPath: null,
        }),
    ).toThrow(/apiKey/);
  });

  it('throws without locationId', () => {
    expect(
      () =>
        new RealGhlClient({
          apiKey: 'sk_test',
          locationId: '',
          failedLogPath: null,
        }),
    ).toThrow(/locationId/);
  });
});

describe('RealGhlClient.upsertContact', () => {
  it('sends a POST to /contacts/upsert with the GHL v2 headers and body', async () => {
    const { fn, calls } = makeFetch([
      jsonResponse(200, { contact: { id: 'gh_42' } }),
    ]);
    const client = new RealGhlClient({
      apiKey: 'sk_test',
      locationId: 'loc_1',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    const result = await client.upsertContact({
      userId: 'u_1',
      email: 'jane@example.com',
      phone: '+64211234567',
      country: 'NZ',
      source: 'telegram',
      eventId: 'evt_1',
      customFields: { vtourn_user_id: 'u_1', total_predictions: 0 },
      addTags: ['tournament:wc2026', 'made_pick'],
    });

    expect(result.ok).toBe(true);
    expect(result.contactId).toBe('gh_42');
    expect(result.externalId).toBe('gh_42');

    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url).toBe('https://services.leadconnectorhq.com/contacts/upsert');
    expect(c.init.method).toBe('POST');
    const headers = c.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test');
    expect(headers.Version).toBe('2021-07-28');
    expect(headers.LocationId).toBe('loc_1');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(c.init.body as string);
    expect(body).toMatchObject({
      locationId: 'loc_1',
      email: 'jane@example.com',
      phone: '+64211234567',
      country: 'NZ',
      source: 'telegram',
      tags: ['tournament:wc2026', 'made_pick'],
    });
    // Custom fields are serialised as { key, field_value } per GHL v2.
    expect(body.customFields).toEqual(
      expect.arrayContaining([
        { key: 'vtourn_user_id', field_value: 'u_1' },
        { key: 'total_predictions', field_value: 0 },
        { key: 'vtourn_last_event_id', field_value: 'evt_1' },
      ]),
    );
  });

  it('issues a follow-up DELETE when removeTags is non-empty', async () => {
    const { fn, calls } = makeFetch([
      jsonResponse(200, { contact: { id: 'gh_77' } }),
      jsonResponse(200, { ok: true }),
    ]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    await client.upsertContact({
      userId: 'u_x',
      email: 'a@b.c',
      removeTags: ['churned'],
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].init.method).toBe('DELETE');
    expect(calls[1].url).toBe(
      'https://services.leadconnectorhq.com/contacts/gh_77/tags',
    );
    expect(JSON.parse(calls[1].init.body as string)).toEqual({
      tags: ['churned'],
    });
  });
});

describe('RealGhlClient retry + backoff', () => {
  it('retries on 429 with exponential backoff (1s, 2s, 4s) up to 3 attempts', async () => {
    const { fn, calls } = makeFetch([
      jsonResponse(429, { error: 'rate_limited' }),
      jsonResponse(429, { error: 'rate_limited' }),
      jsonResponse(429, { error: 'rate_limited' }),
      jsonResponse(200, { contact: { id: 'gh_ok' } }),
    ]);
    const sleeps: number[] = [];
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const result = await client.upsertContact({
      userId: 'u_retry',
      email: 'r@x.y',
    });

    expect(result.ok).toBe(true);
    expect(result.contactId).toBe('gh_ok');
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('retries on 500-class status codes', async () => {
    const { fn, calls } = makeFetch([
      jsonResponse(503, { error: 'unavailable' }),
      jsonResponse(200, { contact: { id: 'gh_5xx_ok' } }),
    ]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    const result = await client.upsertContact({ userId: 'u', email: 'a@b.c' });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('does not retry on 4xx other than 429', async () => {
    const { fn, calls } = makeFetch([
      jsonResponse(400, { error: 'bad_request' }),
    ]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath,
      fetchImpl: fn,
      sleep: async () => {},
      now: () => 1_700_000_000,
    });
    const result = await client.upsertContact({
      userId: 'u_bad',
      email: 'bad@x.y',
    });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);

    // Failed-log records the call.
    expect(existsSync(failedLogPath)).toBe(true);
    const lines = readFileSync(failedLogPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]) as GhlFailedCallRecord;
    expect(rec.op).toBe('upsert_contact');
    expect(rec.error.status).toBe(400);
  });

  it('appends a failed-log record when retries are exhausted', async () => {
    const { fn } = makeFetch([
      jsonResponse(500, { error: 'boom' }),
      jsonResponse(500, { error: 'boom' }),
      jsonResponse(500, { error: 'boom' }),
      jsonResponse(500, { error: 'boom' }),
    ]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath,
      fetchImpl: fn,
      sleep: async () => {},
      now: () => 1_700_000_000,
    });
    const result = await client.upsertContact({
      userId: 'u_exhaust',
      email: 'e@x.y',
    });
    expect(result.ok).toBe(false);
    const rec = JSON.parse(
      readFileSync(failedLogPath, 'utf8').trim(),
    ) as GhlFailedCallRecord;
    expect(rec.op).toBe('upsert_contact');
    expect(rec.userId).toBe('u_exhaust');
    expect(rec.error.status).toBe(500);
    expect(rec.payload).toMatchObject({
      method: 'POST',
      path: '/contacts/upsert',
    });
  });

  it('treats network errors as retryable and logs after exhaustion', async () => {
    const err = new Error('econnreset');
    const { fn } = makeFetch([err, err, err, err]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath,
      fetchImpl: fn,
      sleep: async () => {},
      now: () => 1_700_000_000,
    });
    const result = await client.upsertContact({
      userId: 'u_neterr',
      email: 'n@x.y',
    });
    expect(result.ok).toBe(false);
    const rec = JSON.parse(
      readFileSync(failedLogPath, 'utf8').trim(),
    ) as GhlFailedCallRecord;
    expect(rec.error.message).toBe('econnreset');
  });
});

describe('RealGhlClient tag + custom-field methods', () => {
  it('addTag posts the right body', async () => {
    const { fn, calls } = makeFetch([jsonResponse(200, { ok: true })]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    const r = await client.addTag('gh_1', ['evangelist']);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe(
      'https://services.leadconnectorhq.com/contacts/gh_1/tags',
    );
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      tags: ['evangelist'],
    });
  });

  it('removeTag deletes', async () => {
    const { fn, calls } = makeFetch([jsonResponse(200, { ok: true })]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    await client.removeTag('gh_1', ['churned']);
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('setCustomField PUTs to /contacts/{id}', async () => {
    const { fn, calls } = makeFetch([jsonResponse(200, { ok: true })]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    await client.setCustomField('gh_1', { current_rank: 5 });
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].url).toBe(
      'https://services.leadconnectorhq.com/contacts/gh_1',
    );
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      customFields: [{ key: 'current_rank', field_value: 5 }],
    });
  });

  it('getContact returns null on 404 without retry', async () => {
    const { fn, calls } = makeFetch([
      jsonResponse(404, { error: 'not_found' }),
    ]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    const view = await client.getContact('gh_missing');
    expect(view).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe('GET');
  });

  it('getContact parses custom-field array into a flat record', async () => {
    const { fn } = makeFetch([
      jsonResponse(200, {
        contact: {
          id: 'gh_1',
          email: 'a@b.c',
          tags: ['tournament:wc2026'],
          customFields: [
            { key: 'vtourn_user_id', field_value: 'u_1' },
            { key: 'total_predictions', field_value: 3 },
          ],
        },
      }),
    ]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    const view = await client.getContact('gh_1');
    expect(view).not.toBeNull();
    expect(view!.id).toBe('gh_1');
    expect(view!.email).toBe('a@b.c');
    expect(view!.tags).toContain('tournament:wc2026');
    expect(view!.customFields).toMatchObject({
      vtourn_user_id: 'u_1',
      total_predictions: 3,
    });
  });
});

describe('RealGhlClient.replayFailed', () => {
  it('re-attempts an entry and reports success', async () => {
    const { fn, calls } = makeFetch([jsonResponse(200, { ok: true })]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    const rec: GhlFailedCallRecord = {
      ts: 1,
      op: 'add_tags',
      contactId: 'gh_1',
      payload: {
        method: 'POST',
        path: '/contacts/gh_1/tags',
        body: { tags: ['retry'] },
      },
      error: { message: 'http_500' },
    };
    const r = await client.replayFailed(rec);
    expect(r.ok).toBe(true);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      tags: ['retry'],
    });
  });

  it('returns ok=false on a malformed record', async () => {
    const { fn } = makeFetch([]);
    const client = new RealGhlClient({
      apiKey: 'k',
      locationId: 'loc',
      failedLogPath: null,
      fetchImpl: fn,
      sleep: async () => {},
    });
    const r = await client.replayFailed({
      ts: 1,
      op: 'add_tags',
      payload: {},
      error: { message: 'x' },
    });
    expect(r.ok).toBe(false);
  });
});
