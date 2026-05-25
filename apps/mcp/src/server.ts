/**
 * MCP server factory - builds an `McpServer` with every Tournamental
 * tool registered and a shared `DispatchContext`.
 *
 * Two transports consume what this exports:
 *   - bin/cli.ts in stdio mode (default for local agent clients)
 *   - transports/http.ts in HTTP+SSE mode (hosted)
 *
 * Both use the same `dispatchTool()` pipeline, so the auth, rate-limit,
 * input-validation, audit, and output-validation behaviour is identical.
 *
 * NZ English; Apache-2.0.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodObject, type ZodRawShape, type ZodTypeAny } from 'zod';

import { AuditLogger } from './lib/audit.js';
import { dispatchTool, type DispatchContext, type DispatchResult } from './lib/dispatch.js';
import { GameClient } from './lib/game-client.js';
import { RateLimiter } from './lib/rate-limit.js';
import { ALL_TOOLS, type ToolDefinition } from './tools/catalogue.js';

export interface BuildMcpServerOptions {
  readonly transport: 'stdio' | 'http';
  readonly gameClient?: GameClient;
  readonly rateLimiter?: RateLimiter;
  readonly audit?: AuditLogger;
  readonly adminIps?: ReadonlySet<string>;
  /**
   * Per-request context resolver. The HTTP transport overrides this
   * to read auth headers and the source IP off the live request. The
   * stdio transport returns identity-keys read once from env at boot.
   */
  readonly contextResolver?: () => {
    ip: string | null;
    userKey: string | null;
    adminKey: string | null;
  };
}

export interface BuiltMcpServer {
  readonly server: McpServer;
  readonly gameClient: GameClient;
  readonly rateLimiter: RateLimiter;
  readonly audit: AuditLogger;
  readonly adminIps: ReadonlySet<string>;
  /** Direct-dispatch entrypoint used by the public HTTP catalogue route. */
  dispatch(
    toolName: string,
    input: unknown,
    perRequest?: { ip?: string | null; userKey?: string | null; adminKey?: string | null },
  ): Promise<DispatchResult>;
}

export const SERVER_INFO = {
  name: 'tournamental-mcp',
  version: '0.1.0',
  vendor: 'Growth Spurt Ltd',
};

function shapeOf(schema: ZodTypeAny): ZodRawShape {
  if (schema instanceof z.ZodObject) {
    return (schema as ZodObject<ZodRawShape>).shape;
  }
  if ('innerType' in (schema._def ?? {}) && typeof (schema._def as { innerType?: ZodTypeAny }).innerType !== 'undefined') {
    return shapeOf((schema._def as { innerType: ZodTypeAny }).innerType);
  }
  // Fall back to "any object" - agents will still get a description.
  return {} as ZodRawShape;
}

function ctxFromOptions(
  opts: BuildMcpServerOptions,
  gameClient: GameClient,
  rateLimiter: RateLimiter,
  audit: AuditLogger,
  adminIps: ReadonlySet<string>,
  perRequest?: { ip?: string | null; userKey?: string | null; adminKey?: string | null },
): DispatchContext {
  const r = opts.contextResolver?.() ?? { ip: null, userKey: null, adminKey: null };
  return {
    transport: opts.transport,
    ip: perRequest?.ip ?? r.ip ?? null,
    userKey: perRequest?.userKey ?? r.userKey ?? null,
    adminKey: perRequest?.adminKey ?? r.adminKey ?? null,
    gameClient,
    rateLimiter,
    audit,
    adminIps,
  };
}

function toolResultFor(d: DispatchResult): CallToolResult {
  if (d.status === 'ok') {
    return {
      content: [
        {
          type: 'text',
          text:
            typeof d.result === 'string' ? d.result : JSON.stringify(d.result, null, 2),
        },
      ],
      structuredContent: (d.result as Record<string, unknown> | undefined) ?? undefined,
    };
  }
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `error[${d.error?.code ?? d.status}]: ${d.error?.message ?? d.status}`,
      },
    ],
  };
}

export function buildMcpServer(opts: BuildMcpServerOptions): BuiltMcpServer {
  const gameClient = opts.gameClient ?? new GameClient();
  const rateLimiter = opts.rateLimiter ?? new RateLimiter();
  const audit =
    opts.audit ??
    new AuditLogger({
      // In stdio mode mirror to stderr so local users can `tail` the
      // host process's stderr to watch tool traffic.
      mirrorStderr: opts.transport === 'stdio',
    });
  const adminIps = opts.adminIps ?? new Set<string>();

  const server = new McpServer({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
  });

  for (const tool of ALL_TOOLS) {
    const inputShape = shapeOf(tool.inputSchema);
    const outputShape = shapeOf(tool.outputSchema);

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: `[${tool.tier}] ${tool.description}`,
        inputSchema: inputShape,
        outputSchema: outputShape,
        annotations: {
          // Read-only is true for public tools; everything else mutates state.
          readOnlyHint: tool.tier === 'public',
          // Destructive only really applies to admin invalidate/resolve.
          destructiveHint: tool.name.startsWith('admin_'),
          // We promise the same input → same output for reads, but writes are
          // tracked by audit and may legitimately produce different outputs.
          idempotentHint: tool.tier === 'public' || tool.name === 'save_share_guid',
          openWorldHint: true,
        },
      },
      async (args) => {
        const ctx = ctxFromOptions(opts, gameClient, rateLimiter, audit, adminIps);
        const d = await dispatchTool(tool.name, args, ctx);
        return toolResultFor(d);
      },
    );
  }

  return {
    server,
    gameClient,
    rateLimiter,
    audit,
    adminIps,
    async dispatch(toolName, input, perRequest) {
      const ctx = ctxFromOptions(opts, gameClient, rateLimiter, audit, adminIps, perRequest);
      return dispatchTool(toolName, input, ctx);
    },
  };
}

export type { ToolDefinition };
