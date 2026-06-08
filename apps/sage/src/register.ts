/**
 * One-time bot registration for Sage.
 *
 * Sage runs forever under PM2 but only needs to register once. On every
 * boot we check the local state file (`.sage-state.json`) and, if no
 * bot_id is recorded, call the central API-key issuance flow to claim
 * the `@sage` handle. The handle is reserved publicly; the central
 * issuance endpoint validates the request comes from the holder of the
 * matching `TOURNAMENTAL_API_KEY` and returns a stable `bot_id`.
 *
 * In Phase 1 the recommended flow is to issue the key via the self-service
 * `/bots/keys` page and paste the resulting key + bot id into
 * `apps/sage/.env`. This module supports that path AND a programmatic
 * fallback: if `TOURNAMENTAL_BOT_ID` is missing it will POST to
 * `/v1/bots/register` with the reserved handle and persist the response.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const SAGE_HANDLE = "@sage";
export const SAGE_STATE_FILE = ".sage-state.json";

export interface SageState {
  bot_id: string;
  handle: string;
  registered_at: string;
}

export interface RegisterOpts {
  apiBase?: string;
  apiKey: string;
  /** Override the persistent state file path (defaults to ./.sage-state.json). */
  stateFile?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Resolve Sage's bot id, registering once if needed.
 *
 * Priority order:
 *   1. `TOURNAMENTAL_BOT_ID` env var (operator pasted it; use as-is).
 *   2. Cached state file (previous run registered it).
 *   3. POST `/v1/bots/register` with the reserved `@sage` handle.
 *
 * Throws only if no API key was supplied AND no cached id exists; this
 * makes the function safe to call in tests with a mock fetcher.
 */
export async function ensureSageRegistered(
  opts: RegisterOpts,
): Promise<SageState> {
  const fetcher = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const stateFile = opts.stateFile ?? join(process.cwd(), SAGE_STATE_FILE);

  const envBotId = process.env.TOURNAMENTAL_BOT_ID?.trim();
  if (envBotId) {
    const state: SageState = {
      bot_id: envBotId,
      handle: SAGE_HANDLE,
      registered_at: new Date().toISOString(),
    };
    await persist(stateFile, state);
    return state;
  }

  if (existsSync(stateFile)) {
    try {
      const cached = JSON.parse(await readFile(stateFile, "utf8")) as SageState;
      if (cached.bot_id && cached.handle === SAGE_HANDLE) return cached;
    } catch {
      /* corrupted cache; fall through and re-register */
    }
  }

  if (!opts.apiKey) {
    throw new Error(
      "sage: TOURNAMENTAL_API_KEY missing and no cached bot id. Set the env or issue a key at /bots/keys.",
    );
  }

  const base = opts.apiBase ?? "https://api.tournamental.com";
  const res = await fetcher(`${base}/v1/bots/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({ handle: SAGE_HANDLE }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`sage: register failed ${res.status}: ${errBody}`);
  }
  const body = (await res.json()) as { bot_id: string };
  if (!body.bot_id) throw new Error("sage: register response missing bot_id");
  const state: SageState = {
    bot_id: body.bot_id,
    handle: SAGE_HANDLE,
    registered_at: new Date().toISOString(),
  };
  await persist(stateFile, state);
  return state;
}

async function persist(stateFile: string, state: SageState): Promise<void> {
  await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
}
