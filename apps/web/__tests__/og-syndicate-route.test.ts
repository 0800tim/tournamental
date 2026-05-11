/**
 * /api/og/syndicate route, smoke tests for size matrix + never-500 contract.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GET } from "@/app/api/og/syndicate/route";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function isPng(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  return buf.subarray(0, 8).equals(PNG_SIGNATURE);
}
function mkReq(query: Record<string, string>): Request {
  const u = new URL("http://localhost:3300/api/og/syndicate");
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return new Request(u.toString());
}

let prevCwd: string;
let tmpDir: string;

beforeAll(async () => {
  prevCwd = process.cwd();
  tmpDir = await fs.mkdtemp(join(tmpdir(), "vtorn-og-syndicate-"));
  process.chdir(tmpDir);
});

afterAll(async () => {
  process.chdir(prevCwd);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("/api/og/syndicate", () => {
  it("returns a 1200×630 landscape PNG by default", async () => {
    const res = await GET(mkReq({ slug: "demo", name: "Demo Syndicate", member_count: "42" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-vtorn-og-size")).toBe("landscape");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(isPng(buf)).toBe(true);
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  }, 15_000);

  it("returns 1080×1350 portrait when size=portrait", async () => {
    const res = await GET(mkReq({ slug: "demo", size: "portrait" }) as never);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1350);
  }, 15_000);

  it("returns 1080×1080 square when size=square", async () => {
    const res = await GET(mkReq({ slug: "demo", size: "square" }) as never);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1080);
  }, 15_000);

  it("handles a missing name by title-casing the slug", async () => {
    const res = await GET(mkReq({ slug: "the-office-pool" }) as never);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(isPng(buf)).toBe(true);
  }, 15_000);

  it("handles a big member count", async () => {
    const res = await GET(mkReq({ slug: "huge", member_count: "12500" }) as never);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(isPng(buf)).toBe(true);
  }, 15_000);

  it("sets a short edge TTL + SWR cache header (member count freshness)", async () => {
    const res = await GET(mkReq({ slug: "cache-headers" }) as never);
    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("cache-control")).toContain("stale-while-revalidate");
  }, 15_000);

  it("returns 400 when the slug is empty", async () => {
    const res = await GET(mkReq({}) as never);
    expect(res.status).toBe(400);
  });

  it("renders the canonical store hit for the seeded argentina-pool slug", async () => {
    const res = await GET(mkReq({ slug: "argentina-pool" }) as never);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(isPng(buf)).toBe(true);
  }, 15_000);
});
