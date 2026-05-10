import { describe, it, expect, vi } from 'vitest';
import { AlertDispatcher, sinksForSeverity, type AlertSink } from '../src/alerts/index.js';
import { buildSlackSink } from '../src/alerts/slack.js';
import { buildDiscordSink } from '../src/alerts/discord.js';
import { buildTelegramSink } from '../src/alerts/telegram.js';
import { buildAivaSmsSink } from '../src/alerts/aiva-sms.js';
import { buildEmailSink } from '../src/alerts/email.js';
import type { Finding } from '../src/lib/types.js';

const f = (sev: Finding['severity']): Finding => ({
  id: 'x',
  source: 'gitleaks',
  severity: sev,
  status: 'open',
  firstSeenAt: 0,
  lastSeenAt: 0,
  title: 't',
  tags: [],
});

function fakeSink(name: string, throws = false): AlertSink {
  return {
    name,
    enabled: true,
    deliver: vi.fn().mockImplementation(async () => {
      if (throws) throw new Error('boom');
    }),
  };
}

describe('sinksForSeverity', () => {
  it('low → none', () => {
    const list = [fakeSink('slack'), fakeSink('discord'), fakeSink('aiva-sms')];
    expect(sinksForSeverity('log', list)).toEqual([]);
  });

  it('channel → slack/discord/telegram only', () => {
    const list = [
      fakeSink('slack'),
      fakeSink('discord'),
      fakeSink('telegram'),
      fakeSink('aiva-sms'),
      fakeSink('email'),
    ];
    const out = sinksForSeverity('channel', list).map((s) => s.name);
    expect(out.sort()).toEqual(['discord', 'slack', 'telegram']);
  });

  it('oncall → channels + aiva-sms', () => {
    const list = [
      fakeSink('slack'),
      fakeSink('discord'),
      fakeSink('telegram'),
      fakeSink('aiva-sms'),
      fakeSink('email'),
    ];
    const out = sinksForSeverity('oncall', list).map((s) => s.name);
    expect(out).toContain('aiva-sms');
    expect(out).not.toContain('email');
  });

  it('page → all', () => {
    const list = [
      fakeSink('slack'),
      fakeSink('discord'),
      fakeSink('telegram'),
      fakeSink('aiva-sms'),
      fakeSink('email'),
    ];
    const out = sinksForSeverity('page', list).map((s) => s.name);
    expect(out.length).toBe(5);
  });
});

