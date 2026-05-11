/**
 * Thin client wrappers for the game-service user/profile endpoints.
 *
 * Why a plain object module not a hook: registration is a one-shot
 * action triggered from a modal, profile edits are imperative button
 * presses, and the data is small enough that a hook would just be a
 * `useState` + a thunk. Keeping the API surface as flat functions makes
 * the call sites testable without the React rendering tree.
 */

import { pushDataLayer } from "./storage";

const GAME_BASE =
  process.env.NEXT_PUBLIC_VTORN_GAME_URL ?? "https://vtorn-game.aiva.nz";

export interface RegisterInput {
  readonly handle: string;
  readonly auth_method: "telegram" | "sms" | "email-magic-link" | "guest";
  readonly auth_id?: string;
  readonly display_name?: string;
}

export interface RegisterResult {
  readonly id: string;
  readonly handle: string;
  readonly created_at: string | null;
  readonly cf_country?: string | null;
  readonly existing: boolean;
}

export interface UserProfile {
  readonly age_bucket: string | null;
  readonly gender: string | null;
  readonly country_code: string | null;
  readonly city: string | null;
  readonly timezone: string | null;
  readonly favourite_team_code: string | null;
  readonly follows_leagues: string | null;
  readonly watches_via: string | null;
  readonly visit_count: number;
  readonly last_visit_date: string | null;
  readonly engagement_band: "cold" | "warm" | "hot";
  readonly marketing_consent: boolean;
  readonly analytics_consent: boolean;
  readonly updated_at: string;
}

export interface MeResponse {
  readonly user: {
    readonly id: string;
    readonly handle: string;
    readonly display_name: string | null;
    readonly auth_method: string | null;
    readonly created_at: string | null;
    readonly last_seen_at: string | null;
    readonly deleted_at: string | null;
  };
  readonly profile: UserProfile;
}

export interface ApiOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

function base(opts: ApiOptions = {}): string {
  return opts.baseUrl ?? GAME_BASE;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function registerUser(
  input: RegisterInput,
  opts: ApiOptions = {},
): Promise<RegisterResult> {
  const f = opts.fetchImpl ?? fetch;
  pushDataLayer("tournamental.profile.signup-attempt", {
    auth_method: input.auth_method,
  });
  const res = await f(`${base(opts)}/v1/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await readJson(res)) as RegisterResult & { error?: string };
  if (!res.ok) {
    pushDataLayer("tournamental.profile.signup-error", {
      status: res.status,
      code: body?.error ?? "unknown",
    });
    throw Object.assign(new Error(body?.error ?? "register_failed"), {
      status: res.status,
      body,
    });
  }
  pushDataLayer("tournamental.profile.signup-complete", {
    auth_method: input.auth_method,
    existing: body.existing,
  });
  return body;
}

export async function getMe(
  userId: string,
  opts: ApiOptions = {},
): Promise<MeResponse> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${base(opts)}/v1/users/me`, {
    headers: { "x-user-id": userId },
  });
  if (!res.ok) {
    throw Object.assign(new Error("me_failed"), { status: res.status });
  }
  return (await res.json()) as MeResponse;
}

export interface ProfilePatchInput {
  age_bucket?: string | null;
  gender?: string | null;
  country_code?: string | null;
  city?: string | null;
  timezone?: string | null;
  favourite_team_code?: string | null;
  follows_leagues?: string | null;
  watches_via?: string | null;
  marketing_consent?: boolean;
  analytics_consent?: boolean;
  display_name?: string | null;
}

export async function patchProfile(
  userId: string,
  patch: ProfilePatchInput,
  opts: ApiOptions = {},
): Promise<MeResponse> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${base(opts)}/v1/users/${userId}/profile`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await readJson(res);
    throw Object.assign(new Error("profile_patch_failed"), {
      status: res.status,
      body,
    });
  }
  const body = (await res.json()) as MeResponse & {
    readonly changed_fields: string[];
  };
  for (const field of body.changed_fields ?? []) {
    pushDataLayer("tournamental.profile.field-saved", { field });
  }
  return body;
}

export async function postVisit(
  userId: string,
  opts: ApiOptions = {},
): Promise<{
  readonly visit_count: number;
  readonly last_visit_date: string | null;
  readonly engagement_band: "cold" | "warm" | "hot";
}> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${base(opts)}/v1/users/${userId}/visit`, {
    method: "POST",
    headers: { "x-user-id": userId },
  });
  if (!res.ok) {
    throw Object.assign(new Error("visit_failed"), { status: res.status });
  }
  return (await res.json()) as {
    visit_count: number;
    last_visit_date: string | null;
    engagement_band: "cold" | "warm" | "hot";
  };
}

export async function deleteUser(
  userId: string,
  opts: ApiOptions = {},
): Promise<{ readonly deleted: true; readonly deleted_at: string }> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${base(opts)}/v1/users/${userId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  });
  if (!res.ok) {
    throw Object.assign(new Error("delete_failed"), { status: res.status });
  }
  pushDataLayer("tournamental.profile.deleted", { user_id: userId });
  return (await res.json()) as { deleted: true; deleted_at: string };
}

export async function downloadDataExport(
  userId: string,
  opts: ApiOptions = {},
): Promise<unknown> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${base(opts)}/v1/users/${userId}/data-export`, {
    headers: { "x-user-id": userId },
  });
  if (!res.ok) {
    throw Object.assign(new Error("export_failed"), { status: res.status });
  }
  const data = await res.json();
  pushDataLayer("tournamental.profile.export-downloaded", { user_id: userId });
  return data;
}
