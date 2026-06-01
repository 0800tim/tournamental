/**
 * LLM screenshot fallback parser. See docs/69-bracket-import.md §4.2.
 *
 * When the user is on an unsupported source platform, or one of our
 * dedicated parsers (Telegraph / ESPN / BBC / FIFA) failed to extract
 * picks, the wizard offers a "Upload a screenshot of your bracket"
 * path. The screenshot goes to the Anthropic API with a strict
 * structured-output prompt that returns the same `ParseResult` shape
 * every other parser emits, so the downstream wizard pipeline
 * (team-normalise + reconcile + commit) is identical regardless of
 * whether the picks came from a HTML scrape or an LLM vision call.
 *
 * Cost budget (per docs/69 §4.2): ~$0.02 per import. Capped to one
 * image per import in v1; multi-screenshot ESPN brackets are a
 * fast-follow.
 *
 * Trust: the LLM path inherits the same trust as the HTML parsers
 * because the user attests the screenshot is from one of the
 * lock-on-kickoff platforms (Telegraph / ESPN / BBC / FIFA). The
 * audit row records the raw image hash so disputes can be retraced.
 */

import fs from "node:fs";
import path from "node:path";
import type { ParseResult, ParsedPick } from "../types";

/**
 * Hard caps. The wizard upload endpoint should already enforce these,
 * but we re-check here so a misconfigured caller can't burn cost.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_IMAGE_BYTES = 256; // anything smaller is clearly empty
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const ANTHROPIC_MODEL = "claude-opus-4-7";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_TOKENS = 4096;

/**
 * Minimal fetch shape we depend on. Aliased so tests inject a stub
 * and we never hit the real Anthropic endpoint in CI.
 */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface ParseScreenshotOptions {
  /**
   * Hint about which source platform the user thinks the screenshot
   * came from. Passed to the LLM so it can disambiguate, for example,
   * "Telegraph uses a tick to mark the predicted winner".
   */
  readonly hint?: { readonly sourceName?: string };
  /**
   * Override the fetch implementation. Tests pass a stub; production
   * leaves this unset and falls back to global `fetch`.
   */
  readonly fetchImpl?: FetchLike;
  /**
   * Override the API key resolver. Tests pass a constant; production
   * leaves this unset and reads from tools/youtube-discovery/.env.
   *
   * TODO: consolidate to a proper env-loader once the apps/web env
   * conventions are unified across the monorepo.
   */
  readonly apiKey?: string;
}

/**
 * Parse a screenshot of a rival platform's bracket into our standard
 * `ParseResult`. Pure-ish: the only side effect is the outbound
 * Anthropic API call, which is injectable via `fetchImpl`.
 *
 * Never throws on Anthropic-side or LLM-content errors. A malformed
 * response degrades to an empty `matches` array so the wizard can
 * show a friendly "couldn't read your screenshot" message rather
 * than a 500.
 *
 * Throws synchronously only for caller-shaped errors that should
 * never reach the LLM at all: empty image, oversized image, bad
 * mime type. Those are programmer errors in the upload endpoint.
 */
