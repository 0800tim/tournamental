import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Super-admin gate for write routes.
 *
 * The route handler calls `requireAdmin(ctx, req, reply)`; on failure the
 * function sends a 401 and returns `false` so the handler can early-return.
 * This avoids a Fastify preHandler dance while keeping the policy in one place.
 */
export function requireAdmin(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const provided = req.headers['x-drips-admin'];
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value || value !== ctx.adminSecret) {
    reply.code(401).header('Cache-Control', 'no-store').send({
      error: 'unauthorised',
      message: 'x-drips-admin header missing or incorrect',
    });
    return false;
  }
  return true;
}
