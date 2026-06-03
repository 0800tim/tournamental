/**
 * Direct read of verified contact details (email, phone) for one or
 * more auth-sms users by user id. Used by:
 *
 *   - lib/syndicate/notify-join-request.ts — resolve the pool owner's
 *     *current* contact so notifications can't be misdelivered via the
 *     stale denormalised `syndicates.owner_email` column.
 *   - app/api/v1/syndicates/route.ts — gate pool creation on the
 *     creator having a verified email on their auth-sms profile, and
 *     bind the created row's `owner_email` to that verified value
 *     rather than trusting the form input.
 *
 * Why direct sqlite (not an HTTP call to auth-sms): the auth-sms HTTP
 * surface intentionally hides PII (email, phone) on the public
 * `/v1/auth/users/:id/public` endpoint. The web app and auth-sms are
 * colocated on the same box, so a read-only open against `auth.db`
 * stays well inside the trust boundary and avoids inventing a new
 * internal HTTP endpoint just for this lookup.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";

export interface UserContact {
  readonly email: string | null;
  readonly phone: string | null;
}

function resolveAuthDbPath(): string | null {
  const explicit =
    process.env.AUTH_DB_PATH ?? process.env.AUTH_SMS_DB_PATH ?? null;
  if (explicit) return explicit;
  const root = resolve(process.cwd(), "..", "..");
  return resolve(root, "apps/auth-sms/data/auth.db");
}

/** Batch lookup of (email, phone) by user id. Unknown / unresolvable
 *  ids are simply absent from the returned map; callers should treat a
 *  missing entry as "no contact on file" rather than as an error. */
export function loadUserContacts(
  userIds: ReadonlyArray<string | null | undefined>,
): Map<string, UserContact> {
  const out = new Map<string, UserContact>();
  const ids = userIds.filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  if (ids.length === 0) return out;
  const path = resolveAuthDbPath();
  if (!path || !existsSync(path)) return out;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, email, phone FROM user WHERE id IN (${placeholders})`)
      .all(...ids) as { id: string; email: string | null; phone: string | null }[];
    db.close();
    for (const r of rows) {
      out.set(r.id, {
        email: r.email?.trim() || null,
        phone: r.phone?.trim() || null,
      });
    }
  } catch (err) {
    console.error("[contact-lookup] loadUserContacts failed", err);
  }
  return out;
}

/** Single-id convenience wrapper. */
export function loadUserContact(userId: string | null | undefined): UserContact | null {
  if (!userId) return null;
  return loadUserContacts([userId]).get(userId) ?? null;
}
