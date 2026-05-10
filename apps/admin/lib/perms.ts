/**
 * RBAC for the admin dashboard.
 *
 * Three roles, listed in increasing privilege:
 *
 *   - viewer       (read-only access to every surface)
 *   - mod          (everything viewer + ban/unban + content moderation)
 *   - super-admin  (everything mod + tournament edits, feature flags,
 *                  api-key revocation, admin allowlist edits)
 *
 * The role assignment is read from `ADMIN_ROLES` env var as
 *   email:role,email:role
 * Anyone in `ADMIN_EMAILS` not present in `ADMIN_ROLES` defaults to
 * "viewer". Anyone not in `ADMIN_EMAILS` cannot log in at all.
 *
 * The matrix below is consulted by every server action and route that
 * mutates state. The default-deny behaviour is critical: every action
 * names a permission key, and an unknown key is rejected.
 */

export type Role = "super-admin" | "mod" | "viewer";

export type Permission =
  | "users.read"
  | "users.ban"
  | "users.unban"
  | "syndicates.read"
  | "syndicates.write"
  | "tournaments.read"
  | "tournaments.write"
  | "fixtures.override"
  | "content.moderate"
  | "affiliate.read"
  | "analytics.read"
  | "feature-flags.read"
  | "feature-flags.write"
  | "api-keys.read"
  | "api-keys.revoke"
  | "audit-log.read"
  | "settings.read"
  | "settings.write"
  | "operators.read"
  | "operators.write"
  | "advertisers.read"
  | "advertisers.write"
  | "revenue.read";

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  "super-admin": new Set<Permission>([
    "users.read",
    "users.ban",
    "users.unban",
    "syndicates.read",
    "syndicates.write",
    "tournaments.read",
    "tournaments.write",
    "fixtures.override",
    "content.moderate",
    "affiliate.read",
    "analytics.read",
    "feature-flags.read",
    "feature-flags.write",
    "api-keys.read",
    "api-keys.revoke",
    "audit-log.read",
    "settings.read",
    "settings.write",
    "operators.read",
    "operators.write",
    "advertisers.read",
    "advertisers.write",
    "revenue.read",
  ]),
  mod: new Set<Permission>([
    "users.read",
    "users.ban",
    "users.unban",
    "syndicates.read",
    "tournaments.read",
    "content.moderate",
    "affiliate.read",
    "analytics.read",
    "feature-flags.read",
    "audit-log.read",
    "settings.read",
    "operators.read",
    "advertisers.read",
    "revenue.read",
  ]),
  viewer: new Set<Permission>([
    "users.read",
    "syndicates.read",
    "tournaments.read",
    "affiliate.read",
    "analytics.read",
    "feature-flags.read",
    "audit-log.read",
    "settings.read",
    "operators.read",
    "advertisers.read",
    "revenue.read",
  ]),
};

export function can(role: Role | undefined, perm: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.has(perm) ?? false;
}

/**
 * Parse `ADMIN_ROLES` env var: "a@b.com:mod,c@d.com:super-admin".
 * Unknown roles are dropped silently (default-deny).
 */
export function parseRoleMap(raw: string | undefined): Map<string, Role> {
  const map = new Map<string, Role>();
  if (!raw) return map;
  for (const entry of raw.split(",")) {
    const [email, role] = entry.split(":").map((s) => s.trim().toLowerCase());
    if (!email || !role) continue;
    if (role === "super-admin" || role === "mod" || role === "viewer") {
      map.set(email, role);
    }
  }
  return map;
}

/**
 * Resolve a role for an email. Always falls back to "viewer" when the
 * email is in the admin allowlist but unmapped, and undefined otherwise.
 */
export function roleFor(
  email: string,
  allowlist: ReadonlySet<string>,
  roleMap: ReadonlyMap<string, Role>,
): Role | undefined {
  const k = email.trim().toLowerCase();
  if (!allowlist.has(k)) return undefined;
  return roleMap.get(k) ?? "viewer";
}

/**
 * Build the admin email allowlist from env. Empty allowlist means
 * the dashboard is locked — no one can log in.
 */
export function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
