/**
 * WhatsApp channel tests.
 *
 * Covers:
 *  - subscribe rejects without consent
 *  - subscribe records a WA subscription and audits with masked phone
 *  - the WhatsAppPushSender masks phones in the audit log on send
 *  - the dispatcher 'auto' policy prefers WhatsApp over SMS when both linked
 *  - policy='sms' suppresses WhatsApp delivery
 *  - policy='whatsapp' suppresses SMS delivery
 *  - phone-mask helper keeps last 4 digits + leading "+"
 *  - the WA-only audit file is populated and contains no raw phone numbers
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildServer, type BuiltServer } from '../src/index.js';
import {
  WhatsAppPushSender,
  maskPhone,
  type WhatsAppSenderConfig,
} from '../src/lib/whatsapp.js';
import { MemoryAuditLogger } from '../src/lib/audit.js';

let workdir: string;
let waPath: string;
let auditPath: string;
let built: BuiltServer;

async function makeServer(opts: Partial<Parameters<typeof buildServer>[0]> = {}) {
  return buildServer({
    auditPath: join(workdir, 'audit.jsonl'),
    whatsappAuditPath: join(workdir, 'whatsapp-audit.jsonl'),
    subscriptionsPath: join(workdir, 'subs.jsonl'),
    schedulerStatePath: join(workdir, 'sched.json'),
    bootScheduler: false,
    ...opts,
  });
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'push-wa-test-'));
  waPath = join(workdir, 'whatsapp-audit.jsonl');
  auditPath = join(workdir, 'audit.jsonl');
  built = await makeServer();
  await built.app.ready();
});

afterEach(async () => {
  await built.app.close();
  await rm(workdir, { recursive: true, force: true });
});

describe('maskPhone', () => {
  it('keeps + and last 4 digits', () => {
    expect(maskPhone('+64211234567')).toBe('+*******4567');
    expect(maskPhone('64211234567')).toBe('*******4567');
    // 11 digits in '+1 (555) 010-1234' -> 7 stars + last 4 digits.
    expect(maskPhone('+1 (555) 010-1234')).toBe('+*******1234');
    // Too short — entirely starred but keeps + sign.
    expect(maskPhone('+12')).toBe('+**');
  });
});

describe('POST /v1/subscribe/whatsapp', () => {
  it('rejects when consent flag is missing', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/whatsapp',
      payload: { userId: 'u1', phone: '+64211234567' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_body');
  });

  it('rejects when consent is false', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/whatsapp',
      payload: { userId: 'u1', consent: false, phone: '+64211234567' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects malformed phone', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/whatsapp',
      payload: { userId: 'u1', consent: true, phone: 'not-a-phone' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('records the subscription and writes a masked audit row', async () => {
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/whatsapp',
      payload: { userId: 'u1', consent: true, phone: '+64211234567' },
    });
    expect(r.statusCode).toBe(201);
    expect(built.store.getWhatsApp('u1')?.phone).toBe('+64211234567');
    const records = await built.audit.read();
    const sub = records.find(
      (x) => x.event === 'subscribe' && x.channel === 'whatsapp',
    );
    expect(sub).toBeDefined();
    const payload = sub?.payload as { phone: string };
    expect(payload.phone).toMatch(/^\+\*+4567$/);
    expect(payload.phone).not.toContain('64211');
  });
});

describe('Dispatcher auto-prefer policy', () => {
  it("'auto' prefers WhatsApp over SMS when both are linked", async () => {
    // u1 subscribes to both SMS and WhatsApp.
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/sms',
      payload: { userId: 'u1', consent: true, phone: '+64211111111' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/whatsapp',
      payload: { userId: 'u1', consent: true, phone: '+64211111111' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/picks/record',
      payload: { matchId: 'M1', userId: 'u1', outcome: 'home_win' },
    });
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/kickoff_soon',
      payload: { matchId: 'M1', minutesUntil: 30 },
    });
    expect(r.statusCode).toBe(200);
    const fanout = r.json().fanouts[0];
    expect(fanout).toMatchObject({
      whatsapp: 'sent',
      sms: 'suppressed',
    });
  });

  it("'auto' falls back to SMS when WhatsApp is not linked", async () => {
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/sms',
      payload: { userId: 'u1', consent: true, phone: '+64211111111' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/picks/record',
      payload: { matchId: 'M1', userId: 'u1', outcome: 'home_win' },
    });
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/kickoff_soon',
      payload: { matchId: 'M1', minutesUntil: 30 },
    });
    const fanout = r.json().fanouts[0];
    expect(fanout).toMatchObject({
      sms: 'sent',
      whatsapp: 'skipped',
    });
  });

  it("policy='sms' suppresses WhatsApp delivery", async () => {
    await built.app.close();
    built = await makeServer({ preferredChannel: 'sms' });
    await built.app.ready();
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/sms',
      payload: { userId: 'u1', consent: true, phone: '+64211111111' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/whatsapp',
      payload: { userId: 'u1', consent: true, phone: '+64211111111' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/picks/record',
      payload: { matchId: 'M1', userId: 'u1', outcome: 'home_win' },
    });
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/kickoff_soon',
      payload: { matchId: 'M1', minutesUntil: 30 },
    });
    const fanout = r.json().fanouts[0];
    expect(fanout.sms).toBe('sent');
    expect(fanout.whatsapp).toBe('suppressed');
  });

  it("policy='whatsapp' suppresses SMS delivery", async () => {
    await built.app.close();
    built = await makeServer({ preferredChannel: 'whatsapp' });
    await built.app.ready();
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/sms',
      payload: { userId: 'u1', consent: true, phone: '+64211111111' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/whatsapp',
      payload: { userId: 'u1', consent: true, phone: '+64211111111' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/picks/record',
      payload: { matchId: 'M1', userId: 'u1', outcome: 'home_win' },
    });
    const r = await built.app.inject({
      method: 'POST',
      url: '/v1/notify/kickoff_soon',
      payload: { matchId: 'M1', minutesUntil: 30 },
    });
    const fanout = r.json().fanouts[0];
    expect(fanout.whatsapp).toBe('sent');
    expect(fanout.sms).toBe('suppressed');
  });
});

describe('WhatsAppPushSender', () => {
  it('uses the injected transport and masks phones in audit', async () => {
    const audit = new MemoryAuditLogger();
    const transportSend = vi.fn(async () => ({
      ok: true,
      raw: { messageId: 'wa-1' },
    }));
    const cfg: WhatsAppSenderConfig = {
      audit,
      apiUrl: 'http://localhost:9999',
      apiKey: 'test-key',
      sessionId: 'test-session',
      transport: {
        send: transportSend,
        async pairingQr() {
          return null;
        },
        async shutdown() {
          /* no-op */
        },
      },
    };
    const sender = new WhatsAppPushSender(cfg);
    const result = await sender.send(
      'u1',
      '+64211234567',
      { body: 'kickoff in 30', url: 'https://vtourn.com/match/M1' },
      'kickoff_soon',
    );
    expect(result.ok).toBe(true);
    expect(transportSend).toHaveBeenCalledTimes(1);
    expect(transportSend.mock.calls[0]?.[0].to).toBe('+64211234567');
    // Audit must have the masked phone, not the raw number.
    const rec = audit.records[0];
    expect(rec).toBeDefined();
    expect(rec?.channel).toBe('whatsapp');
    const payload = rec?.payload as { to: string; body: string };
    expect(payload.to).toBe('+*******4567');
    expect(JSON.stringify(rec)).not.toContain('64211234567');
  });

  it('falls back to a stub note when not configured (no real transport)', async () => {
    const audit = new MemoryAuditLogger();
    const sender = new WhatsAppPushSender({ audit });
    const result = await sender.send(
      'u1',
      '+64211234567',
      { body: 'hi' },
      'kickoff_soon',
    );
    expect(result.ok).toBe(true);
    expect(sender.isConfigured()).toBe(false);
    expect(audit.records[0]?.note).toMatch(/stub/i);
  });

  it('records ok=false on transport failure with masked audit row', async () => {
    const audit = new MemoryAuditLogger();
    const sender = new WhatsAppPushSender({
      audit,
      apiKey: 'k',
      sessionId: 's',
      transport: {
        async send() {
          return {
            ok: false,
            errorCode: 'http-503',
            errorMessage: 'gateway unavailable',
          };
        },
        async pairingQr() {
          return null;
        },
        async shutdown() {
          /* no-op */
        },
      },
    });
    const r = await sender.send(
      'u1',
      '+64211234567',
      { body: 'hi' },
      'match_result',
    );
    expect(r.ok).toBe(false);
    expect(audit.records[0]?.ok).toBe(false);
    expect(audit.records[0]?.note).toMatch(/http-503/);
  });
});

describe('WhatsApp audit file', () => {
  it('mirrors WA sends into data/whatsapp-audit.jsonl with masked phones', async () => {
    await built.app.inject({
      method: 'POST',
      url: '/v1/subscribe/whatsapp',
      payload: { userId: 'u1', consent: true, phone: '+64211234567' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/picks/record',
      payload: { matchId: 'M1', userId: 'u1', outcome: 'home_win' },
    });
    await built.app.inject({
      method: 'POST',
      url: '/v1/notify/kickoff_soon',
      payload: { matchId: 'M1', minutesUntil: 30 },
    });

    const waLog = await readFile(waPath, 'utf8');
    expect(waLog).toContain('"channel":"whatsapp"');
    expect(waLog).toContain('"event":"kickoff_soon"');
    expect(waLog).not.toContain('64211234567');
    expect(waLog).toMatch(/\+\*+4567/);

    // Main audit also has the WA send (tee).
    const mainLog = await readFile(auditPath, 'utf8');
    expect(mainLog).toContain('"channel":"whatsapp"');
    expect(mainLog).not.toContain('64211234567');
  });
});
