/**
 * Unit tests for the LLM screenshot-import parser. See
 * apps/web/lib/import/parsers/screenshot.ts and
 * docs/69-bracket-import.md §4.2.
 *
 * No real Anthropic calls: the fetch implementation is injected as a
 * stub so these tests are fast, deterministic, and free.
 */

import { describe, it, expect } from "vitest";
import {
  parseScreenshot,
  __internals,
  type FetchLike,
} from "@/lib/import/parsers/screenshot";

/** A 1x1 PNG, base64-encoded. ~67 bytes when decoded; we pad it past
 *  the MIN_IMAGE_BYTES floor for the happy-path tests. */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function padBase64ToBytes(seed: string, targetBytes: number): string {
  // base64 expands 3 bytes -> 4 chars, so for N bytes we need
  // ceil(N / 3) * 4 chars. Pad by repeating a safe alphabet char then
  // re-trimming to be a valid base64 string.
  const targetChars = Math.ceil(targetBytes / 3) * 4;
  const pool =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = seed;
  while (out.length < targetChars) {
    out += pool[(out.length * 7) % pool.length];
  }
  out = out.slice(0, targetChars - 1) + "=";
  return out;
}

/** Build a base64 payload that decodes to roughly `bytes` bytes. */
function imageOfSize(bytes: number): string {
  return padBase64ToBytes(TINY_PNG_BASE64, bytes);
}

function makeAnthropicResponse(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ content: [{ type: "text", text }] }),
    json: async () => ({ content: [{ type: "text", text }] }),
  };
}

function makeHttpError(status: number) {
  return {
    ok: false,
    status,
    text: async () => `error ${status}`,
    json: async () => ({ error: { message: `error ${status}` } }),
  };
}

const VALID_IMAGE = imageOfSize(2048);
const VALID_MIME = "image/png";
const FAKE_KEY = "sk-test-fake-key";

describe("parseScreenshot — input validation (rejects early)", () => {
  it("rejects empty image string", async () => {
    await expect(
      parseScreenshot("", VALID_MIME, undefined, { apiKey: FAKE_KEY }),
    ).rejects.toThrow(/screenshot-image-empty/);
  });

  it("rejects oversized images (> 5MB)", async () => {
    const oversized = imageOfSize(6 * 1024 * 1024);
    await expect(
      parseScreenshot(oversized, VALID_MIME, undefined, { apiKey: FAKE_KEY }),
    ).rejects.toThrow(/screenshot-image-too-large/);
  });

  it("rejects too-small images (< 256 bytes)", async () => {
    const tiny = imageOfSize(64);
    await expect(
      parseScreenshot(tiny, VALID_MIME, undefined, { apiKey: FAKE_KEY }),
    ).rejects.toThrow(/screenshot-image-too-small/);
  });

  it("rejects unsupported mime types", async () => {
    await expect(
      parseScreenshot(VALID_IMAGE, "image/bmp", undefined, { apiKey: FAKE_KEY }),
    ).rejects.toThrow(/screenshot-image-bad-mime/);
  });

  it("accepts the four allowed mime types", async () => {
    const fetchImpl: FetchLike = async () =>
      makeAnthropicResponse('{"matches":[]}');
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      const result = await parseScreenshot(VALID_IMAGE, mime, undefined, {
        apiKey: FAKE_KEY,
        fetchImpl,
      });
      expect(result.matches).toEqual([]);
    }
  });
});

