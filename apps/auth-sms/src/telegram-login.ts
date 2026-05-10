/**
 * Telegram Login Widget — payload verifier.
 *
 * Telegram's Login Widget signs the (id, first_name, last_name?, username?,
 * photo_url?, auth_date) tuple with the bot's HTTP-API token. The browser
 * receives the signed payload + a `hash` field; we verify it server-side
 * before trusting any field.
 *
 * Algorithm (https://core.telegram.org/widgets/login-legacy):
 *
 *   secret_key       = SHA256(bot_token)
 *   data_check_string = sort(keys ∖ {hash}).map(k => `${k}=${value}`).join('\n')
 *   hash_computed    = HMAC_SHA256(secret_key, data_check_string)  // hex
 *   accept iff hash_computed === payload.hash AND auth_date is fresh
 *
 * Freshness window: 24 h is the value Telegram suggests in the docs ("we
 * recommend you check the auth_date field … to prevent the use of outdated
 * data"). We also reject auth_dates more than 60 s in the future to absorb
 * client/server clock skew without giving an attacker a free replay window.
 *
 * The verifier is pure: callers pass the bot token + `now()` so the unit
 * tests can sign a payload with a known token and assert the verifier
 * round-trips it.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Maximum age of an `auth_date` we accept, in seconds (24 h). */
export const TELEGRAM_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Tolerance for `auth_date` in the future, in seconds. */
export const TELEGRAM_AUTH_FUTURE_SKEW_SECONDS = 60;

/**
 * Raw widget payload as received from the browser. All fields except `id`,
 * `auth_date` and `hash` are optional. `phone_number` is not part of the
 * widget today but is reserved for forward-compat with the bot's
 * request-contact follow-up — if present we'll use it to link a phone to
 * the same user row.
 */
export interface TelegramLoginPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
  phone_number?: string;
}

export interface VerifiedTelegramLogin {
  id: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  authDate: number;
  phoneNumber: string | null;
}

export class TelegramLoginVerifyError extends Error {
  readonly code:
    | 'bad-payload'
    | 'bad-hash'
    | 'expired'
    | 'future';
  constructor(code: TelegramLoginVerifyError['code'], message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'TelegramLoginVerifyError';
  }
}

/**
 * Build the data-check-string Telegram signs over.
 *
 * Exported so the test suite can sign synthetic payloads with the same
 * canonicalisation we verify with.
 */
export function buildDataCheckString(
  payload: Record<string, string | number | undefined>,
): string {
  const keys = Object.keys(payload)
    .filter((k) => k !== 'hash')
    .filter((k) => payload[k] !== undefined && payload[k] !== '')
    .sort();
  return keys.map((k) => `${k}=${String(payload[k])}`).join('\n');
}

/**
 * Compute the expected hex HMAC-SHA256 for a payload, given a bot token.
 *
 * Exported for tests; route code calls `verifyTelegramLogin` instead.
 */
export function computeTelegramHash(
  payload: Record<string, string | number | undefined>,
  botToken: string,
): string {
  const secretKey = createHash('sha256').update(botToken).digest();
  const dataCheckString = buildDataCheckString(payload);
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

function constantTimeHexEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify a widget payload against a bot token at the given wall-clock time.
 *
 * Throws `TelegramLoginVerifyError` on any failure. On success returns a
 * cleaned, typed view of the payload.
 */
export function verifyTelegramLogin(opts: {
  payload: TelegramLoginPayload;
  botToken: string;
  /** Unix seconds. */
  nowSeconds: number;
  /** Override for tests; default 24 h. */
  maxAgeSeconds?: number;
  /** Override for tests; default 60 s. */
  futureSkewSeconds?: number;
}): VerifiedTelegramLogin {
  const { payload, botToken } = opts;
  if (!botToken) {
    throw new TelegramLoginVerifyError('bad-payload', 'missing bot token');
  }
  if (
    !payload ||
    typeof payload.id !== 'number' ||
    typeof payload.auth_date !== 'number' ||
    typeof payload.hash !== 'string' ||
    payload.hash.length !== 64
  ) {
    throw new TelegramLoginVerifyError('bad-payload');
  }

  // Build the canonical record we hash over. Coerce numbers to strings the
  // same way Telegram's widget does (decimal, no thousands separators).
  const fields: Record<string, string | number | undefined> = {
    id: payload.id,
    auth_date: payload.auth_date,
  };
  if (payload.first_name) fields.first_name = payload.first_name;
  if (payload.last_name) fields.last_name = payload.last_name;
  if (payload.username) fields.username = payload.username;
  if (payload.photo_url) fields.photo_url = payload.photo_url;

  const expected = computeTelegramHash(fields, botToken);
  if (!constantTimeHexEq(expected, payload.hash)) {
    throw new TelegramLoginVerifyError('bad-hash');
  }

  const maxAge = opts.maxAgeSeconds ?? TELEGRAM_AUTH_MAX_AGE_SECONDS;
  const futureSkew = opts.futureSkewSeconds ?? TELEGRAM_AUTH_FUTURE_SKEW_SECONDS;
  if (payload.auth_date < opts.nowSeconds - maxAge) {
    throw new TelegramLoginVerifyError('expired');
  }
  if (payload.auth_date > opts.nowSeconds + futureSkew) {
    throw new TelegramLoginVerifyError('future');
  }

  return {
    id: payload.id,
    firstName: payload.first_name ?? null,
    lastName: payload.last_name ?? null,
    username: payload.username ?? null,
    photoUrl: payload.photo_url ?? null,
    authDate: payload.auth_date,
    phoneNumber:
      typeof payload.phone_number === 'string' && payload.phone_number.length > 0
        ? payload.phone_number
        : null,
  };
}
