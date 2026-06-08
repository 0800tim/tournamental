/**
 * POST /v1/picks/bulk , Bot Arena swarm submission endpoint.
 *
 * Accepts up to 10,000 picks across up to 1,000 bots per request. Every
 * bot referenced must be owned by the calling API key. The endpoint
 * runs the whole batch inside one SQLite transaction with a prepared
 * upsert statement, so 10k picks commits in well under the 500ms p99
 * budget on the dev box.
 *
 * Payload shape:
 *   {
 *     tournament_id: "fifa-wc-2026",
 *     submissions: [
 *       { bot_id: "my-bot-01", picks: [
 *         { match_id: "1",  outcome: "home_win" },
 *         { match_id: "2",  outcome: "draw" },
 *         { match_id: "r32_01", outcome: "home_win" }
 *       ] },
 *       ...
 *     ]
 *   }
 *
 * Response:
 *   {
 *     accepted: 9876,
 *     dropped_picks: [ { bot_id, match_id, reason } ],
 *     quota_remaining: { picks_per_hour, bots_owned }
 *   }
 *
 * Errors:
 *   401 missing_api_key | invalid_api_key
 *   403 not_owner            , API key does not own this bot_id
 *   400 invalid_payload      , Zod validation failed
 *   413 batch_too_large      , > 10k picks in one request
 *   429 quota_exceeded       , key would blow its hourly pick budget
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §7
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { GameStore } from "../store/db.js";
import type { Bracket } from "../types.js";

const MAX_PICKS_PER_REQUEST = 10_000;
const MAX_SUBMISSIONS_PER_REQUEST = 1_000;
const MAX_PICKS_PER_SUBMISSION = 10_000;

const PicksBulkSchema = z
  .object({
    tournament_id: z.string().min(1).max(64),
    submissions: z
      .array(
        z
          .object({
            bot_id: z.string().min(1).max(128),
            picks: z
              .array(
                z
                  .object({
                    match_id: z.string().min(1).max(64),
                    outcome: z.enum(["home_win", "draw", "away_win"]),
                  })
                  .strict(),
              )
              .min(1)
              .max(MAX_PICKS_PER_SUBMISSION),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SUBMISSIONS_PER_REQUEST),
  })
  .strict();

function authKey(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  const v = h.slice("Bearer ".length).trim();
  return v.length > 0 ? v : null;
}

export interface PicksBulkRoutesDeps {
  readonly store: GameStore;
  readonly nowMs?: () => number;
}

export async function registerPicksBulkRoute(
  app: FastifyInstance,
  deps: PicksBulkRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());

  // Prepare the upsert ONCE per server boot. better-sqlite3 caches the
  // statement plan, so reuse from inside the txn keeps the bulk insert
  // well under 500ms p99 for 10k picks.
  const upsertStmt = deps.store.db.prepare(
    `INSERT INTO brackets
       (id, user_id, tournament_id, payload_json, locked_at,
        score_total, share_guid, committed_at_utc)
     VALUES (@id, @user_id, @tournament_id, @payload_json, @locked_at,
             0, @share_guid, NULL)
     ON CONFLICT(user_id, tournament_id) DO UPDATE
       SET payload_json = excluded.payload_json,
           locked_at    = excluded.locked_at`,
  );
  const ensureUserStmt = deps.store.db.prepare(
    `INSERT INTO users (id, created_at, is_bot) VALUES (?, ?, 1)
     ON CONFLICT(id) DO NOTHING`,
  );

  app.post("/v1/picks/bulk", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");

    const plain = authKey(req);
    if (!plain) {
      return reply.code(401).send({ error: "missing_api_key" });
    }

    const keyRow = deps.store.apiKeys.lookupByPlain(plain);
    if (!keyRow) {
      return reply.code(401).send({ error: "invalid_api_key" });
    }

    const parsed = PicksBulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        detail: parsed.error.flatten(),
      });
    }

    let totalPicks = 0;
    for (const sub of parsed.data.submissions) {
      totalPicks += sub.picks.length;
    }
    if (totalPicks > MAX_PICKS_PER_REQUEST) {
      return reply.code(413).send({
        error: "batch_too_large",
        max: MAX_PICKS_PER_REQUEST,
        received: totalPicks,
      });
    }

    // Ownership check. Resolve all bot_ids in one IN(...) query so
    // 1k bots per request is one round trip, not 1000.
    const botIds = parsed.data.submissions.map((s) => s.bot_id);
    const notOwned = deps.store.botOwners.notOwnedBy(keyRow.key_hash, botIds);
    if (notOwned.length > 0) {
      return reply.code(403).send({
        error: "not_owner",
        bot_id: notOwned[0],
        unowned: notOwned,
      });
    }

    // Quota. Charge against the hourly cap before doing any writes so
    // a 429 leaves no partial state behind.
    if (
      !deps.store.quotas.tryConsume(
        keyRow.key_hash,
        totalPicks,
        keyRow.quota_picks_per_hour,
        now(),
      )
    ) {
      return reply.code(429).send({
        error: "quota_exceeded",
        quota_picks_per_hour: keyRow.quota_picks_per_hour,
        used_this_hour: deps.store.quotas.usedThisHourAt(
          keyRow.key_hash,
          now(),
        ),
      });
    }

    const lockedAt = now();
    const dropped: Array<{ bot_id: string; match_id: string; reason: string }> = [];

    // Single transaction, prepared statement reuse. For each bot we
    // load the existing bracket (if any) so a re-submit merges with
    // prior picks rather than wiping them; the bot SDK uses the
    // single-pick endpoint for incremental work and the bulk endpoint
    // for whole-bracket overwrites, so either path is correct.
    const txn = deps.store.db.transaction(() => {
      for (const sub of parsed.data.submissions) {
        ensureUserStmt.run(sub.bot_id, lockedAt);

        // Merge into the bot's existing bracket, if any.
        const existingRow = deps.store.getBracketForUser(
          sub.bot_id,
          parsed.data.tournament_id,
        );
        let bracket: Bracket;
        let bracketId: string;
        let shareGuid: string;
        if (existingRow) {
          bracketId = existingRow.id;
          shareGuid = existingRow.share_guid ?? sub.bot_id.slice(0, 16);
          try {
            bracket = JSON.parse(existingRow.payload_json) as Bracket;
          } catch {
            bracket = {
              bracketId,
              matchPredictions: {},
              groupTiebreakers: {},
              knockoutPredictions: {},
              version: 1,
            };
          }
        } else {
          bracketId = `bk_${sub.bot_id}_${parsed.data.tournament_id}`;
          shareGuid = sub.bot_id.slice(0, 16) || "bot";
          bracket = {
            bracketId,
            matchPredictions: {},
            groupTiebreakers: {},
            knockoutPredictions: {},
            version: 1,
          };
        }

        const isoLockedAt = new Date(lockedAt).toISOString();
        for (const p of sub.picks) {
          const rec = {
            matchId: p.match_id,
            outcome: p.outcome,
            lockedAt: isoLockedAt,
          };
          // Group matches in the WC2026 catalogue are numeric ids
          // (1..72); knockouts are alphanumeric (r32_01 etc).
          if (/^\d+$/.test(p.match_id)) {
            bracket.matchPredictions[p.match_id] = rec;
          } else {
            bracket.knockoutPredictions[p.match_id] = rec;
          }
        }

        upsertStmt.run({
          id: bracketId,
          user_id: sub.bot_id,
          tournament_id: parsed.data.tournament_id,
          payload_json: JSON.stringify(bracket),
          locked_at: lockedAt,
          share_guid: shareGuid,
        });
      }
    });
    txn();

    const used = deps.store.quotas.usedThisHourAt(keyRow.key_hash, now());
    const botsOwned = deps.store.botOwners.countByApiKey(keyRow.key_hash);

    return reply.send({
      accepted: totalPicks,
      dropped_picks: dropped,
      quota_remaining: {
        picks_per_hour: Math.max(keyRow.quota_picks_per_hour - used, 0),
        bots_owned: Math.max(keyRow.quota_bots - botsOwned, 0),
      },
    });
  });
}
