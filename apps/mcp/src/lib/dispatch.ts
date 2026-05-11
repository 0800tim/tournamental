/**
 * Transport-agnostic tool dispatcher.
 *
 * Both the stdio MCP server and the HTTP+SSE server route every call
 * through `dispatchTool()`. It enforces auth → rate-limit → input
 * validation → handler → output validation → audit, in that order.
 *
 * Returns a `DispatchResult` so the transport can choose how to
 * surface failure (JSON-RPC error vs. HTTP status).
 */

import { ZodError, type ZodTypeAny, z } from 'zod';

import { AuditLogger, makeAuditEntry } from './audit.js';
import { checkAuth, type AuthPolicy } from './auth.js';
import type { GameClient } from './game-client.js';
import { RateLimiter, type Tier } from './rate-limit.js';
import { UpstreamError } from './game-client.js';
import { toolByName, type ToolDefinition } from '../tools/catalogue.js';

export interface DispatchContext {
  readonly transport: 'stdio' | 'http';
  readonly ip: string | null;
  readonly userKey: string | null;
  readonly adminKey: string | null;
  readonly gameClient: GameClient;
  readonly rateLimiter: RateLimiter;
  readonly audit: AuditLogger;
  readonly adminIps: ReadonlySet<string>;
}

export type DispatchStatus =
  | 'ok'
  | 'unknown_tool'
  | 'auth_failed'
  | 'rate_limited'
  | 'validation_error'
  | 'upstream_error'
  | 'internal_error';

export interface DispatchResult {
  readonly status: DispatchStatus;
  readonly httpCode: number;
  readonly result?: unknown;
  readonly error?: { code: string; message: string; details?: unknown };
  readonly tool?: string;
  readonly tier?: Tier;
  readonly rate?: { limit: number; remaining: number; resetMs: number };
}

function statusToCode(status: DispatchStatus): number {
  switch (status) {
    case 'ok':
      return 200;
    case 'unknown_tool':
      return 404;
    case 'auth_failed':
      return 401;
    case 'rate_limited':
      return 429;
    case 'validation_error':
      return 400;
    case 'upstream_error':
      return 502;
    case 'internal_error':
      return 500;
  }
}

export async function dispatchTool(
  toolName: string,
  rawInput: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const start = Date.now();
  const tool = toolByName(toolName);

  function audit(
    tier: Tier,
    status: 'ok' | 'rate_limited' | 'auth_failed' | 'validation_error' | 'upstream_error' | 'internal_error',
    httpCode: number,
    error?: string,
  ): void {
    ctx.audit.write(
      makeAuditEntry({
        tool: toolName,
        tier,
        ip: ctx.ip,
        userKey: ctx.userKey,
        adminKey: ctx.adminKey,
        request: rawInput,
        status,
        httpCode,
        latencyMs: Date.now() - start,
        error,
      }),
    );
  }

  if (!tool) {
    audit('public', 'validation_error', 404, 'unknown_tool');
    return {
      status: 'unknown_tool',
      httpCode: 404,
      error: { code: 'unknown_tool', message: `no tool named "${toolName}"` },
      tool: toolName,
    };
  }

  // 1. Auth
  const policy: AuthPolicy = { tier: tool.tier, adminIps: ctx.adminIps };
  const auth = checkAuth(
    {
      transport: ctx.transport,
      ip: ctx.ip,
      userKey: ctx.userKey,
      adminKey: ctx.adminKey,
    },
    policy,
  );
  if (!auth.ok) {
    audit(tool.tier, 'auth_failed', auth.status ?? 401, auth.error);
    return {
      status: 'auth_failed',
      httpCode: auth.status ?? 401,
      error: { code: auth.error ?? 'auth_failed', message: auth.error ?? 'auth failed' },
      tool: tool.name,
      tier: tool.tier,
    };
  }

  // 2. Rate limit (keyed on the most specific identifier we have)
  const rateKey =
    tool.tier === 'admin'
      ? `admin:${(ctx.adminKey ?? '').slice(0, 12)}`
      : tool.tier === 'user'
        ? `user:${(ctx.userKey ?? '').slice(0, 12)}`
        : `public:${ctx.ip ?? 'unknown'}`;
  const rl = ctx.rateLimiter.check(tool.tier, rateKey);
  if (!rl.allowed) {
    audit(tool.tier, 'rate_limited', 429, 'rate_limited');
    return {
      status: 'rate_limited',
      httpCode: 429,
      error: { code: 'rate_limited', message: `${tool.tier} tier limit of ${rl.limit}/min hit` },
      tool: tool.name,
      tier: tool.tier,
      rate: { limit: rl.limit, remaining: rl.remaining, resetMs: rl.resetMs },
    };
  }

  // 3. Input validation
  let parsedInput: unknown;
  try {
    parsedInput = (tool.inputSchema as ZodTypeAny).parse(rawInput ?? {});
  } catch (err) {
    audit(tool.tier, 'validation_error', 400, 'input_validation');
    return {
      status: 'validation_error',
      httpCode: 400,
      error: {
        code: 'input_validation',
        message: 'input failed schema validation',
        details: err instanceof ZodError ? err.flatten() : String(err),
      },
      tool: tool.name,
      tier: tool.tier,
      rate: { limit: rl.limit, remaining: rl.remaining, resetMs: rl.resetMs },
    };
  }

  // 4. Handler
  let result: unknown;
  try {
    result = await (tool as ToolDefinition<ZodTypeAny, ZodTypeAny>).handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsedInput as any,
      {
        gameClient: ctx.gameClient,
        userKey: ctx.userKey,
        adminKey: ctx.adminKey,
        ip: ctx.ip,
      },
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      audit(tool.tier, 'upstream_error', 502, err.message);
      return {
        status: 'upstream_error',
        httpCode: 502,
        error: {
          code: 'upstream_error',
          message: err.message,
          details: { upstream_status: err.status, body: err.body },
        },
        tool: tool.name,
        tier: tool.tier,
      };
    }
    audit(tool.tier, 'internal_error', 500, (err as Error).message);
    return {
      status: 'internal_error',
      httpCode: 500,
      error: { code: 'internal_error', message: (err as Error).message },
      tool: tool.name,
      tier: tool.tier,
    };
  }

  // 5. Output validation
  try {
    result = (tool.outputSchema as ZodTypeAny).parse(result);
  } catch (err) {
    audit(tool.tier, 'internal_error', 500, 'output_validation');
    return {
      status: 'internal_error',
      httpCode: 500,
      error: {
        code: 'output_validation',
        message: 'tool returned a value that does not match its declared output schema',
        details: err instanceof ZodError ? err.flatten() : String(err),
      },
      tool: tool.name,
      tier: tool.tier,
    };
  }

  audit(tool.tier, 'ok', 200);
  return {
    status: 'ok',
    httpCode: statusToCode('ok'),
    result,
    tool: tool.name,
    tier: tool.tier,
    rate: { limit: rl.limit, remaining: rl.remaining, resetMs: rl.resetMs },
  };
}

/** Lightweight type guard for the dispatch result. */
export function isSuccess<T = unknown>(
  r: DispatchResult,
): r is DispatchResult & { result: T } {
  return r.status === 'ok' && r.result !== undefined;
}

// re-export for convenience
export { z };