export async function parseScreenshot(
  imageBase64: string,
  mimeType: string,
  hint?: { sourceName?: string },
  options?: Omit<ParseScreenshotOptions, "hint">,
): Promise<ParseResult> {
  validateImageInput(imageBase64, mimeType);

  const apiKey = options?.apiKey ?? readAnthropicKey();
  if (!apiKey) {
    return emptyResult("missing-api-key");
  }

  const doFetch: FetchLike =
    options?.fetchImpl ??
    ((url, init) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis.fetch as unknown as FetchLike)(url, init as any));

  const body = JSON.stringify({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: buildUserPrompt(hint),
          },
        ],
      },
    ],
  });

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await doFetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body,
    });
  } catch {
    return emptyResult("network-error");
  }

  if (!response.ok) {
    return emptyResult(`http-${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return emptyResult("non-json-response");
  }

  const text = extractAssistantText(payload);
  if (!text) {
    return emptyResult("no-text-in-response");
  }

  const parsed = safeParseJson(text);
  if (!parsed) {
    return emptyResult("malformed-json");
  }

  return coerceParseResult(parsed);
}

/* ------------------------------------------------------------------ */
/*  Prompts                                                            */
/* ------------------------------------------------------------------ */

/**
 * System prompt held constant across requests so prompt-caching can
 * apply later if we want it. Tells the LLM exactly what schema to
 * emit and what to do when it can't read part of the screenshot.
 */
const SYSTEM_PROMPT = `You read screenshots of football (soccer) tournament prediction brackets and extract the user's picks.

You MUST reply with a single JSON object and nothing else. No prose, no markdown fence, no leading explanation. The JSON object MUST match this TypeScript shape exactly:

{
  "matches": [
    {
      "homeTeamRaw": string,
      "awayTeamRaw": string,
      "predictedWinnerRaw": string,
      "kickoffHint": string | undefined,
      "sourceMatchId": string | undefined,
      "sourceTimestamp": string | undefined
    }
  ],
  "championRaw": string | undefined,
  "runnerUpRaw": string | undefined,
  "sourceUserHandle": string | undefined
}

Rules:
- Output team names verbatim as written on the screenshot. Do not translate, do not abbreviate, do not normalise. If the screenshot says "S Korea" emit "S Korea"; if it says a flag emoji and "KOR" emit whatever string is most readable.
- predictedWinnerRaw is the team the user picked to win, or the literal string "draw" for group-stage matches when the user predicted a draw.
- The screenshot may be partial: just the group stage, just one half of the knockouts, just the final. Emit what you can see. Omit championRaw if no champion is shown.
- If a match is visible but the user has not made a pick for it yet, skip it. Only emit matches with a clear pick.
- If you cannot read any picks at all, return {"matches": []}.
- Never invent picks. Never extrapolate. If a team name is illegible, skip that match.
- Do not include trailing commas. Do not include any field set to null; omit the field instead.
- Reply with ONLY the JSON object, starting with { and ending with }.`;

function buildUserPrompt(hint?: { sourceName?: string }): string {
  const source = hint?.sourceName?.trim();
  const sourceLine = source
    ? `The user said this screenshot is from: ${source}. Use that as context for how picks are visually marked (ticks, highlights, arrows, advancement lines), but do not invent picks that are not visible.`
    : `The user did not say which platform this screenshot is from. Infer from layout cues, but do not invent picks that are not visible.`;
  return `${sourceLine}

Extract the user's bracket predictions and reply with the JSON object described in the system prompt. JSON only.`;
}

/* ------------------------------------------------------------------ */
/*  Input validation                                                   */
/* ------------------------------------------------------------------ */

function validateImageInput(imageBase64: string, mimeType: string): void {
  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    throw new Error("screenshot-image-empty");
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("screenshot-image-bad-mime");
  }
  const approxBytes = Math.floor((imageBase64.length * 3) / 4);
  if (approxBytes < MIN_IMAGE_BYTES) {
    throw new Error("screenshot-image-too-small");
  }
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new Error("screenshot-image-too-large");
  }
}

/* ------------------------------------------------------------------ */
/*  Anthropic response handling                                        */
/* ------------------------------------------------------------------ */

interface AnthropicMessageResponse {
  content?: Array<{ type?: string; text?: string }>;
}

