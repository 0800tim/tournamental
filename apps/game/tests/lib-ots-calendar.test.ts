/**
 * OpenTimestamps calendar HTTP client.
 *
 * The unit tests stub the calendar with an in-memory fetch so we can
 * verify the wire protocol without touching the public OTS pool.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  bytesToHex,
  buildOtsFile,
  buildOtsPostHook,
  containsBitcoinAttestation,
  fetchUpgrade,
  hexToBytes,
  serialiseOtsFile,
  submitDigest,
  submitToCalendars,
} from "../src/lib/ots-calendar.js";

function sha256(input: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(input).digest());
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    return await handler(url, init);
  }) as typeof fetch;
}

describe("ots-calendar — hex helpers", () => {
  it("round-trips hex <-> bytes", () => {
    const bytes = sha256("hello");
    const hex = bytesToHex(bytes);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(bytesToHex(hexToBytes(hex))).toBe(hex);
  });

  it("rejects odd-length hex", () => {
    expect(() => hexToBytes("abc")).toThrow(/odd length/);
  });
});

describe("ots-calendar — submitDigest", () => {
  it("POSTs the digest and returns calendar bytes", async () => {
    const digest = sha256("root");
    let observed: { url?: string; body?: ArrayBuffer } = {};
    const fetchImpl = mockFetch(async (url, init) => {
      observed.url = url;
      observed.body = await new Response(init?.body).arrayBuffer();
      return new Response(new Uint8Array([0xf1, 0x04, 0x01]).buffer, {
        status: 200,
      });
    });
    const result = await submitDigest("https://cal.example.com", digest, {
      fetchImpl,
    });
    expect(observed.url).toBe("https://cal.example.com/digest");
    expect(new Uint8Array(observed.body!)).toEqual(digest);
    expect(result.pending_bytes.byteLength).toBe(3);
    expect(result.calendar_url).toBe("https://cal.example.com");
  });

  it("rejects non-32-byte digests", async () => {
    await expect(
      submitDigest("https://cal.example.com", new Uint8Array(16)),
    ).rejects.toThrow(/32 bytes/);
  });

  it("throws on non-2xx", async () => {
    const fetchImpl = mockFetch(() => new Response("nope", { status: 503 }));
    await expect(
      submitDigest("https://cal.example.com", sha256("x"), { fetchImpl }),
    ).rejects.toThrow(/503/);
  });
});

describe("ots-calendar — submitToCalendars (multi)", () => {
  it("returns successes and errors side by side", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.startsWith("https://ok.cal")) {
        return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
      }
      return new Response("down", { status: 500 });
    });
    const out = await submitToCalendars(sha256("x"), {
      calendars: ["https://ok.cal/", "https://fail.cal/"],
      fetchImpl,
    });
    expect(out.successes.map((s) => s.calendar_url)).toEqual([
      "https://ok.cal/",
    ]);
    expect(out.errors.map((e) => e.calendar_url)).toEqual(["https://fail.cal/"]);
  });
});

describe("ots-calendar — fetchUpgrade", () => {
  it("returns null on 404", async () => {
    const fetchImpl = mockFetch(() => new Response("", { status: 404 }));
    const out = await fetchUpgrade({
      calendar_url: "https://cal.example.com",
      digest_hex: "a".repeat(64),
      fetchImpl,
    });
    expect(out).toBeNull();
  });

  it("flags the Bitcoin attestation when present", async () => {
    const fetchImpl = mockFetch(
      () =>
        new Response(
          // arbitrary leading byte then the BTC attestation magic
          new Uint8Array([
            0xff, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01, 0x42,
          ]).buffer,
          { status: 200 },
        ),
    );
    const out = await fetchUpgrade({
      calendar_url: "https://cal.example.com",
      digest_hex: "a".repeat(64),
      fetchImpl,
    });
    expect(out).not.toBeNull();
    expect(out!.bitcoin_confirmed).toBe(true);
  });

  it("does not flag confirmation when only calendar bytes are present", async () => {
    const fetchImpl = mockFetch(
      () => new Response(new Uint8Array([0xf1, 0x00, 0xab]).buffer, { status: 200 }),
    );
    const out = await fetchUpgrade({
      calendar_url: "https://cal.example.com",
      digest_hex: "a".repeat(64),
      fetchImpl,
    });
    expect(out!.bitcoin_confirmed).toBe(false);
  });
});

describe("ots-calendar — file serialisation", () => {
  it("contains the magic header + version + sha256 tag + digest", () => {
    const digest = sha256("root");
    const ts = new Uint8Array([0x00, 0x01]);
    const bytes = serialiseOtsFile({ digest, timestamp_bytes: ts });
    // First 31 bytes are the OTS magic.
    expect(bytes[0]).toBe(0x00);
    // Byte 31 is version.
    expect(bytes[31]).toBe(0x01);
    // Byte 32 is the SHA-256 op tag.
    expect(bytes[32]).toBe(0x08);
    // Bytes 33..65 are the digest.
    expect(Array.from(bytes.slice(33, 65))).toEqual(Array.from(digest));
    // Final two bytes are the timestamp payload.
    expect(Array.from(bytes.slice(65))).toEqual([0x00, 0x01]);
  });

  it("buildOtsFile exposes digest_hex + calendar_url", () => {
    const digest = sha256("root");
    const out = buildOtsFile({
      digest,
      calendar_url: "https://x.cal",
      timestamp_bytes: new Uint8Array([1, 2, 3]),
    });
    expect(out.digest_hex).toBe(bytesToHex(digest));
    expect(out.calendar_url).toBe("https://x.cal");
  });
});

describe("ots-calendar — containsBitcoinAttestation", () => {
  it("finds the magic anywhere in the payload", () => {
    const buf = new Uint8Array([
      0xaa, 0xbb, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
    ]);
    expect(containsBitcoinAttestation(buf)).toBe(true);
  });
  it("rejects payloads without the magic", () => {
    expect(containsBitcoinAttestation(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("ots-calendar — buildOtsPostHook", () => {
  it("calls onPending with the calendar blobs that succeeded", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("ok")) {
        return new Response(new Uint8Array([0x99]).buffer, { status: 200 });
      }
      return new Response("down", { status: 500 });
    });
    const collected: unknown[] = [];
    const hook = buildOtsPostHook({
      calendars: ["https://ok.cal", "https://bad.cal"],
      fetchImpl,
      onPending: (blobs) => {
        collected.push(blobs);
      },
    });
    await hook("a".repeat(64));
    expect(collected).toHaveLength(1);
    const blobs = collected[0] as Array<{ calendar_url: string }>;
    expect(blobs.map((b) => b.calendar_url)).toEqual(["https://ok.cal"]);
  });

  it("is a no-op when given a non-hex root", async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error("should not be called");
    });
    let pending: unknown = null;
    const hook = buildOtsPostHook({
      calendars: ["https://x.cal"],
      fetchImpl,
      onPending: (b) => {
        pending = b;
      },
    });
    await expect(hook("not-hex")).resolves.toBeUndefined();
    expect(pending).toEqual([]);
  });
});
