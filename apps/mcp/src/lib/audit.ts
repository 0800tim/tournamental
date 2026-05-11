/**
 * Append-only audit log for every tool call.
 *
 * Default sink: JSON-lines file at `$MCP_AUDIT_PATH` (default
 * `./data/mcp-audit.jsonl`). One line per tool invocation with:
 *   - ts:        ISO-8601 timestamp
 *   - tool:      tool name
 *   - caller:    { tier, ip, user_prefix, admin_prefix }
 *   - request:   input (stripped of secret fields)
 *   - status:    'ok' | 'rate_limited' | 'auth_failed' | 'validation_error' | 'upstream_error'
 *   - http_code: numeric response code (0 if not HTTP)
 *   - latency_ms
 *
 * For OSS contributors self-hosting their own MCP, this is the critical
 * observability surface - `tail -f data/mcp-audit.jsonl` is the
 * canonical "what is my agent calling" view.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Tier } from './rate-limit.js';

export type AuditStatus =
  | 'ok'
  | 'rate_limited'
  | 'auth_failed'
  | 'validation_error'
  | 'upstream_error'
  | 'internal_error';

export interface AuditEntry {
  readonly ts: string;
  readonly tool: string;
  readonly tier: Tier;
  readonly ip: string | null;
  readonly user_prefix: string | null;
  readonly admin_prefix: string | null;
  readonly request: unknown;
  readonly status: AuditStatus;
  readonly http_code: number;
  readonly latency_ms: number;
  readonly error?: string;
}

const SECRET_KEYS = new Set(['userKey', 'adminKey', 'authorization', 'token', 'apiKey']);

/** Recursively strip secret-like fields and truncate the rest. */
export function redact(input: unknown, maxStringLen = 2000): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input.length > maxStringLen ? input.slice(0, maxStringLen) + '…' : input;
  }
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.map((v) => redact(v, maxStringLen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEYS.has(k)) {
      out[k] = typeof v === 'string' ? `${v.slice(0, 4)}***` : '***';
    } else {
      out[k] = redact(v, maxStringLen);
    }
  }
  return out;
}

export interface AuditLoggerOptions {
  /** Path to the JSONL audit file. Default `./data/mcp-audit.jsonl`. */
  readonly path?: string;
  /** Optional stderr fallback (useful for stdio mode under MCP clients). */
  readonly mirrorStderr?: boolean;
  /** Disable file writes entirely (tests). */
  readonly disable?: boolean;
}

export class AuditLogger {
  private readonly path: string;
  private readonly mirrorStderr: boolean;
  private readonly disable: boolean;
  private dirEnsured = false;

  constructor(opts: AuditLoggerOptions = {}) {
    this.path = opts.path ?? process.env.MCP_AUDIT_PATH ?? './data/mcp-audit.jsonl';
    this.mirrorStderr = opts.mirrorStderr ?? false;
    this.disable = opts.disable ?? false;
  }

  write(entry: AuditEntry): void {
    if (this.disable) return;
    const line = JSON.stringify(entry) + '\n';
    try {
      if (!this.dirEnsured) {
        mkdirSync(dirname(this.path), { recursive: true });
        this.dirEnsured = true;
      }
      appendFileSync(this.path, line, 'utf8');
    } catch (err) {
      // Never let audit IO break a tool call.
      if (this.mirrorStderr) {
        process.stderr.write(`[mcp-audit-error] ${(err as Error).message}\n`);
      }
    }
    if (this.mirrorStderr) {
      process.stderr.write(`[mcp-audit] ${line}`);
    }
  }
}

export function makeAuditEntry(args: {
  tool: string;
  tier: Tier;
  ip: string | null;
  userKey: string | null;
  adminKey: string | null;
  request: unknown;
  status: AuditStatus;
  httpCode: number;
  latencyMs: number;
  error?: string;
}): AuditEntry {
  return {
    ts: new Date().toISOString(),
    tool: args.tool,
    tier: args.tier,
    ip: args.ip,
    user_prefix: args.userKey ? args.userKey.slice(0, 6) : null,
    admin_prefix: args.adminKey ? args.adminKey.slice(0, 6) : null,
    request: redact(args.request),
    status: args.status,
    http_code: args.httpCode,
    latency_ms: args.latencyMs,
    error: args.error,
  };
}
