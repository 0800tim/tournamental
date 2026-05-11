/**
 * Dependency-injection container for the dm-otp service.
 *
 * Routes consume DmOtpContext rather than reaching directly into env.
 * Tests build a DmOtpContext with stub senders and a deterministic
 * clock — everything else is identical.
 */

import type { CodeStore } from './lib/code-store.js';
import type { IdentityStore } from './lib/identity-store.js';
import type { SendFn } from './lib/dispatcher.js';
import type { BruteForceGuard } from './lib/brute-force.js';

export interface DmOtpConfig {
  /** Hash secret for OTP storage. >=32 chars. */
  otpSecret: string;
  /** JWT signing secret. >=32 chars. */
  jwtSecret: string;
  /** App display name in user-facing copy. */
  productName: string;
  /** Public website host (used in magic-link URLs and CORS). */
  appHost: string;
  /** Public base URL for magic links. */
  appBaseUrl: string;
  /** Code TTL in seconds. */
  codeTtlSeconds: number;
  /** Session JWT TTL in seconds. */
  sessionTtlSeconds: number;
  /** Per-channel inbound webhook secrets (Meta app secret, etc.). */
  metaAppSecret: string;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  discordPublicKey: string;
  slackSigningSecret: string;
  lineChannelSecret: string;
  viberAuthToken: string;
  xConsumerSecret: string;
  mailgunSigningKey: string;
  mastodonInboundBearer: string;
  redditPollerBearer: string;
  signalPollerBearer: string;
  teamsAppId: string;
  teamsAppPassword: string;
  /** Comma-separated list of channels that should be enabled. Empty = all. */
  enabledChannels: string;
}

export interface DmOtpLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface DmOtpContext {
  store: CodeStore;
  identityStore: IdentityStore;
  senders: Map<string, SendFn>;
  magicLinkChannels: Set<string>;
  /** Per-IP throttle + per-subject lockout in front of the verify route. */
  bruteForce: BruteForceGuard;
  config: DmOtpConfig;
  log: DmOtpLogger;
  now(): number;
}
