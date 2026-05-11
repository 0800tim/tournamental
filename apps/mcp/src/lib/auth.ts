/**
 * Auth resolution for the MCP server.
 *
 * Public tools: no auth at all. Headers are ignored.
 *
 * User tools: prefer `Authorization: Bearer <user-api-key>`. The MCP
 * client (Claude Desktop, Cursor, etc.) is configured with a per-user
 * token in its `mcpServers` block and we forward it to the game
 * service's `/v1/me` endpoint to resolve to a user id. If the call
 * comes in stdio mode we additionally accept `userKey` inside the
 * tool's input - most stdio clients can't set HTTP headers.
 *
 * Admin tools: `X-Tournamental-Admin-Key: <key>` + IP allowlist from
 * env `TOURNAMENTAL_ADMIN_IPS` (comma-separated). In stdio mode we
 * accept `adminKey` in the tool input. The IP allowlist is enforced
 * only on the HTTP transport - stdio is implicitly local.
 */

import type { Tier } from './rate-limit.js';

export interface AuthContext {
  readonly ip: string | null;
  readonly userKey: string | null;
  readonly adminKey: string | null;
  readonly transport: 'stdio' | 'http';
}

export interface AuthDecision {
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
  /** Effective tier the call ran under (defaults to the requested tier on success). */
  readonly tier: Tier;
}

export interface AuthPolicy {
  /** Required tier for the tool. */
  readonly tier: Tier;
  /** Admin IP allowlist (HTTP transport only). */
  readonly adminIps?: ReadonlySet<string>;
}

export function checkAuth(ctx: AuthContext, policy: AuthPolicy): AuthDecision {
  if (policy.tier === 'public') {
    return { ok: true, tier: 'public' };
  }
  if (policy.tier === 'user') {
    if (!ctx.userKey) {
      return {
        ok: false,
        status: 401,
        error: 'user_key_required',
        tier: 'user',
      };
    }
    return { ok: true, tier: 'user' };
  }
  // admin
  if (!ctx.adminKey) {
    return {
      ok: false,
      status: 401,
      error: 'admin_key_required',
      tier: 'admin',
    };
  }
  if (ctx.transport === 'http' && policy.adminIps && policy.adminIps.size > 0) {
    if (!ctx.ip || !policy.adminIps.has(ctx.ip)) {
      return {
        ok: false,
        status: 403,
        error: 'admin_ip_not_allowlisted',
        tier: 'admin',
      };
    }
  }
  return { ok: true, tier: 'admin' };
}

export function parseAdminIps(env: string | undefined): Set<string> {
  return new Set(
    (env ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Pull a user key off an incoming request:
 *   1. `Authorization: Bearer <token>`
 *   2. `X-Tournamental-User-Key: <token>`
 *   3. `input.userKey` (stdio fallback)
 */
export function resolveUserKey(
  headers: Record<string, string | string[] | undefined>,
  input: Record<string, unknown> | undefined,
): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const tok = auth.slice('bearer '.length).trim();
    if (tok.length > 0) return tok;
  }
  const xUser = headers['x-tournamental-user-key'];
  if (typeof xUser === 'string' && xUser.length > 0) return xUser;
  if (input && typeof input.userKey === 'string' && input.userKey.length > 0) {
    return input.userKey;
  }
  return null;
}

/**
 * Pull an admin key off an incoming request:
 *   1. `X-Tournamental-Admin-Key: <token>`
 *   2. `input.adminKey` (stdio fallback)
 */
export function resolveAdminKey(
  headers: Record<string, string | string[] | undefined>,
  input: Record<string, unknown> | undefined,
): string | null {
  const xAdmin = headers['x-tournamental-admin-key'];
  if (typeof xAdmin === 'string' && xAdmin.length > 0) return xAdmin;
  if (input && typeof input.adminKey === 'string' && input.adminKey.length > 0) {
    return input.adminKey;
  }
  return null;
}
