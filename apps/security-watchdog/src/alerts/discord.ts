/**
 * Discord incoming-webhook sink.
 *
 * Env:
 *   SECURITY_DISCORD_WEBHOOK_URL   webhook URL
 */

import type { Finding } from '../lib/types.js';
import type { AlertSink } from './index.js';

const SEVERITY_COLOUR: Record<Finding['severity'], number> = {
  info: 0x808080,
  low: 0xa3be8c,
  medium: 0xebcb8b,
  high: 0xd08770,
  critical: 0xbf616a,
};

export interface DiscordSinkOptions {
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
}

export function buildDiscordSink(opts: DiscordSinkOptions = {}): AlertSink {
  const url = opts.webhookUrl ?? process.env.SECURITY_DISCORD_WEBHOOK_URL;
  const enabled = typeof url === 'string' && url.startsWith('https://');
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    name: 'discord',
    enabled,
    async deliver(f: Finding) {
      if (!enabled || !url) return;
      const payload = {
        embeds: [
          {
            title: `[${f.severity.toUpperCase()}] ${f.title}`.slice(0, 256),
            description: (f.detail ?? '').slice(0, 4000),
            color: SEVERITY_COLOUR[f.severity],
            fields: [
              { name: 'Source', value: f.source, inline: true },
              { name: 'Status', value: f.status, inline: true },
              { name: 'Location', value: f.location ?? 'n/a', inline: false },
              { name: 'Finding ID', value: f.id, inline: false },
            ].slice(0, 25),
          },
        ],
      };
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`discord webhook ${res.status}`);
      }
    },
  };
}
