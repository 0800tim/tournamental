/**
 * Web Push channel adapter.
 *
 * Stubbed for v0.1 — we never actually call the W3C Push endpoint. A real
 * implementation would import the `web-push` npm package and call
 * `webpush.sendNotification(subscription, payload, { vapidDetails })`.
 * The signature here matches what that integration will look like so the
 * swap is mechanical.
 *
 * VAPID keys for production come from env:
 *   VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT      mailto:ops@tournamental.com
 */

import type { AuditLogger } from './audit.js';

/**
 * Subset of the W3C Push subscription JSON. Browsers produce the full shape
 * via `pushManager.subscribe()`; the server only needs `endpoint` + `keys`.
 */
export interface WebPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface WebPushResult {
  ok: boolean;
  errorMessage?: string;
}

export interface WebPushSenderConfig {
  audit: AuditLogger;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject?: string;
}

/**
 * Stub Web Push sender. Always returns `ok: true` and writes the would-be
 * payload to the audit log. The signature is `{ userId, subscription,
 * payload }` because a real send needs the subscription for endpoint +
 * encryption keys.
 */
export class StubWebPushSender {
  constructor(private readonly cfg: WebPushSenderConfig) {}

  async send(
    userId: string,
    subscription: WebPushSubscription,
    payload: WebPushPayload,
    event: 'kickoff_soon' | 'match_result' | 'leaderboard_move',
  ): Promise<WebPushResult> {
    const configured = Boolean(
      this.cfg.vapidPublicKey && this.cfg.vapidPrivateKey,
    );
    await this.cfg.audit.append({
      channel: 'web-push',
      userId,
      event,
      payload: {
        endpoint: subscription.endpoint,
        title: payload.title,
        body: payload.body,
        url: payload.url,
        tag: payload.tag,
      },
      ok: true,
      note: configured
        ? 'stub: VAPID configured but real send is not wired in v0.1'
        : 'stub: VAPID keys not configured; would skip in prod',
    });
    return { ok: true };
  }
}
