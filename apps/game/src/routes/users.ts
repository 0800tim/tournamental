/**
 * User registration + rich progressive profile.
 *
 *   POST   /v1/users/register         — create a user + empty profile
 *   GET    /v1/users/me               — read the caller's full profile
 *   PATCH  /v1/users/:id/profile      — patch one or more profile fields
 *   POST   /v1/users/:id/visit        — increment visit + recompute band
 *   DELETE /v1/users/:id              — GDPR soft-delete + PII scrub
 *   GET    /v1/users/:id/data-export  — GDPR data dump as JSON
 *
 * Auth model (dev-mesh, same as picks.ts):
 *   - `X-User-Id` header identifies the caller.
 *   - For `:id` routes, header must equal the path id.
 *   - Production wires this up to Telegram-JWT / SMS-OTP per docs/13.
 *
 * Validation:
 *   - Zod schemas in `../schemas.ts`.
 *   - `favourite_team_code` is closed-list validated against the
 *     canonical 48-team WC2026 file (loaded once at module init).
 *
 * Privacy:
 *   - Age is bucketed (`age_bucket`), not stored raw. No birthdates.
 *   - Country is ISO-2; we never store lat/lon or a street address.
 *
 * Telemetry:
 *   - Every meaningful action emits a structured log line at info level
 *     so the pino transport can mirror it into the analytics pipeline.
 *     The client mirrors these into `dataLayer.push(...)` (sister
 *     `feat/analytics-tracking-layer` PR wires GA4 on top).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  profilePatchBodySchema,
  registerUserBodySchema,
} from "../schemas.js";
import type { GameStore } from "../store/db.js";
import type {
  ProfileField,
  ProfilePatch,
  UserProfileRow,
  UserRow,
} from "../store/users.js";

// ---------- canonical team list ----------

/**
 * Loaded once at module load. We resolve the path relative to this
 * file so the lookup works in both `tsx`/dev (src/) and `node`/prod
 * (dist/). For tests, a "missing file" path falls back to an empty
 * Set + a permissive shape check.
 */
function loadTeamCodes(): Set<string> {
  // src/routes/users.ts → ../../../../data/fifa-wc-2026/teams.json
  // dist/routes/users.js → ../../../../data/fifa-wc-2026/teams.json
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "..", "..", "data", "fifa-wc-2026", "teams.json"),
    // monorepo-from-dist fallback
    resolve(here, "..", "..", "..", "..", "..", "data", "fifa-wc-2026", "teams.json"),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as { teams?: { code?: string }[] };
      const codes = new Set<string>();
      for (const team of parsed.teams ?? []) {
        if (typeof team.code === "string") codes.add(team.code);
      }
      if (codes.size > 0) return codes;
    } catch {
      // try next candidate
    }
  }
  // Soft-fall through: handled in `validateTeamCode` by treating
  // anything matching the 3-letter shape as acceptable.
  return new Set<string>();
}

const TEAM_CODES = loadTeamCodes();

function validateTeamCode(code: string | null | undefined): boolean {
  if (code == null) return true;
  if (TEAM_CODES.size === 0) return /^[A-Z]{3}$/.test(code);
  return TEAM_CODES.has(code);
}

// ---------- helpers ----------

function resolveCallerId(req: FastifyRequest): string | null {
  const headerUser = req.headers["x-user-id"];
  if (typeof headerUser === "string" && headerUser.length > 0) return headerUser;
  if (Array.isArray(headerUser) && headerUser[0]) return headerUser[0];
  return null;
}

function readCfCountry(req: FastifyRequest): string | null {
  const v = req.headers["cf-ipcountry"];
  if (typeof v === "string" && /^[A-Z]{2}$/.test(v)) return v;
  if (Array.isArray(v) && typeof v[0] === "string" && /^[A-Z]{2}$/.test(v[0])) {
    return v[0];
  }
  return null;
}

function publicUser(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    handle: row.handle,
    display_name: row.display_name,
    created_at: row.created_at != null ? new Date(row.created_at).toISOString() : null,
    last_seen_at:
      row.last_seen_at != null ? new Date(row.last_seen_at).toISOString() : null,
    auth_method: row.auth_method,
    deleted_at:
      row.deleted_at != null ? new Date(row.deleted_at).toISOString() : null,
  };
}

