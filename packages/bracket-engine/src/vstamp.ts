/**
 * VStamp — content-hashed prediction-receipt envelope.
 *
 * Per `docs/17-vstamp-and-prediction-iq.md`, every locked prediction gets
 * a verifiable receipt. v0.1 uses a server-side signing key (HMAC-SHA-256)
 * — the same primitive the API service will adopt before the on-chain
 * lane lights up (per `docs/21`). The signing key MUST live in the API
 * service's secret store at:
 *
 *   apps/api/.env  →  BRACKET_VSTAMP_SIGNING_KEY (32+ random bytes,
 *                     base64url-encoded; rotated annually).
 *
 * For the client-side bracket engine running in the browser, the user's
 * bracket is sent to the API and the signature is computed there. This
 * module exposes both the hash function (which the browser can call to
 * preview the receipt) and the sign/verify functions (which the API and
 * any server-side replay tools call).
 *
 * Why HMAC and not asymmetric? In v0.1 we want a single trust boundary
 * (the platform). The on-chain version (per `docs/21`) replaces this with
 * an Ed25519 keypair whose public key is anchored on-chain. The API
 * surface here — `signBracket(bracket, prediction, signerKey)` — stays
 * the same; only the internals change.
 *
 * Determinism: the same (tournament_id, prediction, signerKey) always
 * produces the same envelope.
 */

import { createHash, createHmac } from "node:crypto";

import type { BracketPrediction } from "./tournament.js";

export interface VStampEnvelope {
  readonly v: 1;
  readonly tournament_id: string;
  readonly user_id: string;
  readonly content_hash: string; // sha256 hex of the canonical JSON
  readonly created_at_utc: string;
  readonly signature: string; // hex-encoded HMAC-SHA-256(content_hash || created_at_utc)
  readonly key_id: string; // identifies the rotation slot, e.g. "vt-2026"
}

/**
 * Canonical-JSON serialiser. Property keys sorted alphabetically at every
 * level; arrays preserve order; no whitespace. This is what gets hashed.
 *
 * NOTE: by design we hash the *prediction* (groups, knockouts, locks),
 * not the timestamp. Otherwise the hash would change every time the user
 * tweaked an unrelated field. The signature pulls in the timestamp.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in canonicalJSON");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k]))
        .join(",") +
      "}"
    );
  }
  throw new Error("unsupported value in canonicalJSON: " + typeof value);
}

/**
 * Hash a prediction's content. Excludes the user's `updated_at_utc` from
 * the hashed surface (otherwise UI re-renders that touch the prediction
 * would change the hash without any meaningful pick change).
 */
export function hashBracket(prediction: BracketPrediction): string {
  // Project the prediction down to the fields that define the bracket's
  // *content*. Lock states are NOT part of the hash — they're part of the
  // signature surface (a re-lock with different odds creates a new
  // envelope but doesn't break the bracket's identity).
  const projection = {
    tournament_id: prediction.tournament_id,
    user_id: prediction.user_id,
    groups: prediction.groups.map((g) => ({
      group_id: g.group_id,
      order: [...g.order],
    })),
    best_thirds: [...prediction.best_thirds],
    best_fourths: [...prediction.best_fourths],
    knockouts: prediction.knockouts
      .slice()
      .sort((a, b) => a.match_id.localeCompare(b.match_id))
      .map((k) => ({ match_id: k.match_id, winner: k.winner })),
  };
  return createHash("sha256").update(canonicalJSON(projection)).digest("hex");
}

export interface SignerKey {
  readonly key_id: string;
  /** 32+ raw bytes. */
  readonly bytes: Uint8Array;
}

export interface SignBracketOptions {
  /** ISO-8601. Defaults to `prediction.updated_at_utc` for determinism in tests. */
  readonly now_utc?: string;
}

/**
 * Sign a bracket prediction. Returns the full envelope. The same input
 * always produces the same envelope: signature = HMAC-SHA-256 over
 * `content_hash + "|" + created_at_utc`.
 */
export function signBracket(
  prediction: BracketPrediction,
  signerKey: SignerKey,
  options: SignBracketOptions = {},
): VStampEnvelope {
  const content_hash = hashBracket(prediction);
  const created_at_utc = options.now_utc ?? prediction.updated_at_utc;
  const mac = createHmac("sha256", Buffer.from(signerKey.bytes));
  mac.update(content_hash + "|" + created_at_utc);
  return {
    v: 1,
    tournament_id: prediction.tournament_id,
    user_id: prediction.user_id,
    content_hash,
    created_at_utc,
    signature: mac.digest("hex"),
    key_id: signerKey.key_id,
  };
}

/**
 * Verify an envelope against a prediction. Returns true if the signature
 * is correct and the content hash matches the prediction.
 */
export function verifyBracket(
  envelope: VStampEnvelope,
  prediction: BracketPrediction,
  signerKey: SignerKey,
): boolean {
  if (envelope.tournament_id !== prediction.tournament_id) return false;
  if (envelope.user_id !== prediction.user_id) return false;
  if (envelope.key_id !== signerKey.key_id) return false;
  const expected_hash = hashBracket(prediction);
  if (expected_hash !== envelope.content_hash) return false;
  const mac = createHmac("sha256", Buffer.from(signerKey.bytes));
  mac.update(envelope.content_hash + "|" + envelope.created_at_utc);
  // constant-time-ish hex compare
  const expected = mac.digest("hex");
  if (expected.length !== envelope.signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
  }
  return diff === 0;
}
