/**
 * Provider adapter contract.
 *
 * Each social / identity provider exposes the same minimal surface so the
 * router code in `routes/links.ts` doesn't need to know which provider it
 * is dealing with. The MVP shipped here returns mock URLs only — wiring the
 * real OAuth handshake is a v0.2 task and is gated on Tim provisioning the
 * keys listed in each adapter file.
 *
 * The shape lines up with doc 20 (Identity, Humanness Score, and Bot
 * Policy). When we wire the real flows, each adapter will:
 *   1. Build a state-protected authorization URL.
 *   2. Receive the callback (handled at the router level, not here).
 *   3. Exchange `code` for tokens via the provider's token endpoint.
 *   4. Hit the userinfo endpoint and return a normalised `ProviderProfile`.
 */

export type ProviderId =
  | 'google'
  | 'apple'
  | 'telegram'
  | 'x'
  | 'discord'
  | 'phone';

export interface ProviderProfile {
  /** Provider-side stable identifier (sub, twitter handle id, telegram_id). */
  externalId: string;
  /** Display name where the provider gives one. */
  displayName?: string;
  /** Raw email if disclosed (Apple gives a relay address). */
  email?: string;
  /** Avatar / profile photo URL. */
  avatarUrl?: string;
  /** Provider-claimed account creation timestamp (ms epoch) when known. */
  accountCreatedAt?: number;
  /** Telegram premium flag — small humanness bonus per doc 20. */
  telegramPremium?: boolean;
  /** Twitter/X verified blue-tick flag. */
  verified?: boolean;
  /** Anything provider-specific the adapter wants to ferry through. */
  raw?: Record<string, unknown>;
}

export interface StartLinkInput {
  /** Internal vtorn user id starting the link. */
  userId: string;
  /** State token to round-trip back through the provider. */
  state: string;
  /** Server-provided callback URL the provider will redirect to. */
  redirectUri: string;
}

export interface StartLinkResult {
  /** URL to redirect the user to (mock in MVP). */
  authorizeUrl: string;
  /** Hint surfaced in the API response — useful for client UX. */
  expectedScopes: string[];
}

export interface ProviderAdapter {
  id: ProviderId;
  /** Human-readable name. */
  displayName: string;
  /** Build the provider authorize URL. MVP: mock URL only. */
  startLink(input: StartLinkInput): StartLinkResult;
  /**
   * Resolve a callback. MVP: returns the inputs un-massaged so the route
   * handler can persist them; real impl will exchange `code` for tokens.
   */
  resolveCallback(
    input: { code?: string; externalId: string; profile?: Partial<ProviderProfile> },
  ): Promise<ProviderProfile>;
}