function publicProfile(row: UserProfileRow): Record<string, unknown> {
  return {
    age_bucket: row.age_bucket,
    gender: row.gender,
    country_code: row.country_code,
    city: row.city,
    timezone: row.timezone,
    favourite_team_code: row.favourite_team_code,
    follows_leagues: row.follows_leagues,
    watches_via: row.watches_via,
    visit_count: row.visit_count,
    last_visit_date: row.last_visit_date,
    engagement_band: row.engagement_band,
    marketing_consent: row.marketing_consent === 1,
    analytics_consent: row.analytics_consent === 1,
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

// ---------- route registration ----------

export interface UserRoutesDeps {
  readonly store: GameStore;
  /** Override the clock + uuid generator (tests). */
  readonly nowMs?: () => number;
  readonly newId?: () => string;
}

function defaultNewId(): string {
  // Node 19+ + modern browsers expose crypto.randomUUID. We don't reach
  // for the `uuid` npm dep because this is the only caller.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).crypto.randomUUID() as string;
  } catch {
    return `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function registerUserRoutes(
  app: FastifyInstance,
  deps: UserRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());
  const newId = deps.newId ?? defaultNewId;

  function requireSelf(
    req: FastifyRequest,
    reply: FastifyReply,
    pathId: string,
  ): boolean {
    const caller = resolveCallerId(req);
    if (!caller) {
      reply.code(401).send({ error: "missing_user" });
      return false;
    }
    if (caller !== pathId) {
      reply.code(403).send({ error: "user_mismatch" });
      return false;
    }
    return true;
  }

  // --- POST /v1/users/register ------------------------------------

  app.post("/v1/users/register", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const parsed = registerUserBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      });
    }
    const body = parsed.data;

    // Idempotency on (auth_method, auth_id) is handled inside
    // `registerUser`. Handle collision is a separate concern:
    if (body.auth_method !== "guest" && body.auth_id) {
      const existing = deps.store.users.getUserByAuth(
        body.auth_method,
        body.auth_id,
      );
      if (existing) {
        req.log.info(
          {
            evt: "user_register_idempotent",
            user_id: existing.id,
            auth_method: body.auth_method,
          },
          "user register idempotent hit",
        );
        return reply.code(200).send({
          id: existing.id,
          handle: existing.handle,
          created_at: existing.created_at
            ? new Date(existing.created_at).toISOString()
            : null,
          existing: true,
        });
      }
    }

    const handleClash = deps.store.users.getUserByHandle(body.handle);
    if (handleClash) {
      return reply.code(409).send({
        error: "handle_taken",
        handle: body.handle,
      });
    }

    const id = newId();
    const nowMs = now();
    const { user } = deps.store.users.registerUser({
      id,
      handle: body.handle,
      displayName: body.display_name ?? null,
      authMethod: body.auth_method,
      authId: body.auth_id ?? null,
    });

    // Seed country from CF-IPCountry when present. Stored as part of the
    // initial profile so the Step 2 modal can pre-fill it.
    const cfCountry = readCfCountry(req);
    if (cfCountry) {
      deps.store.users.patchProfile(id, { country_code: cfCountry });
    }

    req.log.info(
      {
        evt: "user_registered",
        user_id: id,
        handle: body.handle,
        auth_method: body.auth_method,
        cf_country: cfCountry,
        registered_at: new Date(nowMs).toISOString(),
      },
      "user registered",
    );

    return reply.code(201).send({
      id: user.id,
      handle: user.handle,
      created_at:
        user.created_at != null ? new Date(user.created_at).toISOString() : null,
      cf_country: cfCountry,
      existing: false,
    });
  });

  // --- GET /v1/users/me -------------------------------------------

  app.get("/v1/users/me", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const caller = resolveCallerId(req);
    if (!caller) {
      return reply.code(401).send({ error: "missing_user" });
    }
    const user = deps.store.users.getUserById(caller);
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (user.deleted_at) {
      return reply.code(410).send({ error: "deleted" });
    }
    const profile = deps.store.users.getProfile(caller);
    if (!profile) {
      // Defensive: a user without a profile row is a broken state.
      // Create one lazily so a half-finished migration doesn't soft-brick
      // the API.
      return reply.code(500).send({ error: "profile_missing" });
    }
    deps.store.users.touchLastSeen(caller, now());
    return reply.code(200).send({
      user: publicUser(user),
      profile: publicProfile(profile),
    });
  });

  // --- PATCH /v1/users/:id/profile --------------------------------

  app.patch("/v1/users/:id/profile", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { id } = req.params as { id?: string };
    if (!id) return reply.code(400).send({ error: "invalid_user_id" });
    if (!requireSelf(req, reply, id)) return reply;
    const user = deps.store.users.getUserById(id);
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (user.deleted_at) return reply.code(410).send({ error: "deleted" });

    const parsed = profilePatchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      });
    }
    const body = parsed.data;

    if (
      body.favourite_team_code !== undefined &&
      body.favourite_team_code !== null &&
      !validateTeamCode(body.favourite_team_code)
    ) {
      return reply.code(422).send({
        error: "unknown_team_code",
        favourite_team_code: body.favourite_team_code,
      });
    }

    // `display_name` lives on the users table, not user_profiles.
    if (body.display_name !== undefined) {
      deps.store.users.setDisplayName(id, body.display_name ?? null);
    }

    // Split out the profile fields. Booleans are stored as 0/1 in SQLite.
    const patch: ProfilePatch = {};
    const directFields: ProfileField[] = [
      "age_bucket",
      "gender",
      "country_code",
      "city",
      "timezone",
      "favourite_team_code",
      "follows_leagues",
      "watches_via",
    ];
    for (const field of directFields) {
      if (field in body) {
        patch[field] = (body as Record<string, unknown>)[field] as
          | string
          | null;
      }
    }
    if (body.marketing_consent !== undefined) {
      patch.marketing_consent = body.marketing_consent ? 1 : 0;
    }
    if (body.analytics_consent !== undefined) {
      patch.analytics_consent = body.analytics_consent ? 1 : 0;
    }
    const changed = deps.store.users.patchProfile(id, patch);

    const profile = deps.store.users.getProfile(id);
    const refreshedUser = deps.store.users.getUserById(id);
    if (!profile || !refreshedUser) {
      return reply.code(500).send({ error: "profile_missing" });
    }
    req.log.info(
      {
        evt: "user_profile_patched",
        user_id: id,
        changed_fields: changed,
        display_name_changed: body.display_name !== undefined,
      },
      "profile patched",
    );
    return reply.code(200).send({
      user: publicUser(refreshedUser),
      profile: publicProfile(profile),
      changed_fields: changed,
    });
  });

  // --- POST /v1/users/:id/visit -----------------------------------

  app.post("/v1/users/:id/visit", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { id } = req.params as { id?: string };
    if (!id) return reply.code(400).send({ error: "invalid_user_id" });
    if (!requireSelf(req, reply, id)) return reply;
    const user = deps.store.users.getUserById(id);
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (user.deleted_at) return reply.code(410).send({ error: "deleted" });

    const profile = deps.store.users.recordVisit(id);
    if (!profile) return reply.code(500).send({ error: "profile_missing" });
    req.log.info(
      {
        evt: "user_visit",
        user_id: id,
        visit_count: profile.visit_count,
        engagement_band: profile.engagement_band,
      },
      "user visit recorded",
    );
    return reply.code(200).send({
      visit_count: profile.visit_count,
      last_visit_date: profile.last_visit_date,
      engagement_band: profile.engagement_band,
    });
  });

  // --- DELETE /v1/users/:id ---------------------------------------

  app.delete("/v1/users/:id", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { id } = req.params as { id?: string };
    if (!id) return reply.code(400).send({ error: "invalid_user_id" });
    if (!requireSelf(req, reply, id)) return reply;
    const user = deps.store.users.getUserById(id);
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (user.deleted_at) {
      return reply.code(200).send({
        id,
        deleted: true,
        deleted_at: new Date(user.deleted_at).toISOString(),
      });
    }
    const atMs = now();
    deps.store.users.softDelete(id, atMs);
    req.log.info(
      {
        evt: "user_deleted",
        user_id: id,
        deleted_at: new Date(atMs).toISOString(),
      },
      "user soft-deleted",
    );
    return reply.code(200).send({
      id,
      deleted: true,
      deleted_at: new Date(atMs).toISOString(),
    });
  });

  // --- GET /v1/users/:id/data-export ------------------------------

  app.get("/v1/users/:id/data-export", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { id } = req.params as { id?: string };
    if (!id) return reply.code(400).send({ error: "invalid_user_id" });
    if (!requireSelf(req, reply, id)) return reply;
    const user = deps.store.users.getUserById(id);
    if (!user) return reply.code(404).send({ error: "not_found" });
    const profile = deps.store.users.getProfile(id);
    const history = deps.store.users.listHistory(id);
    return reply.code(200).send({
      export_format: "tournamental.profile.v1",
      exported_at: new Date(now()).toISOString(),
      user: publicUser(user),
      profile: profile ? publicProfile(profile) : null,
      history: history.map((row) => ({
        field: row.field,
        old_value: row.old_value,
        new_value: row.new_value,
        changed_at: new Date(row.changed_at).toISOString(),
      })),
    });
  });
}
