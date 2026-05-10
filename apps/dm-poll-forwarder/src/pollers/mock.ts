/**
 * Mock pollers — used by tests and by the default `POLL_BACKEND=mock`
 * runtime so an operator can boot the worker without API credentials and
 * still see the end-to-end flow (cursor advance, forward, status update).
 *
 * Each mock holds a fixture queue; `poll()` drains items strictly newer
 * than the supplied cursor. Cursors are monotonically increasing
 * stringified integers so the scheduler's "advance after forward"
 * semantics are easy to assert in tests.
 */

import type { Channel, PollMessage } from '../types.js';
import type { Poller, PollResult } from './types.js';

export interface MockMessage {
  externalId: string;
  text: string;
  /** Monotonic id; cursors are stringified versions of this. */
  id: number;
  meta?: Record<string, string>;
}

export class MockPoller implements Poller {
  readonly description: string;
  private fixtures: MockMessage[] = [];
  /** Toggle to simulate a transient platform outage. */
  fail = false;

  constructor(public readonly channel: Channel, description?: string) {
    this.description = description ?? `mock-${channel}`;
  }

  enqueue(...msgs: MockMessage[]): void {
    this.fixtures.push(...msgs);
  }

  setFailing(failing: boolean): void {
    this.fail = failing;
  }

  async poll(previousCursor: string | undefined): Promise<PollResult> {
    if (this.fail) throw new Error(`${this.channel} mock poller: simulated failure`);
    const after = previousCursor ? Number.parseInt(previousCursor, 10) : 0;
    const fresh = this.fixtures
      .filter((m) => m.id > after)
      .sort((a, b) => a.id - b.id);
    if (fresh.length === 0) return { messages: [], cursor: previousCursor };
    const messages: PollMessage[] = fresh.map((m) => ({
      channel: this.channel,
      externalId: m.externalId,
      text: m.text,
      cursor: String(m.id),
      receivedAt: Date.now(),
      meta: m.meta,
    }));
    return { messages, cursor: String(fresh[fresh.length - 1]!.id) };
  }
}
