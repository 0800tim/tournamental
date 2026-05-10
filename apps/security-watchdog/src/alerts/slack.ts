/**
 * Slack incoming-webhook sink.
 *
 * Env:
 *   SECURITY_SLACK_WEBHOOK_URL   incoming webhook URL (https only)
 */

import type { Finding } from '../lib/types.js';
import type { AlertSink } from './index.js';

export interface SlackSinkOptions {
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
}

export function buildSlackSink(opts: SlackSinkOptions = {}): AlertSink {
  const url = opts.webhookUrl ?? process.env.SECURITY_SLACK_WEBHOOK_URL;
  const enabled = typeof url === 'string' && url.startsWith('https://');
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    name: 'slack',
    enabled,
    async deliver(f: Finding) {
      if (!enabled || !url) return;
      const text = formatMessage(f);
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        throw new Error(`slack webhook ${res.status}`);
      }
    },
  };
}

function formatMessage(f: Finding): string {
  const sev = f.severity.toUpperCase();
  return [
    `*[${sev}]* ${f.source}: ${f.title}`,
    f.location ? `Location: \`${f.location}\`` : '',
    f.detail ? truncate(f.detail, 800) : '',
    `Finding ID: \`${f.id}\``,
  ]
    .filter(Boolean)
    .join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
