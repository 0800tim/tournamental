/**
 * Helpers shared across the real (non-stub) adapter implementations.
 *
 * Keep this file dependency-free so adapters that pull it in stay easy to
 * test without setting up extra mocks.
 */

import { createHash } from 'node:crypto';

/** Aggregate a list of platform-issued message ids into a single 12-char hex. */
export function aggregateId(messageIds: string[]): string {
  return createHash('sha256')
    .update(messageIds.join('|'))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Redact a Discord webhook URL so we never log the secret half. Discord
 * webhook URLs are of the shape:
 *   https://discord.com/api/webhooks/<webhook_id>/<webhook_token>
 * The `webhook_id` is non-secret (matches the Discord audit log row); the
 * token is the secret. We surface only the id.
 */
export function redactWebhookUrl(url: string): string {
  const m = url.match(/\/webhooks\/(\d+)\/[^/?]+/);
  return m ? `webhook:${m[1]}` : 'webhook:unknown';
}
