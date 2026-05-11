/**
 * Token generation + hashing for personal API keys.
 *
 * Token format
 * ============
 *
 *   tnm_live_<32-char-base62>
 *
 * Example: `tnm_live_aBcDeFgH1234567890abcdef12345678`
 *
 *   * Prefix `tnm_live_` makes the key recognisable in code samples and
 *     in egress filters.
 *   * 32 characters of base62 entropy , log2(62) approx 5.95 bits/char
 *     gives roughly 190 bits of entropy, comfortably above the 128 bits
 *     a session-equivalent token needs.
 *   * `key_prefix` stored alongside the hash is `tnm_live_` + the first
 *     8 chars of the base62 chunk. That is enough to display the key in
 *     the dashboard ("tnm_live_aBcDeFgH...") and to narrow the DB lookup
 *     to one row before the constant-time hash compare , no need for
 *     a hashed prefix or for the plaintext to ever appear in a log.
 *
 * Hashing
 * =======
 *
 * Node's built-in `scrypt` with a 16-byte random salt and N=2^14, r=8,
 * p=1 (the same parameters used by `apps/vstamp/src/lib/keys.ts` , the
 * one other place this codebase derives secrets at rest). The stored
 * string is `scrypt$<saltHex>$<hashHex>` so a future migration to
 * argon2id can switch on the algorithm tag without a schema change.
 *
 * We deliberately do NOT pull bcrypt as a dep , the workspace doesn't
 * have it, scrypt is built into Node, and the security properties for a
 * never-reused 190-bit secret are identical.
 */

import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_PREFIX = "tnm_live_";
const PREFIX_BODY_LEN = 8;        // first 8 base62 chars after `tnm_live_`
const TOKEN_BODY_LEN = 32;        // total base62 chars after `tnm_live_`
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_LEN = 64;
const SCRYPT_N = 1 << 14;         // 16384, same as vstamp
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export interface MintedKey {
  /** The full plaintext token the user must save. Never persisted. */
  readonly plaintext: string;
  /** `tnm_live_<first-8>` , safe to store and display. */
  readonly prefix: string;
  /** Encoded scrypt hash , what we persist in `user_api_keys.key_hash`. */
  readonly hash: string;
}

/**
 * Mint a fresh plaintext key plus its storable prefix and hash.
 *
 * Caller decides the row id, label and scopes , this function only
 * cares about the secret.
 */
export function mintPersonalKey(): MintedKey {
  const body = generateBase62(TOKEN_BODY_LEN);
  const plaintext = `${TOKEN_PREFIX}${body}`;
  const prefix = `${TOKEN_PREFIX}${body.slice(0, PREFIX_BODY_LEN)}`;
  const hash = hashKey(plaintext);
  return { plaintext, prefix, hash };
}

/** Compute the storable `key_prefix` for a plaintext token. */
export function prefixFor(plaintext: string): string | null {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
  const body = plaintext.slice(TOKEN_PREFIX.length);
  if (body.length < PREFIX_BODY_LEN) return null;
  return `${TOKEN_PREFIX}${body.slice(0, PREFIX_BODY_LEN)}`;
}

/** Cheap shape check: does this look like a personal API key at all? */
export function isPersonalKeyShape(raw: string): boolean {
  if (!raw.startsWith(TOKEN_PREFIX)) return false;
  const body = raw.slice(TOKEN_PREFIX.length);
  if (body.length !== TOKEN_BODY_LEN) return false;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;
    const isUpper = c >= 65 && c <= 90;
    const isLower = c >= 97 && c <= 122;
    if (!isDigit && !isUpper && !isLower) return false;
  }
  return true;
}

/** Constant-time check of a plaintext token against a stored hash. */
export function verifyKey(plaintext: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1] ?? "", "hex");
    expected = Buffer.from(parts[2] ?? "", "hex");
  } catch {
    return false;
  }
  if (salt.length !== SCRYPT_SALT_BYTES) return false;
  if (expected.length !== SCRYPT_KEY_LEN) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(plaintext, salt, SCRYPT_KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// ---------- internals ----------

function hashKey(plaintext: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = scryptSync(plaintext, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Cryptographically random base62 string. Rejection-sampled so the
 * output distribution is uniform , a naive `% 62` would bias the first
 * four characters.
 */
function generateBase62(len: number): string {
  const out: string[] = [];
  while (out.length < len) {
    // Pull a chunk that's bigger than we need so the rejection loop
    // converges fast.
    const buf = randomBytes(len * 2);
    for (let i = 0; i < buf.length && out.length < len; i++) {
      const b = buf[i]!;
      if (b < 248) {
        // 248 = 4 * 62 , no modulo bias
        out.push(BASE62[b % 62]!);
      }
    }
  }
  return out.join("");
}

/**
 * Stable nanoid-shaped id for the row's primary key. 21 chars of
 * URL-safe base62, ~125 bits of entropy , collision odds are
 * astronomically small for the volumes a personal-keys table sees.
 */
export function generateKeyId(): string {
  return generateBase62(21);
}
