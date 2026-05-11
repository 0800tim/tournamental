/**
 * HTTP + SSE transport for the MCP server.
 *
 * Hosted at https://mcp.tournamental.com (prod). Three surfaces:
 *
 *   POST /mcp        - MCP JSON-RPC, streamed via SSE per the
 *                       MCP "Streamable HTTP" transport spec.
 *   GET  /mcp/tools  - Public, unauthenticated catalogue. Returns
 *                       every tool's name, tier, description, and
 *                       JSON-Schema input/output. Agent authors use
 *                       this to bootstrap a config without an SDK.
 *   GET  /healthz    - Liveness probe.
 *   GET  /           - Root descriptor.
 *
 * Auth headers (forwarded into the per-request dispatch context):
 *   - Authorization: Bearer <user-api-key>     (user-tier tools)
 *   - X-Tournamental-Admin-Key: <admin-key>    (admin-tier tools)
 *
 * Rate limiting and audit logging happen inside `dispatchTool()` so
 * they apply identically to both transports.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { AuditLogger } from '../lib/audit.js';
import { parseAdminIps, resolveAdminKey, resolveUserKey } from '../lib/auth.js';
import { GameClient } from '../lib/game-client.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { buildMcpServer, SERVER_INFO } from '../server.js';
import { publicCatalogue } from '../tools/catalogue.js';

export interface HttpServerOptions {
  readonly port?: number;
  readonly bind?: string;
  readonly corsOrigins?: string[];
  readonly gameBaseUrl?: string;
}

export interface BuiltHttpServer {
  readonly app: FastifyInstance;
  readonly port: number;
  readonly bind: string;
  close(): Promise<void>;
}

export async function buildHttpServer(opts: HttpServerOptions = {}): Promise<BuiltHttpServer> {
  const port = opts.port ?? Number(process.env.MCP_PORT ?? 3395);
  const bind = opts.bind ?? process.env.MCP_BIND ?? '0.0.0.0';
  const corsOrigins =
    opts.corsOrigins ??
    (process.env.MCP_CORS_ORIGINS ?? 'https://mcp.tournamental.com,http://localhost:3300')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const adminIps = parseAdminIps(process.env.TOURNAMENTAL_ADMIN_IPS);

  const gameClient = new GameClient({ baseUrl: opts.gameBaseUrl });
  const rateLimiter = new RateLimiter();
  const audit = new AuditLogger();

  const usePretty = process.env.LOG_PRETTY === '1';
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(usePretty ? { transport: { target: 'pino-pretty' } } : {}),
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, corsOrigins.includes(origin));
    },
    exposedHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version'],
    credentials: true,
  });

  // ---- Root + health ----

  app.get('/', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: SERVER_INFO.name,
      version: SERVER_INFO.version,
      docs: 'https://github.com/0800tim/tournamental/tree/main/apps/mcp',
      tools: '/mcp/tools',
      mcp_endpoint: '/mcp',
      health: '/healthz',
    };
  });

  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });

  // ---- Public catalogue (no auth) ----

  app.get('/mcp/tools', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
    return {
      service: SERVER_INFO.name,
      version: SERVER_INFO.version,
      tool_count: publicCatalogue().length,
      tools: publicCatalogue(),
    };
  });

  // ---- MCP JSON-RPC over Streamable HTTP ----
  //
  // We run in stateless mode: one transport per request. This keeps
  // horizontal scaling simple (no in-memory session state) at the
  // cost of slightly more per-request setup. The tradeoff is the
  // right one for an unauthenticated catalogue surface that happens
  // to also serve authenticated tool calls - sessions don't add value.

  app.post('/mcp', async (req, reply) => {
    const body = req.body as unknown;
    const userKey = resolveUserKey(
      req.headers as Record<string, string | string[] | undefined>,
      undefined,
    );
    const adminKey = resolveAdminKey(
      req.headers as Record<string, string | string[] | undefined>,
      undefined,
    );
    const ip = req.ip ?? null;

    // Build a fresh server per request so the dispatch context can
    // carry the live caller's keys. The McpServer itself is cheap to
    // construct - registering 15 tools is O(microseconds).
    const built = buildMcpServer({
      transport: 'http',
      gameClient,
      rateLimiter,
      audit,
      adminIps,
      contextResolver: () => ({ ip, userKey, adminKey }),
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: !isInitializeRequest(body),
    });

    reply.raw.on('close', () => {
      transport.close().catch(() => {});
    });

    await built.server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, body);
  });

  // ---- Direct REST surface (mirror of MCP tool calls) ----
  //
  // Some agent frameworks don't speak MCP yet but want the same
  // contracts. `POST /v1/tool/:name` calls the dispatcher directly
  // with the same auth + rate-limit + audit pipeline. Body is the
  // tool input JSON.

  app.post('/v1/tool/:name', async (req, reply) => {
    const name = (req.params as { name?: string }).name ?? '';
    const userKey = resolveUserKey(
      req.headers as Record<string, string | string[] | undefined>,
      req.body as Record<string, unknown>,
    );
    const adminKey = resolveAdminKey(
      req.headers as Record<string, string | string[] | undefined>,
      req.body as Record<string, unknown>,
    );
    const ip = req.ip ?? null;

    const built = buildMcpServer({
      transport: 'http',
      gameClient,
      rateLimiter,
      audit,
      adminIps,
      contextResolver: () => ({ ip, userKey, adminKey }),
    });
    const d = await built.dispatch(name, req.body, { ip, userKey, adminKey });
    reply.code(d.httpCode);
    if (d.rate) {
      reply.header('X-RateLimit-Limit', String(d.rate.limit));
      reply.header('X-RateLimit-Remaining', String(d.rate.remaining));
      reply.header('X-RateLimit-Reset', String(Math.ceil(d.rate.resetMs / 1000)));
    }
    if (d.status === 'ok') {
      reply.header('Cache-Control', 'no-store');
      return { ok: true, tool: d.tool, tier: d.tier, result: d.result };
    }
    return { ok: false, tool: d.tool, tier: d.tier, error: d.error };
  });

  return {
    app,
    port,
    bind,
    async close() {
      await app.close();
    },
  };
}

export async function startHttp(opts: HttpServerOptions = {}): Promise<BuiltHttpServer> {
  const built = await buildHttpServer(opts);
  await built.app.listen({ port: built.port, host: built.bind });
  built.app.log.info(
    { port: built.port, bind: built.bind },
    `tournamental-mcp listening on http://${built.bind}:${built.port}`,
  );
  return built;
}
