/**
 * In-memory store for events the CRM bridge has received.
 *
 * Per the brief, no Postgres yet — the customer-360 aggregate is composed
 * from this in-memory cache plus the GHL JSONL audit log. A restart drops
 * cached events; that's acceptable for v0.1 because the source services
 * will replay events on schedule. When we promote to multi-instance, this
 * gets swapped for Postgres or Redis behind the same interface.
 *
 * Idempotency is enforced here, not at the route layer: the store
 * remembers every (eventId) it has accepted and returns
 * `{ accepted: false }` for duplicates.
 */

import type { StoredEvent, EventKind } from './events.js';

export interface AcceptResult {
  accepted: boolean;
  /** The stored event (either the freshly-accepted one or the prior copy). */
  event: StoredEvent;
}

export class EventStore {
  /** Index by eventId for O(1) idempotency checks. */
  private readonly byId = new Map<string, StoredEvent>();
  /** Per-user event lists, in insertion order, for the aggregate endpoint. */
  private readonly byUser = new Map<string, StoredEvent[]>();

  accept(event: StoredEvent): AcceptResult {
    const existing = this.byId.get(event.eventId);
    if (existing) {
      // Idempotency: don't re-record. Surface the prior event so callers can
      // log and respond consistently.
      return { accepted: false, event: existing };
    }
    this.byId.set(event.eventId, event);
    const list = this.byUser.get(event.userId) ?? [];
    list.push(event);
    this.byUser.set(event.userId, list);
    return { accepted: true, event };
  }

  eventsForUser(userId: string): readonly StoredEvent[] {
    return this.byUser.get(userId) ?? [];
  }

  countByKind(userId: string, kind: EventKind): number {
    let n = 0;
    for (const e of this.eventsForUser(userId)) {
      if (e.kind === kind) n += 1;
    }
    return n;
  }

  totalEvents(): number {
    return this.byId.size;
  }

  totalUsers(): number {
    return this.byUser.size;
  }
}
