/**
 * Personal API key client , talks to the game-service
 * `/v1/me/api-keys` surface from the browser.
 *
 * Every call carries the user's Supabase access token in
 * `Authorization: Bearer <jwt>`. The token comes from `getSession()`
 * which is the supabase-js handle to the cookie session managed by
 * `@supabase/ssr`. We pull it lazily on each call so a token refresh
 * mid-tab doesn't leave us calling with a stale bearer.
 *
 * The response shape mirrors `MintResponse` / `PublicUserApiKey` on the
 * server (see `apps/game/src/routes/user-api-keys.ts`). Keep these
 * mirrored , a divergence between the two will silently degrade the
 * page (a missing field on the client side just renders blank cells).
 *
 * Base URL resolution: the bracket client (`lib/bracket/api.ts`)
 * already pins the public env var `NEXT_PUBLIC_GAME_API_URL`. We reuse
 * the same constant so a single env change retargets every game-API
 * call.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { GAME_API_BASE } from "@/lib/bracket/api";

export interface PublicUserApiKey {
  readonly id: string;
  readonly label: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly rate_limit_rpm: number;
  readonly created_at: string;
  readonly last_used_at: string | null;
  readonly revoked_at: string | null;
  readonly status: "active" | "revoked";
}

export interface MintedUserApiKey extends PublicUserApiKey {
  /** Plaintext key, shown ONCE. */
  readonly key: string;
}

export interface MintInput {
  readonly label: string;
  readonly scopes?: readonly string[];
}

export interface ApiKeysFailure {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly message?: string;
}

export type ApiKeysResult<T> =
  | { readonly ok: true; readonly data: T }
  | ApiKeysFailure;

async function bearerFor(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function base(): string {
  return GAME_API_BASE.replace(/\/+$/, "");
}

export async function listApiKeys(
  sb: SupabaseClient,
): Promise<ApiKeysResult<readonly PublicUserApiKey[]>> {
  const tok = await bearerFor(sb);
  if (!tok) return { ok: false, status: 401, code: "no_session" };
  try {
    const res = await fetch(`${base()}/v1/me/api-keys`, {
      method: "GET",
      headers: { authorization: `Bearer ${tok}` },
      cache: "no-store",
    });
    const json = (await readJson(res)) as { keys?: PublicUserApiKey[]; error?: string };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: json?.error ?? "list_failed",
      };
    }
    return { ok: true, data: json.keys ?? [] };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function mintApiKey(
  sb: SupabaseClient,
  input: MintInput,
): Promise<ApiKeysResult<MintedUserApiKey>> {
  const tok = await bearerFor(sb);
  if (!tok) return { ok: false, status: 401, code: "no_session" };
  try {
    const res = await fetch(`${base()}/v1/me/api-keys`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tok}`,
      },
      body: JSON.stringify({
        label: input.label,
        ...(input.scopes ? { scopes: input.scopes } : {}),
      }),
      cache: "no-store",
    });
    const json = (await readJson(res)) as
      | (MintedUserApiKey & { error?: string; message?: string })
      | null;
    if (!res.ok || !json || !("key" in json)) {
      return {
        ok: false,
        status: res.status,
        code: json?.error ?? "mint_failed",
        message: json?.message,
      };
    }
    return { ok: true, data: json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function revokeApiKey(
  sb: SupabaseClient,
  id: string,
): Promise<ApiKeysResult<true>> {
  const tok = await bearerFor(sb);
  if (!tok) return { ok: false, status: 401, code: "no_session" };
  try {
    const res = await fetch(
      `${base()}/v1/me/api-keys/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${tok}` },
        cache: "no-store",
      },
    );
    if (res.status === 204) return { ok: true, data: true };
    const json = (await readJson(res)) as { error?: string } | null;
    return {
      ok: false,
      status: res.status,
      code: json?.error ?? "revoke_failed",
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function regenerateApiKey(
  sb: SupabaseClient,
  id: string,
): Promise<ApiKeysResult<MintedUserApiKey>> {
  const tok = await bearerFor(sb);
  if (!tok) return { ok: false, status: 401, code: "no_session" };
  try {
    const res = await fetch(
      `${base()}/v1/me/api-keys/${encodeURIComponent(id)}/regenerate`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${tok}` },
        cache: "no-store",
      },
    );
    const json = (await readJson(res)) as
      | (MintedUserApiKey & { error?: string; message?: string })
      | null;
    if (!res.ok || !json || !("key" in json)) {
      return {
        ok: false,
        status: res.status,
        code: json?.error ?? "regenerate_failed",
        message: json?.message,
      };
    }
    return { ok: true, data: json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export const ALL_SCOPES: readonly string[] = [
  "bracket:write",
  "picks:write",
  "share:write",
];
