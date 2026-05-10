// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { upstreamGet } from "@/lib/upstream-fetch";

describe("upstreamGet", () => {
  const realFetch = global.fetch;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = realFetch;
    errSpy.mockRestore();
  });

  it("returns parsed JSON on 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: "world" }),
    }) as unknown as typeof fetch;

    const r = await upstreamGet<{ hello: string }>("http://x/y");
    expect(r).toEqual({ hello: "world" });
  });

  it("returns null on non-ok response and logs", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const r = await upstreamGet("http://x/y", { tag: "test" });
    expect(r).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it("returns null when fetch throws (network down) without throwing", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const r = await upstreamGet("http://x/y");
    expect(r).toBeNull();
  });

  it("attaches Authorization header when token provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await upstreamGet("http://x/y", { token: "abc" });
    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer abc");
  });
});
