/**
 * Shared types for the dm-poll-forwarder.
 *
 * The forwarder normalises every platform's "new DM" event into a single
 * `PollMessage` shape, which the forwarder then re-formats into the
 * webhook body each dm-otp endpoint expects. Keeping the normalisation
 * here means the pollers stay platform-specific but the rest of the app
 * is platform-agnostic.
 */

export type Channel = 'reddit' | 'mastodon' | 'signal';

export const CHANNELS: readonly Channel[] = ['reddit', 'mastodon', 'signal'] as const;

/** Normalised inbound DM, before being shaped into a webhook body. */
export interface PollMessage {
  channel: Channel;
  /** Stable platform-specific id of the sender. */
  externalId: string;
  /** Plain-text body of the DM. */
  text: string;
  /** Platform-specific cursor value to advance after this message. */
  cursor: string;
  /** Optional ms-precision timestamp from the source platform. */
  receivedAt?: number;
  /** Optional metadata kept for debugging (instance host, conversation id). */
  meta?: Record<string, string>;
}

export interface PollerStatus {
  channel: Channel;
  enabled: boolean;
  paused: boolean;
  lastPollAt: number | null;
  lastPollOk: boolean | null;
  lastPollMessages: number;
  lastError: string | null;
  cursor: string | null;
  /** ms since the last successful poll completed. */
  lagMs: number | null;
}

export interface ForwardResult {
  ok: boolean;
  status: number;
  attempts: number;
  /** True if the request was retried at least once before resolving. */
  retried: boolean;
  /** Set when retries were exhausted and the message ended up dead-lettered. */
  deadLettered?: boolean;
  /** Last network/HTTP error message, if any. */
  error?: string;
}
