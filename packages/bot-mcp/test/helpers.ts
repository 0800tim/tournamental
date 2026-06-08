/**
 * Test helpers shared across the bot-mcp test suite.
 */

import { TournamentalApiClient } from "../src/api-client.js";

export interface FakeRoute {
  method: "GET" | "POST";
  path: string; // exact path match against URL path + search
  status?: number;
  body: unknown;
}

export interface FakeFetchHandle {
  fetch: typeof fetch;
  calls: { method: string; url: string; body?: unknown }[];
}

export function makeFakeFetch(routes: FakeRoute[]): FakeFetchHandle {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ method, url, body: parsedBody });

    const parsed = new URL(url);
    const pathAndQuery = parsed.pathname + parsed.search;
    const match = routes.find((r) => r.method === method && r.path === pathAndQuery);
    if (!match) {
      return new Response(
        JSON.stringify({ error: `no fake route for ${method} ${pathAndQuery}` }),
        { status: 599, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(match.body), {
      status: match.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

export function makeClient(routes: FakeRoute[]): {
  client: TournamentalApiClient;
  calls: { method: string; url: string; body?: unknown }[];
} {
  const handle = makeFakeFetch(routes);
  const client = new TournamentalApiClient({
    apiKey: "tnm_test_key_abcdef0123456789",
    baseUrl: "https://api.tournamental.test",
    fetchImpl: handle.fetch,
  });
  return { client, calls: handle.calls };
}

/**
 * Decode an MCP text response into its JSON payload (or raw text if not
 * JSON). Tests assert on the decoded shape.
 *
 * Typed loosely (`{ content: unknown[] }`) because the SDK's `CallToolResult`
 * is a union over text / image / audio / resource items; our tools only
 * emit text but accepting the full type keeps the helper flexible.
 */
export function decodeMcp(response: {
  content: ReadonlyArray<{ type: string; text?: string }>;
  isError?: boolean;
}): { payload: unknown; isError: boolean } {
  const first = response.content[0];
  const text = first && "text" in first && typeof first.text === "string" ? first.text : "";
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { payload, isError: response.isError ?? false };
}
