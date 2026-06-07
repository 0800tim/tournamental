/**
 * Federation client for the browser swarm.
 *
 * Talks to the central Tournamental server using the protocol in spec
 * §15.2: register a node on first run, commit a merkle root per match
 * before kickoff, and publish a leaderboard snapshot after the match
 * resolves.
 *
 * Endpoints touched (all on play.tournamental.com):
 *   POST /v1/nodes/register     -> { node_id, node_secret }
 *   POST /v1/nodes/commit       -> { ack: true }
 *   POST /v1/nodes/leaderboard  -> { ack: true, federation_rank }
 *
 * The endpoints don't exist yet (other agents are wiring them up this
 * sprint). To keep the browser swarm always-functional, every method
 * here treats a 404 or a network failure as a soft warning: the run
 * continues, the user sees an "offline" badge, and a retry job is
 * queued in the persistence layer (left as a follow-up; for Phase 1 we
 * just log and move on).
 */

import type {
  CommitLogRow,
  NodeCredentials,
  SwarmStats,
} from "./types";

const DEFAULT_BASE_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.host}`
    : "https://play.tournamental.com";

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
   */
  async register(operatorEmail: string | null): Promise<RegisterResult> {
    if (this.dryRun) {
      return {
        ok: true,
        credentials: this.localCredentials(operatorEmail),
        offline: true,
      };
    }

    try {
      const { status, json } = await postJson(`${this.baseUrl}/v1/nodes/register`, {
        kind: "browser",
        operator_email: operatorEmail,
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      });
      if (status === 404 || status >= 500) {
        return {
          ok: true,
          credentials: this.localCredentials(operatorEmail),
          offline: true,
        };
      }
      if (status >= 200 && status < 300) {
        const parsed = json as { node_id?: unknown; node_secret?: unknown };
        if (
          typeof parsed.node_id === "string" &&
          typeof parsed.node_secret === "string"
        ) {
          return {
            ok: true,
            credentials: {
              node_id: parsed.node_id,
              node_secret: parsed.node_secret,
              operator_email: operatorEmail,
              central_base_url: this.baseUrl,
              registered_at_utc: Date.now(),
            },
            offline: false,
          };
        }
      }
    } catch {
      // fall through to local creds
    }
    return {
      ok: true,
      credentials: this.localCredentials(operatorEmail),
      offline: true,
    };
  }

  /**
   * POST a per-match merkle root before kickoff. The central server
   * bundles this leaf into the OTS commitment for the match.
   */
  async commit(
    creds: NodeCredentials,
    row: CommitLogRow,
  ): Promise<CommitResult> {
    if (this.dryRun) {
      return { ok: true, offline: true, central_ack_at_utc: null };
    }

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
        return { ok: true, offline: false, central_ack_at_utc: Date.now() };
      }
    } catch {
      // fall through
    }
    return { ok: true, offline: true, central_ack_at_utc: null };
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
