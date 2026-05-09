/**
 * Bracket submission handler.
 *
 * The real `POST /v1/predictions/bracket` endpoint will land via the API
 * agent on PR #27 (or successor). Until then, this client-side stub:
 *   1. Always writes the draft to localStorage.
 *   2. Tries the POST; if it 4xx/5xxs or doesn't respond, logs the JSON
 *      payload + a clear console warning so a developer can copy/paste it
 *      into a curl during testing.
 *   3. Returns a status object the UI can render.
 *
 * Caching: this is a write path (`POST /v1/predictions/bracket`); per the
 * standing rule in CLAUDE.md no public read cache applies. The endpoint
 * is `private, no-store` once it lands.
 */

import type { BracketPrediction } from "@vtorn/bracket-engine";
import { saveDraft } from "./storage.js";

export interface SubmitResult {
  readonly ok: boolean;
  readonly status: "submitted" | "draft_saved_no_api" | "api_error";
  readonly bracket_id?: string;
  readonly error?: string;
}

const API_BASE =
  process.env.NEXT_PUBLIC_VTORN_API_URL ?? "https://vtorn-api.aiva.nz";

export async function submitBracket(
  prediction: BracketPrediction,
  user_local_id: string,
): Promise<SubmitResult> {
  // Always save the draft so the user never loses their picks.
  saveDraft(prediction, user_local_id);

  const url = `${API_BASE}/v1/predictions/bracket`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prediction),
      // user-specific write — never caches
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(
        `[bracket-submit] API returned ${res.status} from ${url}. Payload (copy/paste for curl):`,
        prediction,
      );
      return { ok: false, status: "api_error", error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { bracket_id?: string };
    return { ok: true, status: "submitted", bracket_id: body.bracket_id };
  } catch (err) {
    console.warn(
      "[bracket-submit] No API available yet (PR #27 not landed). Draft saved to localStorage. Payload:",
      prediction,
    );
    return {
      ok: false,
      status: "draft_saved_no_api",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
