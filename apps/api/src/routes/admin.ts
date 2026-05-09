/**
 * Admin API surface — `/v1/admin/*` routes.
 *
 * STATUS: scaffold + verifier. The route handlers are stubs that respond
 *         with deterministic mock data so the admin dashboard can be
 *         developed and tested end-to-end before the canonical data
 *         pipeline is plumbed in. Each handler is annotated with the
 *         eventual data source (Postgres table or Redis key) so the
 *         API agent can flesh them out without re-deciding shape.
 *
 * Auth: every request must carry a Bearer JWT minted by `apps/admin`
 *       (HS256, audience=`vtorn-api-admin`, ttl 60s) signed with the
 *       shared `ADMIN_JWT_SECRET`. The verifier below MUST be wired
 *       into `server.ts` *before* registering these routes.
 *
 * Mounting (in apps/api/src/server.ts):
 *
 *   import { registerAdmin } from './routes/admin.js';
 *   await registerAdmin(app);
 *
 * Endpoints:
 *
 *   GET  /v1/admin/overview
 *   GET  /v1/admin/users?q=&page=
 *   GET  /v1/admin/users/:id
 *   POST /v1/admin/users/:id/ban         body: { reason }
 *   POST /v1/admin/users/:id/unban
 *   GET  /v1/admin/syndicates?q=&status=
 *   GET  /v1/admin/syndicates/:slug
 *   GET  /v1/admin/tournaments
 *   GET  /v1/admin/fixtures
 *   GET  /v1/admin/content
 *   GET  /v1/admin/affiliate/clicks?period=24h|7d|30d
 *   GET  /v1/admin/affiliate/conversions?period=24h|7d|30d
 *   GET  /v1/admin/analytics/funnel?from=&to=
 *   GET  /v1/admin/feature-flags
 *   POST /v1/admin/feature-flags/:key    body: { enabled, geo_overrides? }
 *   GET  /v1/admin/api-keys
 *   POST /v1/admin/api-keys/:id/revoke
 *   GET  /v1/admin/audit-log?from=&to=
 *
 * Audit: every write writes a row into `admin_audit_log` (see
 * migrations/0001_admin_tables.sql) with actor_email, actor_role,
 * before, after.
 */

export const ADMIN_ROUTES_VERSION = "0.1.0-stub";

export interface AdminClaims {
  email: string;
  role: "super-admin" | "mod" | "viewer";
}

/**
 * Pseudocode for the eventual Fastify registration. Concrete impl is
 * blocked on the apps/api server shell landing on main.
 *
 *   import type { FastifyInstance } from 'fastify';
 *   import { jwtVerify } from 'jose';
 *
 *   export async function registerAdmin(app: FastifyInstance) {
 *     const secret = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET!);
 *
 *     app.addHook('preHandler', async (req, reply) => {
 *       if (!req.url.startsWith('/v1/admin/')) return;
 *       const auth = req.headers.authorization ?? '';
 *       const m = /^Bearer (.+)$/.exec(auth);
 *       if (!m) return reply.code(401).send({ error: 'unauth' });
 *       try {
 *         const { payload } = await jwtVerify(m[1], secret, { audience: 'vtorn-api-admin' });
 *         (req as any).admin = { email: payload.email, role: payload.role };
 *       } catch {
 *         return reply.code(401).send({ error: 'invalid_token' });
 *       }
 *     });
 *
 *     app.get('/v1/admin/overview', overviewHandler);
 *     app.get('/v1/admin/users', usersListHandler);
 *     // ... etc
 *   }
 */