describe('AlertDispatcher', () => {
  it('dispatches to channel sinks for medium', async () => {
    const slack = fakeSink('slack');
    const aiva = fakeSink('aiva-sms');
    const d = new AlertDispatcher({ sinks: [slack, aiva] });
    await d.dispatch(f('medium'));
    expect(slack.deliver).toHaveBeenCalled();
    expect(aiva.deliver).not.toHaveBeenCalled();
  });

  it('dispatches to channel + on-call for high', async () => {
    const slack = fakeSink('slack');
    const aiva = fakeSink('aiva-sms');
    const email = fakeSink('email');
    const d = new AlertDispatcher({ sinks: [slack, aiva, email] });
    await d.dispatch(f('high'));
    expect(slack.deliver).toHaveBeenCalled();
    expect(aiva.deliver).toHaveBeenCalled();
    expect(email.deliver).not.toHaveBeenCalled();
  });

  it('dispatches to all for critical', async () => {
    const slack = fakeSink('slack');
    const aiva = fakeSink('aiva-sms');
    const email = fakeSink('email');
    const d = new AlertDispatcher({ sinks: [slack, aiva, email] });
    await d.dispatch(f('critical'));
    expect(slack.deliver).toHaveBeenCalled();
    expect(aiva.deliver).toHaveBeenCalled();
    expect(email.deliver).toHaveBeenCalled();
  });

  it('captures failures via onFailure hook', async () => {
    const evil = fakeSink('slack', true);
    const onFailure = vi.fn();
    const d = new AlertDispatcher({ sinks: [evil], onFailure });
    const r = await d.dispatch(f('medium'));
    expect(r.failed.length).toBe(1);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('a failing sink does not block other deliveries', async () => {
    const evil = fakeSink('slack', true);
    const ok = fakeSink('discord');
    const d = new AlertDispatcher({ sinks: [evil, ok] });
    const r = await d.dispatch(f('medium'));
    expect(r.delivered).toContain('discord');
  });

  it('skips disabled sinks', async () => {
    const evil = { ...fakeSink('slack'), enabled: false };
    const d = new AlertDispatcher({ sinks: [evil] });
    const r = await d.dispatch(f('medium'));
    expect(r.delivered).toEqual([]);
  });

  it('low severity routes to nothing', async () => {
    const slack = fakeSink('slack');
    const d = new AlertDispatcher({ sinks: [slack] });
    const r = await d.dispatch(f('low'));
    expect(r.delivered).toEqual([]);
    expect(slack.deliver).not.toHaveBeenCalled();
  });
});

describe('buildSlackSink', () => {
  it('disabled when no webhook url', () => {
    const s = buildSlackSink({});
    expect(s.enabled).toBe(false);
  });

  it('posts JSON to the webhook on deliver', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    const s = buildSlackSink({ webhookUrl: 'https://hooks.slack.example/abc', fetchImpl: fetchImpl as typeof fetch });
    await s.deliver(f('high'));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('throws on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const s = buildSlackSink({ webhookUrl: 'https://hooks.slack.example/abc', fetchImpl: fetchImpl as typeof fetch });
    await expect(s.deliver(f('high'))).rejects.toThrow();
  });
});

describe('buildDiscordSink', () => {
  it('posts an embed payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    const s = buildDiscordSink({
      webhookUrl: 'https://discord.com/api/webhooks/x',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await s.deliver(f('critical'));
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string);
    expect(body.embeds[0].title).toContain('CRITICAL');
  });
});

describe('buildTelegramSink', () => {
  it('disabled without bot token', () => {
    const s = buildTelegramSink({});
    expect(s.enabled).toBe(false);
  });

  it('posts to telegram bot api when configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    const s = buildTelegramSink({
      botToken: 't',
      chatId: '123',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await s.deliver(f('high'));
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = String(fetchImpl.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('api.telegram.org/bott/sendMessage');
  });
});

describe('buildAivaSmsSink', () => {
  it('disabled without recipients', () => {
    delete process.env.SECURITY_ONCALL_PHONES;
    const s = buildAivaSmsSink();
    expect(s.enabled).toBe(false);
  });

  it('uses an injected sender for tests', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const s = buildAivaSmsSink({
      recipients: ['+64211111111'],
      sender: { send },
    });
    expect(s.enabled).toBe(true);
    await s.deliver(f('critical'));
    expect(send).toHaveBeenCalledOnce();
  });

  it('throws when ALL recipients fail', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, errorMessage: 'no signal' });
    const s = buildAivaSmsSink({
      recipients: ['+64211111111'],
      sender: { send },
    });
    await expect(s.deliver(f('high'))).rejects.toThrow();
  });
});

describe('buildEmailSink', () => {
  it('disabled by default', () => {
    delete process.env.SECURITY_EMAIL_TO;
    delete process.env.SECURITY_EMAIL_FROM;
    delete process.env.SECURITY_EMAIL_SMTP_HOST;
    const s = buildEmailSink({});
    expect(s.enabled).toBe(false);
  });

  it('uses an injected send when configured via env', async () => {
    process.env.SECURITY_EMAIL_TO = 'tim@tournamental.com';
    process.env.SECURITY_EMAIL_FROM = 'sec@tournamental.com';
    const send = vi.fn().mockResolvedValue(undefined);
    const s = buildEmailSink({ send });
    expect(s.enabled).toBe(true);
    await s.deliver(f('critical'));
    expect(send).toHaveBeenCalledOnce();
  });
});
