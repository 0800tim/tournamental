/**
 * Federation client for the browser swarm.
 *
 * Talks to the central Tournamental server using the protocol in spec
 * §15.6:
 *
 *   - On first run, registers a `browser` node (the credentials live
 *     in IndexedDB; we currently mint them locally because the central
 *     /v1/nodes/register flow requires an owner API key — for
 *     anonymous browser tabs we accept the lower trust model and
 *     surface the merkle root + claimed score directly to the
 *     /v1/swarm/commit endpoint).
 *
 *   - When a swarm run finishes, POSTs a single swarm summary to
 *     /v1/swarm/commit. The server persists it, submits the merkle
 *     root to ≥3 OpenTimestamps calendars, and returns the proof URL.
 *
 *   - The cross-swarm leaderboard read comes from
 *     GET /v1/swarm/leaderboard. We expose it as `fetchLeaderboard()`
 *     so the run page can show the user where they sit.
 *
 * The endpoints are non-authenticated for Phase 1 — the merkle root
 * is the audit anchor, and any operator who wants higher-trust
 * federation can register a node via /v1/nodes/register and use those
 * credentials separately.
 *
 * Network failures are absorbed: a failed commit is logged but never
 * blocks the swarm from finishing. The browser still has the merkle
 * root and the IndexedDB record; a future "Retry" button can re-POST
 * the summary without re-running the workers.
 */

import { MASTER_SEED } from "./regenerate";
import type {
  CommitLogRow,
  NodeCredentials,
  SwarmStats,
} from "./types";

