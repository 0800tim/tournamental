/**
 * Browser-swarm federation endpoints.
 *
 *   POST /v1/swarm/commit         , persist a swarm summary + submit
 *                                   merkle root to ≥3 OTS calendars
 *   GET  /v1/swarm/leaderboard    , cross-swarm ranked claim list
 *   GET  /v1/swarm/proof/:root    , metadata for the OTS proof of one
 *                                   merkle root, with download links
 *   GET  /v1/swarm/proof/:root/file/:calendar.ots
 *                                 , downloadable .ots file produced
 *                                   from the upgraded (or pending)
 *                                   calendar payload
 *
 * Auth model:
 *   /commit accepts EITHER an authenticated federated-node bearer
 *   (the same tnm_-prefixed key minted by /v1/nodes/register) OR an
 *   anonymous submission with `node_id="browser-..."` and a one-shot
 *   ed-format node_secret echoed back. Browser tabs are not gated
 *   because the marginal cost of a swarm-claim row is small and the
 *   merkle root is the audit anchor regardless. The leaderboard route
 *   is fully public.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  buildOtsFile,
  bytesToHex,
  hexToBytes,
  submitToCalendars,
  DEFAULT_CALENDARS,
} from "../lib/ots-calendar.js";
import type { GameStore } from "../store/db.js";
import type { PendingCalendarBlob } from "../store/swarm-claims.js";

const HEX_64 = /^[0-9a-f]{64}$/;
// Browser tabs prefix node_id with "browser-" (see federation.ts
// localCredentials()); central-side nodes use "node_<hex>".
const NODE_ID_RE = /^(browser-[0-9a-f]+|node_[0-9a-f]+)$/;
const RUN_ID_RE = /^[A-Za-z0-9_\-]{4,80}$/;
const CALENDAR_RE = /^[a-z0-9-]+$/;

const TopNClaimSchema = z
  .object({
    bot_index: z.number().int().min(0).max(1_000_000_000),
    claimed_score: z.number().finite(),
    picks_count: z.number().int().min(0).max(1_000_000),
  })
  .strict();

const CommitSchema = z
  .object({
    node_id: z.string().regex(NODE_ID_RE),
    run_id: z.string().regex(RUN_ID_RE),
    master_seed: z.string().min(1).max(256),
    strategy: z.string().min(1).max(64).default("chalk-v1"),
    total_bots: z.number().int().min(1).max(1_000_000_000),
    merkle_root: z.string().regex(HEX_64),
    top_n_claim: TopNClaimSchema,
    started_at: z.number().int(),
    finished_at: z.number().int(),
  })
  .strict();

const LeaderboardQuerySchema = z
  .object({
    limit: z
      .union([z.string(), z.number()])
      .transform((v) => Number(v))
      .pipe(z.number().int().min(1).max(1000))
      .optional(),
  })
  .strict();

export interface SwarmRoutesDeps {
  readonly store: GameStore;
  readonly nowMs?: () => number;
  /** Override the OTS calendar list (tests). */
  readonly otsCalendars?: readonly string[];
  /** Inject fetch (tests). */
  readonly otsFetch?: typeof fetch;
  /** Per-request OTS timeout in ms. */
  readonly otsTimeoutMs?: number;
  /** Disable network OTS submission (tests). When true, /commit
   *  persists with empty pending blobs and `ots_status='failed'`. */
  readonly disableOts?: boolean;
  /** Base URL used to build absolute ots_proof_url links. */
  readonly publicBaseUrl?: string;
}

function calendarSlug(url: string): string {
  // Slugify the calendar hostname so it's safe in URL paths.
  // a.lt.opentimestamps.org -> a-lt-opentimestamps-org
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/\./g, "-");
  } catch {
    return url
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/g, "-");
  }
}

function rebuildCalendarUrl(slug: string, fallback: readonly string[]): string | null {
  for (const url of fallback) {
    if (calendarSlug(url) === slug) return url;
  }
  return null;
}

