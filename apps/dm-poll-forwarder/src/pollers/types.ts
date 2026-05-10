/**
 * Common contract every poller fulfils so the scheduler can drive them
 * uniformly. Each poll() call accepts the previous cursor (or undefined
 * on first run) and returns the new cursor + any messages observed since.
 */

import type { Channel, PollMessage } from '../types.js';

export interface PollResult {
  /** Messages discovered since the prior cursor, oldest-first. */
  messages: PollMessage[];
  /** New cursor to persist after these messages have been forwarded. */
  cursor: string | undefined;
}

export interface Poller {
  channel: Channel;
  /** Friendly description for logs/status. */
  description: string;
  poll(previousCursor: string | undefined): Promise<PollResult>;
}
