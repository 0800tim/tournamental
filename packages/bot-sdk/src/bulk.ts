/**
 * Low-level bulk submission helper.
 *
 * Power users (e.g. swarm operators batching across many bots) can call
 * `submitBulk` directly without instantiating a `Bot` per id. Matches the
 * `POST /v1/picks/bulk` contract verbatim.
 *
 * The endpoint caps at 10,000 picks and 1,000 bots per request. The helper
 * does not enforce this client-side because the server will reject
 * over-cap requests with a single 400 and a clear error body; we'd rather
 * surface that than silently re-shape the caller's intent.
 */

import { postWithRetry, type ClientOpts } from "./client.js";
import type { BulkResponse, BulkSubmission } from "./types.js";

export const BULK_PATH = "/v1/picks/bulk";

export interface SubmitBulkOpts extends ClientOpts {
  tournamentId?: string;
}

/**
 * POST a fully-formed BulkSubmission to the bulk-insert endpoint.
 */
export async function submitBulk(
  opts: ClientOpts,
  body: BulkSubmission,
): Promise<BulkResponse> {
  return postWithRetry<BulkResponse>(opts, BULK_PATH, body);
}

/**
 * Convenience: takes a tournament id + an array of (bot_id, picks) and
 * constructs the BulkSubmission for you.
 */
export async function submitBulkPicks(
  opts: SubmitBulkOpts,
  submissions: BulkSubmission["submissions"],
): Promise<BulkResponse> {
  const body: BulkSubmission = {
    tournament_id: opts.tournamentId ?? "fifa-wc-2026",
    submissions,
  };
  return submitBulk(opts, body);
}