describe("parseScreenshot — successful Anthropic response", () => {
  it("parses a well-formed JSON response into ParseResult shape", async () => {
    const llmJson = JSON.stringify({
      matches: [
        {
          homeTeamRaw: "Argentina",
          awayTeamRaw: "France",
          predictedWinnerRaw: "Argentina",
          kickoffHint: "2022-12-18",
        },
        {
          homeTeamRaw: "Brazil",
          awayTeamRaw: "Croatia",
          predictedWinnerRaw: "draw",
        },
      ],
      championRaw: "Argentina",
      runnerUpRaw: "France",
      sourceUserHandle: "tim",
    });

    const fetchImpl: FetchLike = async (url, init) => {
      expect(url).toContain("anthropic.com");
      expect(init.method).toBe("POST");
      expect(init.headers["x-api-key"]).toBe(FAKE_KEY);
      expect(init.headers["anthropic-version"]).toBeTruthy();
      const body = JSON.parse(init.body) as {
        model: string;
        messages: Array<{ content: Array<{ type: string }> }>;
      };
      expect(body.model).toBe(__internals.ANTHROPIC_MODEL);
      const content = body.messages[0].content;
      expect(content.some((c) => c.type === "image")).toBe(true);
      expect(content.some((c) => c.type === "text")).toBe(true);
      return makeAnthropicResponse(llmJson);
    };

    const result = await parseScreenshot(
      VALID_IMAGE,
      VALID_MIME,
      { sourceName: "Telegraph" },
      { apiKey: FAKE_KEY, fetchImpl },
    );

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toEqual({
      homeTeamRaw: "Argentina",
      awayTeamRaw: "France",
      predictedWinnerRaw: "Argentina",
      kickoffHint: "2022-12-18",
    });
    expect(result.matches[1]).toEqual({
      homeTeamRaw: "Brazil",
      awayTeamRaw: "Croatia",
      predictedWinnerRaw: "draw",
    });
    expect(result.championRaw).toBe("Argentina");
    expect(result.runnerUpRaw).toBe("France");
    expect(result.sourceUserHandle).toBe("tim");
  });

  it("tolerates partial screenshots (no champion field)", async () => {
    const llmJson = JSON.stringify({
      matches: [
        {
          homeTeamRaw: "Spain",
          awayTeamRaw: "Germany",
          predictedWinnerRaw: "Spain",
        },
      ],
    });
    const fetchImpl: FetchLike = async () => makeAnthropicResponse(llmJson);
    const result = await parseScreenshot(VALID_IMAGE, VALID_MIME, undefined, {
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.championRaw).toBeUndefined();
    expect(result.runnerUpRaw).toBeUndefined();
  });

  it("strips JSON out of a model response that wrapped it in markdown", async () => {
    const llmJson =
      "Here is the bracket I extracted:\n```json\n" +
      JSON.stringify({
        matches: [
          {
            homeTeamRaw: "Japan",
            awayTeamRaw: "Korea",
            predictedWinnerRaw: "Japan",
          },
        ],
      }) +
      "\n```";
    const fetchImpl: FetchLike = async () => makeAnthropicResponse(llmJson);
    const result = await parseScreenshot(VALID_IMAGE, VALID_MIME, undefined, {
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].homeTeamRaw).toBe("Japan");
  });

  it("skips picks with missing required fields rather than throwing", async () => {
    const llmJson = JSON.stringify({
      matches: [
        // Missing predictedWinnerRaw -> dropped.
        { homeTeamRaw: "Argentina", awayTeamRaw: "France" },
        // Complete -> kept.
        {
          homeTeamRaw: "Mexico",
          awayTeamRaw: "Panama",
          predictedWinnerRaw: "Mexico",
        },
      ],
    });
    const fetchImpl: FetchLike = async () => makeAnthropicResponse(llmJson);
    const result = await parseScreenshot(VALID_IMAGE, VALID_MIME, undefined, {
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].homeTeamRaw).toBe("Mexico");
  });
});

describe("parseScreenshot — malformed responses degrade gracefully", () => {
  it("returns empty matches when Anthropic returns non-JSON text", async () => {
    const fetchImpl: FetchLike = async () =>
      makeAnthropicResponse("I cannot read this image, sorry.");
    const result = await parseScreenshot(VALID_IMAGE, VALID_MIME, undefined, {
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    expect(result.matches).toEqual([]);
  });

  it("returns empty matches when the response payload has no text block", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "{}",
      json: async () => ({ content: [] }),
    });
    const result = await parseScreenshot(VALID_IMAGE, VALID_MIME, undefined, {
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    expect(result.matches).toEqual([]);
  });

  it("returns empty matches when JSON is structurally wrong", async () => {
    const fetchImpl: FetchLike = async () =>
      makeAnthropicResponse('{"matches":"not an array","championRaw":42}');
    const result = await parseScreenshot(VALID_IMAGE, VALID_MIME, undefined, {
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    expect(result.matches).toEqual([]);
    expect(result.championRaw).toBeUndefined();
  });

  it("returns empty matches on HTTP error from Anthropic", async () => {
    const fetchImpl: FetchLike = async () => makeHttpError(429);
    const result = await parseScreenshot(VALID_IMAGE, VALID_MIME, undefined, {
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    expect(result.matches).toEqual([]);
  });

  it("returns empty matches on network error", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    const result = await parseScreenshot(VALID_IMAGE, VALID_MIME, undefined, {
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    expect(result.matches).toEqual([]);
  });

  it("returns empty matches when the API key cannot be resolved", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return makeAnthropicResponse('{"matches":[]}');
    };
    const result = await parseScreenshot(VALID_IMAGE, VALID_MIME, undefined, {
      apiKey: "",
      fetchImpl,
    });
    expect(result.matches).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("parseScreenshot — prompt shape", () => {
  it("system prompt forbids prose and demands JSON-only output", () => {
    expect(__internals.SYSTEM_PROMPT).toMatch(/single JSON object/i);
    expect(__internals.SYSTEM_PROMPT).toMatch(/verbatim/i);
    expect(__internals.SYSTEM_PROMPT).toMatch(/draw/);
    expect(__internals.SYSTEM_PROMPT).toMatch(/No prose/i);
  });

  it("user prompt embeds the source hint when provided", () => {
    const withHint = __internals.buildUserPrompt({ sourceName: "Telegraph" });
    expect(withHint).toContain("Telegraph");
    const noHint = __internals.buildUserPrompt();
    expect(noHint).toContain("did not say");
  });
});
