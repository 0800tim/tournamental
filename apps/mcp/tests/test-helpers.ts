/**
 * Test helpers - a fake game-service implemented as a route-table
 * `fetch` stub passed into the GameClient. This avoids the Node 20
 * `undici` interception headaches that come with nock and keeps the
 * tests deterministic and offline.
 */

import { GameClient } from '../src/lib/game-client.js';
import { AuditLogger } from '../src/lib/audit.js';
import { RateLimiter } from '../src/lib/rate-limit.js';
import { dispatchTool, type DispatchContext } from '../src/lib/dispatch.js';

export const FAKE_BASE = 'http://game.fake';

export interface FakeRoute {
  method: 'GET' | 'POST';
  pathPattern: RegExp;
  queryAllowList?: Record<string, string | undefined>;
  status?: number;
  body?: unknown;
  /** Optional dynamic handler. Wins over `body` when set. */
  handler?: (info: { url: URL; method: string; body: unknown }) => {
    status: number;
    body: unknown;
  };
}

export class FakeFetcher {
  private readonly routes: FakeRoute[] = [];
  public readonly calls: Array<{ method: string; url: string; body: unknown }> = [];

  on(route: FakeRoute): this {
    this.routes.push(route);
    return this;
  }

  asFetch(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const method = (init?.method ?? 'GET').toUpperCase();
      const rawBody = init?.body;
      const body =
        typeof rawBody === 'string' && rawBody.length > 0 ? JSON.parse(rawBody) : null;
      this.calls.push({ method, url: url.toString(), body });
      const path = url.pathname;
      for (const r of this.routes) {
        if (r.method !== method) continue;
        if (!r.pathPattern.test(path)) continue;
        if (r.queryAllowList) {
          let queryOk = true;
          for (const [k, v] of Object.entries(r.queryAllowList)) {
            if (v === undefined) continue;
            if (url.searchParams.get(k) !== v) {
              queryOk = false;
              break;
            }
          }
          if (!queryOk) continue;
        }
        const dyn = r.handler?.({ url, method, body });
        const status = dyn?.status ?? r.status ?? 200;
        const responseBody = dyn?.body ?? r.body ?? {};
        return new Response(JSON.stringify(responseBody), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'no_fake_route', path }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }
}

export function makeFakeContext(
  overrides: Partial<DispatchContext> & { fetcher?: FakeFetcher } = {},
): DispatchContext {
  const { fetcher, ...rest } = overrides;
  const gameClient =
    rest.gameClient ??
    new GameClient({
      baseUrl: FAKE_BASE,
      fetchImpl: fetcher
        ? fetcher.asFetch()
        : ((async () =>
            new Response(JSON.stringify({ error: 'no_fetcher_in_test' }), {
              status: 599,
              headers: { 'content-type': 'application/json' },
            })) as unknown as typeof fetch),
    });
  return {
    transport: 'http',
    ip: '127.0.0.1',
    userKey: null,
    adminKey: null,
    rateLimiter: new RateLimiter(),
    audit: new AuditLogger({ disable: true }),
    adminIps: new Set(),
    ...rest,
    gameClient,
  };
}

export async function callTool(toolName: string, input: unknown, ctx: DispatchContext) {
  return dispatchTool(toolName, input, ctx);
}
