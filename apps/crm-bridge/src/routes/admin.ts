/**
 * POST /v1/admin/replay-failed — re-attempt every entry recorded in
 * `data/ghl-failed.jsonl`. Auth: `Authorization: Bearer ${CRM_ADMIN_TOKEN}`.
 *
 * Behaviour:
 *   1. Read the failed-log line-by-line.
 *   2. For each line, call `RealGhlClient.replayFailed(rec)`.
 *   3. Successes are removed from the log; failures are re-written.
 *   4. Respond with `{ attempted, succeeded, failed, residual }` so an
 *      admin UI can show a meaningful summary.
 *
 * The endpoint is a no-op (`501 not_supported`) when the bridge is
 * running with the mock backend — there's nothing to replay against
 * an in-memory log.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

import type { AppContext } from '../context.js';
import { RealGhlClient, type GhlFailedCallRecord } from '../lib/ghl-client.js';

export interface AdminRouteOptions {
  /** Path to the failed-call log; same path the RealGhlClient writes to. */
  failedLogPath: string | null;
  /** Bearer token required on the Authorization header. */
  adminToken: string | null;
}

export async function registerAdmin(
  app: FastifyInstance,
  ctx: AppContext,
  opts: AdminRouteOptions,
) {
  app.post('/v1/admin/replay-failed', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');

    if (!opts.adminToken) {
      reply.code(503);
      return { error: 'admin_token_not_configured' };
    }

    const auth = req.headers.authorization ?? '';
    const expected = `Bearer ${opts.adminToken}`;
    if (auth !== expected) {
      reply.code(401);
      return { error: 'unauthorized' };
    }

    if (!(ctx.ghl instanceof RealGhlClient)) {
      reply.code(501);
      return { error: 'replay_only_supported_on_real_backend' };
    }

    if (!opts.failedLogPath || !existsSync(opts.failedLogPath)) {
      return {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        residual: 0,
      };
    }

    const lines = readFileSync(opts.failedLogPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    let succeeded = 0;
    let failed = 0;
    const residual: string[] = [];

    for (const line of lines) {
      let rec: GhlFailedCallRecord;
      try {
        rec = JSON.parse(line) as GhlFailedCallRecord;
      } catch {
        // Malformed line — drop it; an admin can inspect git history.
        continue;
      }
      const result = await ctx.ghl.replayFailed(rec);
      if (result.ok) {
        succeeded += 1;
      } else {
        failed += 1;
        residual.push(line);
      }
    }

    // Rewrite the log with only the residual failures. Truncate when
    // everything succeeded so the next run is a fast no-op.
    writeFileSync(
      opts.failedLogPath,
      residual.length > 0 ? `${residual.join('\n')}\n` : '',
      'utf8',
    );

    return {
      attempted: lines.length,
      succeeded,
      failed,
      residual: residual.length,
    };
  });
}
