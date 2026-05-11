/**
 * Deterministic SHA-256 hashing for phone-number matching.
 *
 * Used in two flows:
 *   1. On signup with a phone-OTP, the server hashes the user's E.164
 *      phone and stores it in `user_profiles.whatsapp_phone_hash`.
 *   2. The friend-discovery client hashes every entry in the user's
 *      address book and POSTs the hashes to `/api/friends/discover/phone-match`.
 *      The server matches against existing rows; matched user_ids come back.
 *
 * Why SHA-256 + a server-side salt? A plain hash is a rainbow-table
 * target — every phone in E.164 maps to the same hash, and the search
 * space (~10^11 globally) is small. The salt makes the hash
 * Tournamental-specific; a stolen DB can't be cross-referenced against
 * another service's leaked hashes.
 *
 * The salt is **server-side only**, stored in Supabase Vault as
 * `SUPABASE_PHONE_HASH_SALT`. The client posts the raw E.164 phone (or
 * a list of them); the server salts + hashes; the client never sees
 * the salt. This is the "blind index" pattern.
 */

import { createHash } from "node:crypto";

/**
 * Canonicalise a phone number to E.164 digits before hashing.
 *
 *   "+64 21 999 000" → "+6421999000"
 *   "0021999000"     → unchanged (caller should hand us E.164 already
 *                     or this is the user's fault — we don't guess
 *                     country codes)
 *
 * The exception: if the input has no leading "+" but is all digits and
 * the caller passes a default country, we prepend it. For v1 we expect
 * the client to canonicalise before sending — this is a defensive
 * normaliser, not a parser.
 */
export function canonicaliseE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  // No leading "+" — accept only if it looks like E.164 already
  // (digits only, 8–15 chars). Otherwise return empty (signal to the
  // caller that the input wasn't a valid phone).
  if (/^\d{8,15}$/.test(cleaned)) return "+" + cleaned;
  return "";
}

/**
 * Hash a single canonicalised E.164 phone number. The salt **must** be
 * the same on both sides of the match (server-side; never sent to the
 * client). Returns lowercase hex SHA-256.
 */
export function hashPhone(e164: string, salt: string): string {
  if (!e164) return "";
  if (!salt) throw new Error("phone-hash: salt is required");
  return createHash("sha256").update(salt).update("\x00").update(e164).digest("hex");
}

/**
 * Bulk hash for the friend-discovery payload. Filters out invalid /
 * empty inputs. De-duplicates the output (a contact book often has
 * the same number under multiple labels).
 */
export function hashPhones(rawPhones: readonly string[], salt: string): string[] {
  const out = new Set<string>();
  for (const raw of rawPhones) {
    const e164 = canonicaliseE164(raw);
    if (!e164) continue;
    out.add(hashPhone(e164, salt));
  }
  return Array.from(out);
}
