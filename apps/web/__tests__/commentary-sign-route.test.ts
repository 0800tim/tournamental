/**
 * Tests for the commentary sign + manifest API routes.
 *
 * The Next.js route handlers are pure functions of `Request` →
 * `Response`. We invoke them directly without a server, asserting on
 * the JSON body + Cache-Control header.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as signRoute } from "@/app/api/commentary/sign/route";
import { GET as manifestRoute } from "@/app/api/commentary/manifest/[matchId]/[lang]/route";

describe("POST /api/commentary/sign", () => {
  const originalKey = process.env.ELEVENLABS_API_KEY;
  const originalVoice = process.env.ELEVENLABS_VOICE_ID_EN;

  beforeEach(() => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID_EN;
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.ELEVENLABS_API_KEY = originalKey;
    else delete process.env.ELEVENLABS_API_KEY;
    if (originalVoice !== undefined)
      process.env.ELEVENLABS_VOICE_ID_EN = originalVoice;
    else delete process.env.ELEVENLABS_VOICE_ID_EN;
  });

  it("returns stub mode when no API key is set", async () => {
    const res = await signRoute();
    const body = await res.json();
    expect(body.signed).toBe(false);
    expect(body.url).toBe("stub://commentary");
    expect(body.voiceId).toBe("stub-voice");
    expect(typeof body.expiresAt).toBe("number");
  });

  it("sets a private no-store cache header in stub mode", async () => {
    const res = await signRoute();
    const cacheControl = res.headers.get("Cache-Control");
    expect(cacheControl).toContain("private");
    expect(cacheControl).toContain("no-store");
  });

  it("returns a signed URL when API key is set", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key-123";
    process.env.ELEVENLABS_VOICE_ID_EN = "voice-en";
    const res = await signRoute();
    const body = await res.json();
    expect(body.signed).toBe(true);
    expect(body.url).toContain("wss://api.elevenlabs.io");
    expect(body.url).toContain("voice-en");
    expect(body.url).toContain("xi-api-key=test-key-123");
    expect(body.voiceId).toBe("voice-en");
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it("uses the configured model id when set", async () => {
    process.env.ELEVENLABS_API_KEY = "k";
    process.env.ELEVENLABS_MODEL = "eleven_test";
    const res = await signRoute();
    const body = await res.json();
    expect(body.url).toContain("eleven_test");
  });
});

describe("GET /api/commentary/manifest/:matchId/:lang", () => {
  it("returns an empty stub manifest", async () => {
    const res = await manifestRoute({} as Request, {
      params: { matchId: "fifa-2022-final", lang: "en" },
    });
    const body = await res.json();
    expect(body.match).toBe("fifa-2022-final");
    expect(body.lang).toBe("en");
    expect(Array.isArray(body.lines)).toBe(true);
    expect(body.lines).toEqual([]);
  });

  it("sets a public s-maxage cache header", async () => {
    const res = await manifestRoute({} as Request, {
      params: { matchId: "m", lang: "en" },
    });
    const cacheControl = res.headers.get("Cache-Control");
    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("s-maxage=300");
    expect(cacheControl).toContain("stale-while-revalidate=86400");
  });
});
