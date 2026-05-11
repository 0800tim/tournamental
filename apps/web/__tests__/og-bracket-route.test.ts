/**
 * /api/og/bracket route — defensive smoke tests.
 *
 * The canvas renderer itself is covered by
 * `packages/social-cards/test/bracket-share-card.test.ts`; here we
 * exercise the Next.js route's defensive layer: query-param parsing,
 * size selection, never-throws contract, and disk cache key shape.
 *
 * These tests rasterise real PNGs (the route owns the full pipeline)
 * so they take a few seconds each. Vitest's default timeout is 5s; we
 * bump locally where needed.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GET } from "@/app/api/og/bracket/route";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  return buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function mkReq(query: Record<string, string>): Request {
  const u = new URL("http://localhost:3300/api/og/bracket");
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return new Request(u.toString());
}

// Pin the CWD to a writable temp dir so the disk cache writes don't
// pollute the real public/ folder during tests.
let prevCwd: string;
let tmpDir: string;

beforeAll(async () => {
  prevCwd = process.cwd();
  tmpDir = await fs.mkdtemp(join(tmpdir(), "vtorn-og-route-"));
  process.chdir(tmpDir);
  // Force the game-service fetch to fail fast so we don't hit network.
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("network disabled");
  }) as unknown as typeof fetch);
});

afterAll(async () => {
  process.chdir(prevCwd);
  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("/api/og/bracket", () => {
  it("returns a landscape PNG by default", async () => {
    const res = await GET(mkReq({ bracket_id: "test-landscape-default", handle: "tim", winner: "ARG" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-vtorn-og-size")).toBe("landscape");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(isPng(buf)).toBe(true);
    // 1200×630 landscape — IHDR width/height at offset 16/20.
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  }, 30_000);

  it("returns a portrait PNG when size=portrait", async () => {
    const res = await GET(mkReq({ bracket_id: "test-portrait", handle: "tim", winner: "ARG", size: "portrait" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vtorn-og-size")).toBe("portrait");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(isPng(buf)).toBe(true);
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1350);
  }, 30_000);

  it("returns a square PNG when size=square", async () => {
    const res = await GET(mkReq({ bracket_id: "test-square", handle: "tim", winner: "ARG", size: "square" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vtorn-og-size")).toBe("square");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(isPng(buf)).toBe(true);
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1080);
  }, 30_000);

  it("falls back to landscape when size is unknown", async () => {
    const res = await GET(mkReq({ bracket_id: "test-size-bad", size: "billboard" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vtorn-og-size")).toBe("landscape");
  }, 30_000);

  it("never 500s when the bracket id is empty / weird", async () => {
    const res = await GET(mkReq({ bracket_id: "" }) as never);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(isPng(buf)).toBe(true);
  }, 30_000);

  it("accepts explicit runner_up / third / kit overrides without throwing", async () => {
    const res = await GET(
      mkReq({
        bracket_id: "test-podium",
        handle: "tim",
        winner: "ARG",
        runner_up: "FRA",
        third: "BRA",
        kit: "#75AADB",
        path: "r16:JPN,qf:ESP,sf:BRA,final:FRA",
      }) as never,
    );
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(isPng(buf)).toBe(true);
  }, 30_000);

  it("sets the long-cache header", async () => {
    const res = await GET(mkReq({ bracket_id: "test-cache" }) as never);
    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("cache-control")).toContain("immutable");
  }, 30_000);
});
