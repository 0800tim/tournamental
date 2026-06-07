import { describe, it, expect } from "vitest";
import { postWithRetry, postWithRetryResult } from "../src/client.js";

function okResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("client.postWithRetry", () => {
  it("sends Authorization: Bearer <key>", async () => {
    let captured: Record<string, string> = {};
    const fetchMock = ((_url: string, init?: RequestInit) => {
      captured = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve(okResponse({ ok: true }));
    }) as unknown as typeof fetch;
    await postWithRetry(
      {
        apiKey: "tnm_secret_value",
        baseUrl: "http://x",
        fetchImpl: fetchMock,
      },
      "/v1/ping",
      { hello: 1 },
    );
    expect(captured.Authorization).toBe("Bearer tnm_secret_value");
    expect(captured["Content-Type"]).toBe("application/json");
  });

  it("returns the final status and attempt count via postWithRetryResult", async () => {
    let n = 0;
    const fetchMock = (() => {
      n += 1;
      if (n < 2) return Promise.resolve(okResponse({}, 502));
      return Promise.resolve(okResponse({ ok: true }, 200));
    }) as unknown as typeof fetch;
    const result = await postWithRetryResult<{ ok: boolean }>(
      {
        apiKey: "tnm_secret_value",
        baseUrl: "http://x",
        fetchImpl: fetchMock,
        retryBaseMs: 1,
      },
      "/v1/ping",
      {},
    );
    expect(result.data.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.attempts).toBe(2);
  });

  it("throws on persistent 5xx after maxRetries", async () => {
    let n = 0;
    const fetchMock = (() => {
      n += 1;
      return Promise.resolve(okResponse({ err: "down" }, 503));
    }) as unknown as typeof fetch;
    await expect(
      postWithRetry(
        {
          apiKey: "tnm_secret_value",
          baseUrl: "http://x",
          fetchImpl: fetchMock,
          retryBaseMs: 1,
          maxRetries: 3,
        },
        "/v1/ping",
        {},
      ),
    ).rejects.toThrow(/HTTP 503/);
    expect(n).toBe(3);
  });

  it("retries transient network errors", async () => {
    let n = 0;
    const fetchMock = (() => {
      n += 1;
      if (n < 2) return Promise.reject(new Error("ECONNRESET"));
      return Promise.resolve(okResponse({ ok: true }));
    }) as unknown as typeof fetch;
    const data = await postWithRetry<{ ok: boolean }>(
      {
        apiKey: "tnm_secret_value",
        baseUrl: "http://x",
        fetchImpl: fetchMock,
        retryBaseMs: 1,
      },
      "/v1/ping",
      {},
    );
    expect(data.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("rejects an empty apiKey", async () => {
    const fetchMock = (() =>
      Promise.resolve(okResponse({ ok: true }))) as unknown as typeof fetch;
    await expect(
      postWithRetry(
        { apiKey: "", baseUrl: "http://x", fetchImpl: fetchMock },
        "/v1/ping",
        {},
      ),
    ).rejects.toThrow(/apiKey/);
  });
});
