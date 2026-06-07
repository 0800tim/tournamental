/**
 * POST /v1/bots/keys/issue , service-to-service Bot Arena key issuance.
 *
 * The Next.js web proxy (`apps/web/app/api/v1/bots/keys/route.ts`)
 * resolves the inbound session, looks up the verified email on the user
 * record, then forwards an issuance request here with a shared-secret
 * header. The shared secret lives in the env var
 * `GAME_BOT_KEYS_SHARED_SECRET` on both ends and is rotated by ops.
 *
 * Why not just call `/v1/me/api-keys`? Because that surface requires a
 * verified Supabase JWT, and the new SMS-OTP / Telegram auth flows on
 * vtorn-dev do not mint Supabase sessions. The shared-secret tunnel
 * lets the cookie-based session on the web side prove identity
 * server-side and then issue a Bot Arena key without dragging
 * Supabase into the path.
 *
 * Request:
 *   { owner_email: string, owner_user_id?: string, label?: string }
 *
 * Response (200):
 *   { api_key, key_hash, owner_email, label, quota_bots,
 *     quota_picks_per_hour, created_at }
 *
 * Errors:
 *   401 missing_secret | invalid_secret   , shared secret missing or wrong
 *   400 invalid_email | label_too_long    , payload validation
 *   500 issue_failed                      , DB write blew up
 *
 * Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.3
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { GameStore } from "../store/db.js";

const MAX_LABEL_LEN = 80;

const IssueBodySchema = z
  .object({
    owner_email: z.string().email().max(254),
    owner_user_id: z.string().max(128).optional(),
    label: z.string().max(MAX_LABEL_LEN).optional(),
  })
  .strict();

export interface BotsKeysIssueRoutesDeps {
  readonly store: GameStore;
  readonly nowMs?: () => number;
  /**
   * Override the shared secret (tests pass a known value). Falls back to
   * `process.env.GAME_BOT_KEYS_SHARED_SECRET` at request time so a
   * mid-process env mutation in tests is picked up.
   */
  readonly sharedSecret?: string | null;
}

function readSecret(req: FastifyRequest): string | null {
  const h = req.headers["x-bot-keys-shared-secret"];
  if (typeof h !== "string") return null;
  const v = h.trim();
  return v.length > 0 ? v : null;
}

function timingSafeEqualString(a: string, b: string): boolean {
  // Constant-time-ish compare. Length differences early-exit (the
  // attacker already knows the length of their own input), but the
  // per-character comparison still walks the full string so we don't
  // leak the matched-prefix length.
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function registerBotsKeysIssueRoute(
  app: FastifyInstance,
  deps: BotsKeysIssueRoutesDeps,
): Promise<void> {
  app.post("/v1/bots/keys/issue", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");

    const expected =
      deps.sharedSecret !== undefined && deps.sharedSecret !== null
        ? deps.sharedSecret
        : process.env.GAME_BOT_KEYS_SHARED_SECRET ?? "";
    if (!expected) {
      // Fail closed: refuse to issue keys when the env var is not set.
      // This prevents an accidentally-deployed-without-secret build
      // from being a free key-minting endpoint.
      return reply.code(503).send({
        error: "issuance_disabled",
        message:
          "GAME_BOT_KEYS_SHARED_SECRET is not configured on this game-service build",
      });
    }
    const presented = readSecret(req);
    if (!presented) {
      return reply.code(401).send({ error: "missing_secret" });
    }
    if (!timingSafeEqualString(presented, expected)) {
      return reply.code(401).send({ error: "invalid_secret" });
    }

    const parsed = IssueBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      // Map the most common single-field failures to the existing
      // error codes the web proxy understands so the UX matches the
      // old Supabase path 1:1.
      const fieldErrors = flat.fieldErrors as Record<string, unknown>;
      if (fieldErrors.owner_email) {
        return reply.code(400).send({ error: "invalid_email" });
      }
      if (fieldErrors.label) {
        return reply.code(400).send({ error: "label_too_long" });
      }
      return reply
        .code(400)
        .send({ error: "invalid_payload", detail: flat });
    }
    const { owner_email, label } = parsed.data;

    try {
      const now = deps.nowMs ? deps.nowMs() : undefined;
      const issued = deps.store.apiKeys.issue({
        owner_email,
        label: label ?? null,
        ...(now !== undefined ? { now } : {}),
      });
      return reply.code(200).send({
        api_key: issued.api_key,
        key_hash: issued.key_hash,
        owner_email: issued.owner_email,
        label: issued.label,
        quota_bots: issued.quota_bots,
        quota_picks_per_hour: issued.quota_picks_per_hour,
        created_at: issued.created_at,
      });
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "bots_keys_issue_failed",
      );
      return reply.code(500).send({ error: "issue_failed" });
    }
  });
}
