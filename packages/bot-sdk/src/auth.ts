/**
 * API key handling for the Tournamental Bot Arena.
 *
 * Keys are issued via the self-service /bots/keys page (see spec §6.3).
 * They are sent in the `Authorization: Bearer tnm_<key>` header.
 */

export interface AuthHeaders {
  Authorization: string;
}

/**
 * Build the auth header set for an API key. Throws on obviously-malformed
 * keys to fail fast in dev before the request hits the wire.
 */
export function authHeaders(apiKey: string): AuthHeaders {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("bot-sdk: apiKey is required");
  }
  if (apiKey.length < 8) {
    throw new Error("bot-sdk: apiKey looks malformed (length < 8)");
  }
  return { Authorization: `Bearer ${apiKey}` };
}