export async function registerSwarmRoutes(
  app: FastifyInstance,
  deps: SwarmRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());
  const calendars = deps.otsCalendars ?? DEFAULT_CALENDARS;
  const publicBaseUrl = (deps.publicBaseUrl ?? "").replace(/\/$/, "");

  const buildProofUrl = (rootHex: string): string =>
    `${publicBaseUrl}/v1/swarm/proof/${rootHex}`;

  app.post("/v1/swarm/commit", async (req: FastifyRequest, reply) => {
    reply.header("Cache-Control", "private, no-store");

    const parsed = CommitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        detail: parsed.error.flatten(),
      });
    }

    let pending: PendingCalendarBlob[] = [];
    let otsStatus: "pending" | "failed" = "failed";
    if (!deps.disableOts) {
      try {
        const digest = hexToBytes(parsed.data.merkle_root);
        const { successes } = await submitToCalendars(digest, {
          calendars,
          timeoutMs: deps.otsTimeoutMs,
          fetchImpl: deps.otsFetch,
        });
        pending = successes.map((s) => ({
          calendar_url: s.calendar_url,
          pending_bytes_hex: bytesToHex(s.pending_bytes),
          submitted_at: s.submitted_at,
        }));
        if (pending.length > 0) otsStatus = "pending";
      } catch {
        pending = [];
        otsStatus = "failed";
      }
    }

    const claim = deps.store.swarmClaims.upsert({
      node_id: parsed.data.node_id,
      run_id: parsed.data.run_id,
      master_seed: parsed.data.master_seed,
      strategy: parsed.data.strategy,
      total_bots: parsed.data.total_bots,
      merkle_root: parsed.data.merkle_root,
      top_n_claim: parsed.data.top_n_claim,
      started_at: parsed.data.started_at,
      finished_at: parsed.data.finished_at,
      pending_calendar_blobs: pending,
      ots_status: otsStatus,
      now: now(),
    });

    return reply.code(201).send({
      node_id: claim.node_id,
      run_id: claim.run_id,
      merkle_root: claim.merkle_root,
      ots_status: claim.ots_status,
      pending_calendars: pending.map((p) => p.calendar_url),
      ots_proof_url: buildProofUrl(claim.merkle_root),
      submitted_at: claim.submitted_at,
    });
  });

  /**
   * GET /v1/swarm/totals
   *
   * Aggregate counts across the global swarm-claims table. Drives the
   * "N bots in the arena" chip on /bot-arena and gives every device
   * the same headline number within a 60s cache window. Tim 2026-06-08.
   *
   * Cache strategy:
   *   - In-memory result cache, 60s TTL: avoids a SQLite COUNT/SUM scan
   *     on every poll. The page polls every ~30s so the cache absorbs
   *     all but ~1 query per minute regardless of viewer count.
   *   - HTTP `Cache-Control: public, max-age=30, stale-while-revalidate=60`
   *     so the Cloudflare edge / browser also de-dups concurrent loads
   *     across the same device.
   */
  let totalsCache: {
    at_ms: number;
    body: {
      total_bots: number;
      total_swarms: number;
      total_devices: number;
      cached_at_utc: string;
    };
  } | null = null;
  const TOTALS_TTL_MS = 60_000;

  app.get("/v1/swarm/totals", async (_req, reply) => {
    const now = Date.now();
    if (!totalsCache || now - totalsCache.at_ms > TOTALS_TTL_MS) {
      const t = deps.store.swarmClaims.totals();
      totalsCache = {
        at_ms: now,
        body: {
          total_bots: t.total_bots,
          total_swarms: t.total_swarms,
          total_devices: t.total_devices,
          cached_at_utc: new Date(now).toISOString(),
        },
      };
    }
    reply.header(
      "Cache-Control",
      "public, max-age=30, stale-while-revalidate=60",
    );
    return totalsCache.body;
  });

  app.get("/v1/swarm/leaderboard", async (req, reply) => {
    const parsedQuery = LeaderboardQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "invalid_query",
        detail: parsedQuery.error.flatten(),
      });
    }
    const limit = parsedQuery.data.limit ?? 100;
    const rows = deps.store.swarmClaims.leaderboard(limit, buildProofUrl);
    reply.header(
      "Cache-Control",
      "public, max-age=30, stale-while-revalidate=60",
    );
    return { rows };
  });

  app.get("/v1/swarm/proof/:merkle_root", async (req, reply) => {
    const { merkle_root } = req.params as { merkle_root?: string };
    const root = (merkle_root ?? "").toLowerCase();
    if (!HEX_64.test(root)) {
      return reply.code(400).send({ error: "invalid_merkle_root" });
    }
    const row = deps.store.swarmClaims.getByMerkleRoot(root);
    if (!row) return reply.code(404).send({ error: "not_found" });
    const pending = deps.store.swarmClaims.parsePending(row);
    const claim = deps.store.swarmClaims.parseTopClaim(row);
    reply.header(
      "Cache-Control",
      row.ots_status === "confirmed"
        ? "public, max-age=86400, immutable"
        : "public, max-age=60, stale-while-revalidate=120",
    );
    return {
      merkle_root: row.merkle_root,
      node_id: row.node_id,
      run_id: row.run_id,
      master_seed: row.master_seed,
      strategy: row.strategy,
      total_bots: row.total_bots,
      top_n_claim: claim,
      ots_status: row.ots_status,
      submitted_at: row.submitted_at,
      finished_at: row.finished_at,
      // Pending calendars: every one of these has an .ots file
      // available (carrying the calendar attestation but no Bitcoin
      // attestation yet).
      pending_calendars: pending.map((p) => ({
        calendar_url: p.calendar_url,
        calendar_slug: calendarSlug(p.calendar_url),
        submitted_at: p.submitted_at,
        download_url:
          `${publicBaseUrl}/v1/swarm/proof/${row.merkle_root}` +
          `/file/${calendarSlug(p.calendar_url)}.ots`,
      })),
      // Confirmed file (with Bitcoin attestation) once the scheduler
      // has upgraded the proof.
      bitcoin_confirmed: row.ots_status === "confirmed",
      upgraded: row.ots_status === "confirmed"
        ? {
            calendar_url: row.upgraded_calendar_url,
            upgraded_at: row.upgraded_at,
            download_url:
              `${publicBaseUrl}/v1/swarm/proof/${row.merkle_root}/file/upgraded.ots`,
          }
        : null,
    };
  });

  app.get(
    "/v1/swarm/proof/:merkle_root/file/:filename",
    async (req, reply) => {
      const { merkle_root, filename } = req.params as {
        merkle_root?: string;
        filename?: string;
      };
      const root = (merkle_root ?? "").toLowerCase();
      const file = filename ?? "";
      if (!HEX_64.test(root)) {
        return reply.code(400).send({ error: "invalid_merkle_root" });
      }
      const row = deps.store.swarmClaims.getByMerkleRoot(root);
      if (!row) return reply.code(404).send({ error: "not_found" });
      const digest = hexToBytes(row.merkle_root);

      // upgraded.ots — Bitcoin-attested file (only if confirmed).
      if (file === "upgraded.ots") {
        if (row.ots_status !== "confirmed" || !row.upgraded_ots_hex) {
          return reply.code(409).send({
            error: "not_yet_confirmed",
            message:
              "Bitcoin attestation has not landed yet. Use one of the pending calendar files instead, or retry later.",
          });
        }
        const ts = hexToBytes(row.upgraded_ots_hex);
        const ots = buildOtsFile({
          digest,
          calendar_url: row.upgraded_calendar_url ?? "upgraded",
          timestamp_bytes: ts,
        });
        return sendOtsFile(reply, ots.bytes, `tournamental-${root.slice(0, 16)}.ots`, true);
      }

      // Per-calendar pending file, addressed as <slug>.ots.
      const match = /^([a-z0-9-]+)\.ots$/.exec(file);
      if (!match || !CALENDAR_RE.test(match[1]!)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const wantedSlug = match[1]!;
      const pending = deps.store.swarmClaims.parsePending(row);
      const blob = pending.find(
        (p) => calendarSlug(p.calendar_url) === wantedSlug,
      );
      if (!blob) {
        // Maybe the upgraded calendar matches but the file path used
        // its slug instead of "upgraded".
        if (
          row.upgraded_calendar_url &&
          calendarSlug(row.upgraded_calendar_url) === wantedSlug &&
          row.upgraded_ots_hex
        ) {
          const ts = hexToBytes(row.upgraded_ots_hex);
          const ots = buildOtsFile({
            digest,
            calendar_url: row.upgraded_calendar_url,
            timestamp_bytes: ts,
          });
          return sendOtsFile(
            reply,
            ots.bytes,
            `tournamental-${root.slice(0, 16)}-${wantedSlug}.ots`,
            true,
          );
        }
        // Also let `calendars` fallback (in case the slug came from
        // the default set and the row had no pending blob recorded).
        if (rebuildCalendarUrl(wantedSlug, calendars) === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return reply.code(404).send({ error: "no_pending_for_calendar" });
      }
      const ts = hexToBytes(blob.pending_bytes_hex);
      const ots = buildOtsFile({
        digest,
        calendar_url: blob.calendar_url,
        timestamp_bytes: ts,
      });
      return sendOtsFile(
        reply,
        ots.bytes,
        `tournamental-${root.slice(0, 16)}-${wantedSlug}.ots`,
        row.ots_status === "confirmed",
      );
    },
  );
}

function sendOtsFile(
  reply: FastifyReply,
  bytes: Uint8Array,
  filename: string,
  immutable: boolean,
): FastifyReply {
  reply.header("Content-Type", "application/vnd.opentimestamps.ots");
  reply.header("Content-Disposition", `attachment; filename="${filename}"`);
  reply.header(
    "Cache-Control",
    immutable
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300, stale-while-revalidate=600",
  );
  reply.code(200);
  return reply.send(Buffer.from(bytes));
}
