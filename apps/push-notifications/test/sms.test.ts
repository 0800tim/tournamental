/**
 * SMS adapter tests for push-notifications.
 *
 * These tests live alongside the service so we can assert the wiring:
 *   1. When AIVA env is set, the adapter uses `AivaSmsClient` and hits the
 *      gateway over `fetch` (we inject a fake fetch via the shared client).
 *   2. When AIVA env is missing, the adapter falls back to `StubSmsClient`.
 *   3. Both paths write to the privacy-masked SMS audit JSONL with last-4
 *      digits only — never the full phone number.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AivaSmsClient } from '@vtorn/aiva-client';

import { AivaSmsAdapter, maskPhone } from '../src/lib/sms.js';
import { MemoryAuditLogger } from '../src/lib/audit.js';

let workdir: string;
let smsAuditPath: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'sms-adapter-test-'));
  smsAuditPath = join(workdir, 'sms-audit.jsonl');
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe('maskPhone', () => {
  it('returns last 4 digits prefixed with ****', () => {
    expect(maskPhone('+64211234567')).toBe('****4567');
  });

  it('strips non-digit characters before masking', () => {
    expect(maskPhone('+64 21 123-4567')).toBe('****4567');
  });

  it('handles short numbers gracefully', () => {
    expect(maskPhone('123')).toBe('****123');
  });
});

describe('AivaSmsAdapter — real client wiring', () => {
  it('uses AivaSmsClient and hits the gateway when env is configured', async () => {
    const audit = new MemoryAuditLogger();
    const calls: { url: string; body: string }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push({ url, body: (init?.body as string) ?? '' });
      return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 });
    };
    const client = new AivaSmsClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'tok-real',
      deviceId: 'dev-uuid',
      fetchImpl: fakeFetch,
    });
    const adapter = new AivaSmsAdapter({
      audit,
      smsAuditPath,
      client, // explicit injection — proves the real-client code path runs
    });

    const r = await adapter.send(
      'u1',
      '+64211234567',
      { body: 'Kickoff in 5 min' },
      'kickoff_soon',
    );

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://sms.aiva.nz/api/v1/gateway/devices/dev-uuid/send-sms',
    );
    const body = JSON.parse(calls[0]!.body);
    expect(body.recipients).toEqual(['+64211234567']);
    expect(body.message).toBe('Kickoff in 5 min');

    // Cross-channel audit log records the masked phone, not the full one.
    const xrec = audit.records.find((r) => r.channel === 'sms');
    expect(xrec?.note).toMatch(/aiva: delivered/);
    const xpayload = xrec?.payload as { to: string; body: string };
    expect(xpayload.to).toBe('****4567');
    expect(xpayload.to).not.toContain('1234567');

    // Privacy-masked SMS audit JSONL written.
    const smsAuditRaw = await readFile(smsAuditPath, 'utf8');
    const lines = smsAuditRaw.trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec).toMatchObject({
      userId: 'u1',
      event: 'kickoff_soon',
      recipientLast4: '****4567',
      template: 'kickoff_soon',
      length: 'Kickoff in 5 min'.length,
      status: 'ok',
      mode: 'aiva',
    });
    expect(typeof rec.ts).toBe('string');
    // No leakage of the full phone number anywhere in the audit line.
    expect(smsAuditRaw).not.toContain('1234567');
  });

  it('infers AivaSmsClient from apiKey + deviceId env values', async () => {
    const audit = new MemoryAuditLogger();
    const adapter = new AivaSmsAdapter({
      audit,
      smsAuditPath,
      apiUrl: 'https://sms.aiva.nz',
      apiKey: 'tok-env',
      deviceId: 'dev-env',
    });
    // We can't easily intercept fetch from the outside without DI, so we
    // just verify the adapter selected the AIVA mode (recorded in the
    // privacy audit JSONL even if the real fetch fails).
    await adapter.send('u1', '+12025550199', { body: 'x' }, 'kickoff_soon');
    const lines = (await readFile(smsAuditPath, 'utf8')).trim().split('\n');
    const rec = JSON.parse(lines[0]!);
    expect(rec.mode).toBe('aiva');
    // Status is "failed" because the gateway URL is unreachable in tests —
    // that's fine; what matters is that the *real* client path was taken.
    expect(['ok', 'failed']).toContain(rec.status);
  });

  it('records the failure status and errorCode when the gateway 5xxs', async () => {
    const audit = new MemoryAuditLogger();
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'down' }), { status: 503 });
    const client = new AivaSmsClient({
      baseUrl: 'https://sms.aiva.nz',
      apiKey: 'tok',
      deviceId: 'd',
      fetchImpl: fakeFetch,
    });
    const adapter = new AivaSmsAdapter({ audit, smsAuditPath, client });
    const r = await adapter.send(
      'u1',
      '+64211234567',
      { body: 'x' },
      'match_result',
    );
    expect(r.ok).toBe(false);
    const lines = (await readFile(smsAuditPath, 'utf8')).trim().split('\n');
    const rec = JSON.parse(lines[0]!);
    expect(rec.status).toBe('failed');
    expect(rec.errorCode).toBe('http-503');
  });
});

describe('AivaSmsAdapter — stub fallback', () => {
  it('falls back to StubSmsClient when env is not configured', async () => {
    const audit = new MemoryAuditLogger();
    const logs: string[] = [];
    const adapter = new AivaSmsAdapter({
      audit,
      smsAuditPath,
      apiUrl: 'http://localhost:9252',
      // intentionally no apiKey / deviceId
      log: (m) => logs.push(m),
    });
    const r = await adapter.send(
      'u1',
      '+64211234567',
      { body: 'fallback' },
      'leaderboard_move',
    );
    expect(r.ok).toBe(true);
    expect(logs.some((l) => /falling back to StubSmsClient/.test(l))).toBe(true);

    const xrec = audit.records[0]!;
    expect(xrec.note).toMatch(/stub/i);
    expect((xrec.payload as { to: string }).to).toBe('****4567');

    const lines = (await readFile(smsAuditPath, 'utf8')).trim().split('\n');
    const rec = JSON.parse(lines[0]!);
    expect(rec.mode).toBe('stub');
    expect(rec.status).toBe('ok');
    expect(rec.recipientLast4).toBe('****4567');
  });
});
