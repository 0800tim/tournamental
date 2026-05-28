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

// Note: the previous email allowlist + role-map helpers
// (parseAllowlist / parseRoleMap / roleFor) were removed when the admin
// gate moved from magic-link sign-in to WhatsApp-OTP step-up. The new
// allowlist is `ADMIN_ALLOWED_USER_IDS` and is consumed directly by
// `lib/auth.ts::getAllowedUserIds`. For now every authed admin operates
// at "super-admin"; the role matrix above is kept intact so we can
// reintroduce multi-tier RBAC by mapping userIds → roles in a single
// helper later.