const DEFAULT_BASE_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.host}`
    : "https://play.tournamental.com";

/**
 * Adapter shape for the swarm-summary payload the worker produces.
 *
 * Coordination note: A2's worker.ts emits a finished payload with
 * fields { master_seed?, total_bots, merkle_root, strategy?,
 * started_at?, finished_at?, top_N_claim? }. BrowserSwarm.tsx
 * composes the canonical shape before handing it to us via
 * `commitSwarmSummary()`. If the worker fields shift, the adapter
 * below maps them rather than asking A2 to change.
 */
export interface SwarmSummary {
  readonly node_id: string;
  readonly run_id: string;
  readonly master_seed: string;
  readonly strategy: string;
  readonly total_bots: number;
  readonly merkle_root: string;
  readonly started_at: number;
  readonly finished_at: number;
  readonly top_n_claim: {
    bot_index: number;
    claimed_score: number;
    picks_count: number;
  };
}

export interface CommitSwarmResult {
  readonly ok: boolean;
  readonly offline: boolean;
  readonly ots_proof_url: string | null;
  readonly ots_status: "pending" | "confirmed" | "failed" | null;
  readonly pending_calendars: readonly string[];
}

export interface FederationClientOpts {
  readonly base_url?: string;
  /** When true, never hit the network; useful for the dry-run test the
   *  done-criteria check runs in CI. */
  readonly dry_run?: boolean;
}

export interface RegisterResult {
  readonly ok: boolean;
  readonly credentials: NodeCredentials | null;
  readonly offline: boolean;
}

export interface CommitResult {
  readonly ok: boolean;
  readonly offline: boolean;
  readonly central_ack_at_utc: number | null;
}

export interface LeaderboardResult {
  readonly ok: boolean;
  readonly offline: boolean;
  readonly rank: number | null;
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly node_id_short: string;
  readonly bot_index: number;
  readonly claimed_score: number;
  readonly merkle_root: string;
  readonly ots_proof_url: string | null;
  readonly bitcoin_confirmed: boolean;
  readonly submitted_at: number;
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function getJson(
  url: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export class FederationClient {
  private readonly baseUrl: string;
  private readonly dryRun: boolean;

  constructor(opts: FederationClientOpts = {}) {
    this.baseUrl = opts.base_url ?? DEFAULT_BASE_URL;
    this.dryRun = opts.dry_run ?? false;
  }

  /**
   * Register this browser tab as a federated node. Idempotent if the
   * caller already has credentials from IndexedDB.
   *
   * The central /v1/nodes/register flow needs an owner API key, which
   * anonymous browser visitors don't have. We mint a deterministic
   * browser-only credential locally so the rest of the swarm flow has
   * a stable node_id, and rely on the merkle root + OTS proof as the
   * audit anchor instead of node-level auth.
   */
  async register(operatorEmail: string | null): Promise<RegisterResult> {
    // For Phase 1 we always mint locally for browser tabs. A future
    // signed-in flow can call /v1/nodes/register with the user's
    // owner key.
    return {
      ok: true,
      credentials: this.localCredentials(operatorEmail),
      offline: this.dryRun,
    };
  }

  /**
   * POST a per-match merkle root to the legacy /v1/nodes/commit
   * surface AND, when the row carries enough data, also POST a
   * swarm summary to /v1/swarm/commit so the OTS scheduler can pick
   * up the merkle root. The browser-swarm UI calls this once per run
   * for its representative first-match commit; that single call now
   * lands on both endpoints. New callers should prefer
   * `commitSwarmSummary()` directly when the full summary is
   * available.
   */
  async commit(
    creds: NodeCredentials,
    row: CommitLogRow,
  ): Promise<CommitResult> {
    if (this.dryRun) {
      return { ok: true, offline: true, central_ack_at_utc: null };
    }
    let ack: number | null = null;
    let offline = true;
    try {
      const { status } = await postJson(`${this.baseUrl}/v1/nodes/commit`, {
        node_id: creds.node_id,
        node_secret: creds.node_secret,
        match_id: row.match_id,
        merkle_root: row.merkle_root,
        bot_count: row.bot_count,
        kickoff_at: row.kickoff_at_utc,
      });
      if (status >= 200 && status < 300) {
        ack = Date.now();
        offline = false;
      }
    } catch {
      // fall through
    }

    // Opportunistic swarm summary submission. We don't know the
    // master_seed / run_id from a CommitLogRow, so we derive
    // reasonable defaults. The orchestrator (BrowserSwarm.tsx)
    // owns the canonical summary; this fallback is here purely so a
    // swarm-claim row lands and the OTS proof flow kicks in even
    // when no explicit summary call is made.
    if (/^[0-9a-f]{64}$/.test(row.merkle_root)) {
      const runId = `auto-${row.merkle_root.slice(0, 8)}-${row.match_id.replace(/[^A-Za-z0-9_\-]/g, "-").slice(0, 32)}`;
      const summary: SwarmSummary = {
        node_id: creds.node_id,
        run_id: runId,
        // Tim 2026-06-07: canonical browser MASTER_SEED so the
        // server can deterministically regenerate bots from
        // (master_seed, bot_index, strategy) during audit. The old
        // "auto:<node_id>" placeholder broke the regenerate-on-demand
        // promise documented in docs/30-browser-swarm-architecture.md.
        master_seed: MASTER_SEED,
        strategy: "chalk-v1",
        total_bots: row.bot_count,
        merkle_root: row.merkle_root,
        started_at: row.committed_at_utc,
        finished_at: row.committed_at_utc,
        top_n_claim: {
          bot_index: 0,
          claimed_score: 0,
          picks_count: row.bot_count,
        },
      };
      // Fire and forget; failures don't block the legacy ack.
      void this.commitSwarmSummary(summary).catch(() => {});
    }

    return { ok: true, offline, central_ack_at_utc: ack };
  }

  /**
   * POST a swarm summary to the new §15.6 surface. The server
   * persists the row, submits the merkle root to OpenTimestamps
   * calendars, and returns the proof URL.
   */
  async commitSwarmSummary(
    summary: SwarmSummary,
  ): Promise<CommitSwarmResult> {
    if (this.dryRun) {
      return {
        ok: true,
        offline: true,
        ots_proof_url: null,
        ots_status: null,
        pending_calendars: [],
      };
    }
    try {
      const { status, json } = await postJson(
        `${this.baseUrl}/v1/swarm/commit`,
        summary,
      );
      if (status >= 200 && status < 300) {
        const parsed = json as {
          ots_proof_url?: unknown;
          ots_status?: unknown;
          pending_calendars?: unknown;
        };
        const proofUrl =
          typeof parsed.ots_proof_url === "string"
            ? parsed.ots_proof_url
            : null;
        const status =
          parsed.ots_status === "pending" ||
          parsed.ots_status === "confirmed" ||
          parsed.ots_status === "failed"
            ? parsed.ots_status
            : null;
        const pending = Array.isArray(parsed.pending_calendars)
          ? (parsed.pending_calendars.filter(
              (x): x is string => typeof x === "string",
            ) as string[])
          : [];
        return {
          ok: true,
          offline: false,
          ots_proof_url: proofUrl,
          ots_status: status,
          pending_calendars: pending,
        };
      }
    } catch {
      // fall through
    }
    return {
      ok: true,
      offline: true,
      ots_proof_url: null,
      ots_status: null,
      pending_calendars: [],
    };
  }

  /**
   * POST a post-match leaderboard snapshot. Central merges this into
   * the federated public leaderboard view.
   */
  async leaderboard(
    creds: NodeCredentials,
    stats: SwarmStats,
    matchId: string,
  ): Promise<LeaderboardResult> {
    if (this.dryRun) {
      return { ok: true, offline: true, rank: null };
    }

    try {
      const { status, json } = await postJson(
        `${this.baseUrl}/v1/nodes/leaderboard`,
        {
          node_id: creds.node_id,
          node_secret: creds.node_secret,
          match_id: matchId,
          best_bot_score: stats.best_bot_score,
          bots_still_perfect: stats.bots_still_perfect,
          merkle_root: stats.merkle_root,
        },
      );
      if (status >= 200 && status < 300) {
        const parsed = json as { federation_rank?: unknown };
        const rank =
          typeof parsed.federation_rank === "number"
            ? parsed.federation_rank
            : null;
        return { ok: true, offline: false, rank };
      }
    } catch {
      // fall through
    }
    return { ok: true, offline: true, rank: null };
  }

  /**
   * GET the cross-swarm leaderboard. Returns null if the call fails;
   * caller should fall back to a local "you only" view.
   */
  async fetchLeaderboard(limit = 100): Promise<readonly LeaderboardEntry[] | null> {
    if (this.dryRun) return null;
    try {
      const { status, json } = await getJson(
        `${this.baseUrl}/v1/swarm/leaderboard?limit=${encodeURIComponent(limit)}`,
      );
      if (status >= 200 && status < 300) {
        const parsed = json as { rows?: unknown };
        if (Array.isArray(parsed.rows)) {
          return parsed.rows.filter(
            (r): r is LeaderboardEntry =>
              r != null && typeof r === "object" && "rank" in r,
          ) as LeaderboardEntry[];
        }
      }
    } catch {
      // fall through
    }
    return null;
  }

  /**
   * Publish an operator-keyed aggregate summary (A13).
   *
   * The operator_id is the sha256 hash of `apiKey`. The browser computes
   * the hash with WebCrypto and POSTs to
   * /v1/swarms/<operator_id>/summary with Bearer auth.
   *
   * Soft-fails on network errors and missing crypto so the user-facing
   * UI never blocks. Returns `{ ok, offline }` for callers that want
   * to badge a transient outage.
   */
  async publishOperatorSummary(
    apiKey: string,
    payload: {
      total_bots: number;
      bots_alive_after_match_n: Array<{ n: number; alive_count: number }>;
      best_bot_score: number;
      top_k: Array<{ bot_id: string; score: number; chalk_score: number }>;
      merkle_root: string;
      kickoff_at: number;
      generated_at: number;
    },
  ): Promise<{ ok: boolean; offline: boolean }> {
    if (this.dryRun) return { ok: true, offline: true };
    if (!apiKey || !/^tnm_/.test(apiKey)) return { ok: false, offline: false };
    let operatorId: string;
    try {
      operatorId = await sha256Hex(apiKey);
    } catch {
      return { ok: false, offline: true };
    }
    try {
      const res = await fetch(
        `${this.baseUrl}/v1/swarms/${operatorId}/summary`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        },
      );
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, offline: false };
      }
      return { ok: false, offline: false };
    } catch {
      return { ok: false, offline: true };
    }
  }

  private localCredentials(operatorEmail: string | null): NodeCredentials {
    const nodeId = `browser-${randomHex(8)}`;
    return {
      node_id: nodeId,
      node_secret: randomHex(32),
      operator_email: operatorEmail,
      central_base_url: this.baseUrl,
      registered_at_utc: Date.now(),
    };
  }
}

/**
 * Adapter that takes whatever the worker emits and turns it into the
 * canonical SwarmSummary shape. Defensive across naming variations
 * (camelCase vs snake_case, top_N vs top_n) so we don't need to
 * coordinate every field rename with the worker agent.
 */
export function adaptWorkerPayloadToSummary(args: {
  node_id: string;
  run_id: string;
  payload: Record<string, unknown>;
  master_seed_fallback: string;
  total_bots_fallback: number;
  merkle_root_fallback: string;
  started_at_fallback: number;
  finished_at_fallback: number;
}): SwarmSummary | null {
  const p = args.payload;
  const masterSeed =
    typeof p.master_seed === "string"
      ? p.master_seed
      : typeof p.masterSeed === "string"
        ? p.masterSeed
        : args.master_seed_fallback;
  const strategy =
    typeof p.strategy === "string" ? p.strategy : "chalk-v1";
  const totalBots =
    typeof p.total_bots === "number"
      ? p.total_bots
      : typeof p.totalBots === "number"
        ? p.totalBots
        : args.total_bots_fallback;
  const merkleRoot =
    typeof p.merkle_root === "string"
      ? p.merkle_root
      : typeof p.merkleRoot === "string"
        ? p.merkleRoot
        : args.merkle_root_fallback;
  const startedAt =
    typeof p.started_at === "number"
      ? p.started_at
      : typeof p.startedAt === "number"
        ? p.startedAt
        : args.started_at_fallback;
  const finishedAt =
    typeof p.finished_at === "number"
      ? p.finished_at
      : typeof p.finishedAt === "number"
        ? p.finishedAt
        : args.finished_at_fallback;

  // top_n_claim shape — accept both top_n_claim and top_N_claim.
  const claimRaw =
    (p.top_n_claim as Record<string, unknown> | undefined) ??
    (p.top_N_claim as Record<string, unknown> | undefined) ??
    (p.topNClaim as Record<string, unknown> | undefined);
  let claim: SwarmSummary["top_n_claim"];
  if (claimRaw && typeof claimRaw === "object") {
    claim = {
      bot_index:
        typeof claimRaw.bot_index === "number"
          ? (claimRaw.bot_index as number)
          : typeof claimRaw.botIndex === "number"
            ? (claimRaw.botIndex as number)
            : 0,
      claimed_score:
        typeof claimRaw.claimed_score === "number"
          ? (claimRaw.claimed_score as number)
          : typeof claimRaw.claimedScore === "number"
            ? (claimRaw.claimedScore as number)
            : 0,
      picks_count:
        typeof claimRaw.picks_count === "number"
          ? (claimRaw.picks_count as number)
          : typeof claimRaw.picksCount === "number"
            ? (claimRaw.picksCount as number)
            : 0,
    };
  } else {
    claim = { bot_index: 0, claimed_score: 0, picks_count: 0 };
  }

  // Validate the bits the server's Zod schema actually requires.
  if (!/^[0-9a-f]{64}$/.test(merkleRoot)) return null;
  if (totalBots <= 0) return null;
  if (!masterSeed) return null;

  return {
    node_id: args.node_id,
    run_id: args.run_id,
    master_seed: masterSeed,
    strategy,
    total_bots: totalBots,
    merkle_root: merkleRoot,
    started_at: startedAt,
    finished_at: finishedAt,
    top_n_claim: claim,
  };
}

/**
 * SHA-256 hex digest of `input`. Used to derive operator_id from an
 * api_key client-side so the URL path matches what the server
 * computes server-side (operator_id = sha256(api_key)).
 */
async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("subtle crypto not available");
  }
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < view.length; i++) hex += view[i]!.toString(16).padStart(2, "0");
  return hex;
}

function randomHex(bytes: number): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    let hex = "";
    for (let i = 0; i < buf.length; i++) hex += buf[i]!.toString(16).padStart(2, "0");
    return hex;
  }
  let hex = "";
  for (let i = 0; i < bytes; i++) {
    hex += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return hex;
}
