/**
 * Super-admin recognition for the play app.
 *
 * Tim 2026-06-04: there's no formal admin role in the user table — the
 * site is meant to be operated by a single Tournamental staff identity
 * (initially Tim, later whoever's on duty). Rather than ship a roles
 * column + migration, we recognise super-admins purely by env-var
 * matching against the live session.
 *
 * The check answers a single question: "is this caller allowed to do
 * anything a pool owner can do, on any pool?" Server-side routes that
 * gate on owner_user_id / owner_phone should OR this in, and UI
 * components that render the "Manage" affordance should mirror the
 * same OR.
 *
 * Configuration:
 *
 *   SUPER_ADMIN_USER_IDS  comma-separated `u_<hex>` ids
 *   SUPER_ADMIN_PHONES    comma-separated E.164 phone numbers
 *
 * Either list match grants super-admin. Both lists are optional.
 * Empty / unset env => no super-admins (the default for self-hosted
 * forks).
 *
 * Defence-in-depth: the env vars are read fresh on every check so
 * rotating without a redeploy works. The cost is negligible.
 */

interface SessionLike {
  readonly userId?: string | null;
  readonly phone?: string | null;
}

function parseList(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isSuperAdmin(session: SessionLike | null | undefined): boolean {
  if (!session) return false;
  const idList = parseList(process.env.SUPER_ADMIN_USER_IDS);
  const phoneList = parseList(process.env.SUPER_ADMIN_PHONES);
  if (idList.length === 0 && phoneList.length === 0) return false;
  if (session.userId && idList.includes(session.userId)) return true;
  if (session.phone && phoneList.includes(session.phone)) return true;
  return false;
}