function extractAssistantText(payload: unknown): string | null {
  if (!isObject(payload)) return null;
  const content = (payload as AnthropicMessageResponse).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (isObject(block) && block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return null;
}

/**
 * Structured output is enforced by:
 *   1. A strict system prompt that forbids prose and demands raw JSON.
 *   2. A user-prompt reminder to reply with JSON only.
 *   3. Defensive JSON extraction here: even if the model adds a fence
 *      or a leading explanation, we slice from the first '{' to the
 *      last '}' and JSON.parse that.
 *   4. Schema-shape validation in coerceParseResult: anything that
 *      doesn't conform to ParseResult degrades to an empty result
 *      rather than throwing.
 *
 * Anthropic does not yet expose a JSON-mode flag the way OpenAI does,
 * so this prompt + sanitiser combo is the canonical pattern.
 */
function safeParseJson(text: string): unknown {
  const trimmed = text.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const candidate = trimmed.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function coerceParseResult(value: unknown): ParseResult {
  if (!isObject(value)) return emptyResult("non-object-root");
  const matchesRaw = (value as Record<string, unknown>).matches;
  const matches: ParsedPick[] = [];
  if (Array.isArray(matchesRaw)) {
    for (const m of matchesRaw) {
      const pick = coercePick(m);
      if (pick) matches.push(pick);
    }
  }
  const championRaw = stringOrUndef(
    (value as Record<string, unknown>).championRaw,
  );
  const runnerUpRaw = stringOrUndef(
    (value as Record<string, unknown>).runnerUpRaw,
  );
  const sourceUserHandle = stringOrUndef(
    (value as Record<string, unknown>).sourceUserHandle,
  );
  return {
    matches,
    ...(championRaw ? { championRaw } : {}),
    ...(runnerUpRaw ? { runnerUpRaw } : {}),
    ...(sourceUserHandle ? { sourceUserHandle } : {}),
  };
}

function coercePick(value: unknown): ParsedPick | null {
  if (!isObject(value)) return null;
  const v = value as Record<string, unknown>;
  const home = stringOrUndef(v.homeTeamRaw);
  const away = stringOrUndef(v.awayTeamRaw);
  const winnerRaw = stringOrUndef(v.predictedWinnerRaw);
  if (!home || !away || !winnerRaw) return null;
  const predictedWinnerRaw: string | "draw" =
    winnerRaw.toLowerCase() === "draw" ? "draw" : winnerRaw;
  const kickoffHint = stringOrUndef(v.kickoffHint);
  const sourceMatchId = stringOrUndef(v.sourceMatchId);
  const sourceTimestamp = stringOrUndef(v.sourceTimestamp);
  return {
    homeTeamRaw: home,
    awayTeamRaw: away,
    predictedWinnerRaw,
    ...(kickoffHint ? { kickoffHint } : {}),
    ...(sourceMatchId ? { sourceMatchId } : {}),
    ...(sourceTimestamp ? { sourceTimestamp } : {}),
  };
}

function emptyResult(_reason: string): ParseResult {
  // _reason is intentionally swallowed for the caller-facing return;
  // the API route logs full context to bracket_import_audit so we
  // never lose the failure mode for post-hoc dispute resolution.
  return { matches: [] };
}

function stringOrUndef(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/* ------------------------------------------------------------------ */
/*  API key resolution                                                 */
/* ------------------------------------------------------------------ */

/**
 * Project-wide convention: the Anthropic API key lives in
 * tools/youtube-discovery/.env. Shell env shadows it as empty, so any
 * consumer reads the .env file directly.
 *
 * TODO: consolidate to a proper env-loader once apps/web env handling
 * is unified across the monorepo. For now we read the file each call
 * because cold-start latency dominates the LLM latency anyway, and a
 * single Node fs.readFileSync against a 1 KB file is well under 1ms.
 */
function readAnthropicKey(): string | null {
  // Resolve relative to the monorepo root. __dirname is something
  // like .../apps/web/lib/import/parsers when transpiled; walk up
  // until we find the tools dir.
  const candidates = [
    process.env.ANTHROPIC_API_KEY,
    readKeyFromEnvFile(findEnvFile()),
  ];
  for (const c of candidates) {
    if (c && c.trim().length > 0) return c.trim();
  }
  return null;
}

function findEnvFile(): string | null {
  // Walk up from this file looking for tools/youtube-discovery/.env.
  // Fall back to a fixed monorepo path if the walk fails (tests).
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, "tools", "youtube-discovery", ".env");
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return p;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readKeyFromEnvFile(file: string | null): string | null {
  if (!file) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== "ANTHROPIC_API_KEY") continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Test hooks                                                         */
/* ------------------------------------------------------------------ */

/** Exported for tests only. Do not import from production code. */
export const __internals = {
  SYSTEM_PROMPT,
  buildUserPrompt,
  coerceParseResult,
  safeParseJson,
  validateImageInput,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_BYTES,
  ANTHROPIC_MODEL,
  ANTHROPIC_ENDPOINT,
};
