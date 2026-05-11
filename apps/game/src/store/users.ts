/**
 * User + profile store.
 *
 * Lives next to `apps/game/src/store/db.ts` (the bracket/match store). We
 * deliberately don't bolt the prepared statements onto `GameStore`
 * because:
 *   - Profile concerns are independent from scoring concerns.
 *   - Tests that only exercise scoring don't need a profile schema to
 *     load.
 *   - Keeping it in a separate class makes the surface easy to mock
 *     when the route handlers grow.
 *
 * Shape conventions match `GameStore`: synchronous better-sqlite3, all
 * timestamps are epoch ms (`INTEGER`), all reads return `null` rather
 * than `undefined` so callers can `?? defaultValue` cleanly.
 */

import type { Database as DatabaseT, Statement } from "better-sqlite3";

// ---------- row types ----------

export interface UserRow {
  id: string;
  created_at: number;
  handle: string | null;
  display_name: string | null;
  last_seen_at: number | null;
  auth_method: string | null;
  auth_id: string | null;
  deleted_at: number | null;
}

export interface UserProfileRow {
  user_id: string;
  age_bucket: string | null;
  gender: string | null;
  country_code: string | null;
  city: string | null;
  timezone: string | null;
  favourite_team_code: string | null;
  follows_leagues: string | null;
  watches_via: string | null;
  visit_count: number;
  last_visit_date: string | null;
  engagement_band: string;
  marketing_consent: number;
  analytics_consent: number;
  updated_at: number;
}

export interface UserProfileHistoryRow {
  id: number;
  user_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: number;
}

// ---------- profile field whitelist ----------

/**
 * All profile fields the PATCH endpoint may write to. Anything not in
 * this set is rejected before it touches the DB.
 *
 * Kept as a tuple so TS can derive a strict literal union; loop helpers
 * iterate this list when building the history rows.
 */
export const PROFILE_FIELDS = [
  "age_bucket",
  "gender",
  "country_code",
  "city",
  "timezone",
  "favourite_team_code",
  "follows_leagues",
  "watches_via",
  "marketing_consent",
  "analytics_consent",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type ProfilePatch = Partial<Record<ProfileField, string | number | null>>;

// ---------- store ----------

export interface UserStoreOptions {
  /** Override the clock (tests). Defaults to Date.now. */
  now?: () => number;
}

export class UserStore {
  private readonly now: () => number;

  // user statements
  private insertUserStmt!: Statement;
  private getUserByIdStmt!: Statement;
  private getUserByHandleStmt!: Statement;
  private getUserByAuthStmt!: Statement;
  private updateLastSeenStmt!: Statement;
  private updateHandleStmt!: Statement;
  private updateDisplayNameStmt!: Statement;
  private softDeleteUserStmt!: Statement;
  private scrubUserPiiStmt!: Statement;

  // profile statements
  private insertProfileStmt!: Statement;
  private getProfileByIdStmt!: Statement;
  private updateProfileFieldStmt = new Map<ProfileField, Statement>();
  private updateProfileVisitStmt!: Statement;
  private scrubProfilePiiStmt!: Statement;
  private insertHistoryStmt!: Statement;
  private listHistoryStmt!: Statement;

  constructor(
    private readonly db: DatabaseT,
    opts: UserStoreOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.prepareStatements();
  }

  // ---------- prepare ----------

  private prepareStatements(): void {
    this.insertUserStmt = this.db.prepare(
      `INSERT INTO users
         (id, created_at, handle, display_name, last_seen_at, auth_method, auth_id)
       VALUES (@id, @created_at, @handle, @display_name, @last_seen_at, @auth_method, @auth_id)`,
    );
    this.getUserByIdStmt = this.db.prepare(
      `SELECT * FROM users WHERE id = ?`,
    );
    this.getUserByHandleStmt = this.db.prepare(
      `SELECT * FROM users WHERE handle = ? COLLATE NOCASE`,
    );
    this.getUserByAuthStmt = this.db.prepare(
      `SELECT * FROM users WHERE auth_method = ? AND auth_id = ?`,
    );
    this.updateLastSeenStmt = this.db.prepare(
      `UPDATE users SET last_seen_at = ? WHERE id = ?`,
    );
    this.updateHandleStmt = this.db.prepare(
      `UPDATE users SET handle = ? WHERE id = ?`,
    );
    this.updateDisplayNameStmt = this.db.prepare(
      `UPDATE users SET display_name = ? WHERE id = ?`,
    );
    this.softDeleteUserStmt = this.db.prepare(
      `UPDATE users SET deleted_at = ? WHERE id = ?`,
    );
    this.scrubUserPiiStmt = this.db.prepare(
      `UPDATE users SET display_name = NULL, auth_id = NULL WHERE id = ?`,
    );

    this.insertProfileStmt = this.db.prepare(
      `INSERT INTO user_profiles (user_id, updated_at) VALUES (?, ?)`,
    );
    this.getProfileByIdStmt = this.db.prepare(
      `SELECT * FROM user_profiles WHERE user_id = ?`,
    );
    for (const field of PROFILE_FIELDS) {
      this.updateProfileFieldStmt.set(
        field,
        this.db.prepare(
          `UPDATE user_profiles SET ${field} = @value, updated_at = @updated_at WHERE user_id = @user_id`,
        ),
      );
    }
    this.updateProfileVisitStmt = this.db.prepare(
      `UPDATE user_profiles
          SET visit_count = @visit_count,
              last_visit_date = @last_visit_date,
              engagement_band = @engagement_band,
              updated_at = @updated_at
        WHERE user_id = @user_id`,
    );
    this.scrubProfilePiiStmt = this.db.prepare(
      `UPDATE user_profiles
          SET age_bucket = NULL,
              gender = NULL,
              city = NULL,
              follows_leagues = NULL,
              watches_via = NULL,
              marketing_consent = 0,
              updated_at = @updated_at
        WHERE user_id = @user_id`,
    );
    this.insertHistoryStmt = this.db.prepare(
      `INSERT INTO user_profile_history (user_id, field, old_value, new_value, changed_at)
       VALUES (@user_id, @field, @old_value, @new_value, @changed_at)`,
    );
    this.listHistoryStmt = this.db.prepare(
      `SELECT * FROM user_profile_history WHERE user_id = ? ORDER BY changed_at ASC, id ASC`,
    );
  }

  // ---------- users ----------

  /**
   * Create a user + an empty profile row in one transaction. Idempotent
   * on (auth_method, auth_id): if a row with the same pair exists, the
   * existing row is returned and no insert happens. This matches the
   * Telegram-bot resume flow where the same `telegram_id` keeps logging
   * back in.
   */
  registerUser(args: {
    id: string;
    handle: string;
    displayName?: string | null;
    authMethod?: string | null;
    authId?: string | null;
  }): { user: UserRow; created: boolean } {
    if (args.authMethod && args.authId) {
      const existing = this.getUserByAuth(args.authMethod, args.authId);
      if (existing) return { user: existing, created: false };
    }
    const now = this.now();
    const tx = this.db.transaction(() => {
      this.insertUserStmt.run({
        id: args.id,
        created_at: now,
        handle: args.handle,
        display_name: args.displayName ?? null,
        last_seen_at: now,
        auth_method: args.authMethod ?? null,
        auth_id: args.authId ?? null,
      });
      this.insertProfileStmt.run(args.id, now);
    });
    tx();
    const row = this.getUserById(args.id);
    if (!row) {
      throw new Error("user_register_race");
    }
    return { user: row, created: true };
  }

  getUserById(id: string): UserRow | null {
    const row = this.getUserByIdStmt.get(id) as UserRow | undefined;
    return row ?? null;
  }

  getUserByHandle(handle: string): UserRow | null {
    const row = this.getUserByHandleStmt.get(handle) as UserRow | undefined;
    return row ?? null;
  }

  getUserByAuth(method: string, authId: string): UserRow | null {
    const row = this.getUserByAuthStmt.get(method, authId) as
      | UserRow
      | undefined;
    return row ?? null;
  }

  touchLastSeen(userId: string, atMs: number = this.now()): void {
    this.updateLastSeenStmt.run(atMs, userId);
  }

  setHandle(userId: string, handle: string): void {
    this.updateHandleStmt.run(handle, userId);
  }

  setDisplayName(userId: string, displayName: string | null): void {
    this.updateDisplayNameStmt.run(displayName, userId);
  }

  /**
   * GDPR soft-delete: mark the user as deleted and scrub PII from both
   * `users` and `user_profiles` in one transaction. The `users.id` row
   * is retained for referential integrity on `brackets` /
   * `syndicate_members` / `verified_pundit_records`. A nightly job
   * (TODO docs/32) hard-deletes rows older than 30 days.
   */
  softDelete(userId: string, atMs: number = this.now()): void {
    const tx = this.db.transaction(() => {
      this.softDeleteUserStmt.run(atMs, userId);
      this.scrubUserPiiStmt.run(userId);
      this.scrubProfilePiiStmt.run({ user_id: userId, updated_at: atMs });
      this.insertHistoryStmt.run({
        user_id: userId,
        field: "__deleted__",
        old_value: null,
        new_value: new Date(atMs).toISOString(),
        changed_at: atMs,
      });
    });
    tx();
  }

  // ---------- profiles ----------

  getProfile(userId: string): UserProfileRow | null {
    const row = this.getProfileByIdStmt.get(userId) as
      | UserProfileRow
      | undefined;
    return row ?? null;
  }

  /**
   * Apply a profile patch and append a `user_profile_history` row per
   * changed field. Returns the list of fields actually changed (so the
   * caller can emit a granular dataLayer event).
   *
   * Fields present in the patch but identical to the current value do
   * not produce a history row.
   */
  patchProfile(userId: string, patch: ProfilePatch): ProfileField[] {
    const current = this.getProfile(userId);
    if (!current) return [];
    const changed: ProfileField[] = [];
    const now = this.now();
    const tx = this.db.transaction(() => {
      for (const field of PROFILE_FIELDS) {
        if (!(field in patch)) continue;
        const next = patch[field];
        const prev = (current as unknown as Record<ProfileField, unknown>)[
          field
        ];
        if (next === prev) continue;
        const stmt = this.updateProfileFieldStmt.get(field);
        if (!stmt) continue;
        stmt.run({ value: next, updated_at: now, user_id: userId });
        this.insertHistoryStmt.run({
          user_id: userId,
          field,
          old_value: prev == null ? null : String(prev),
          new_value: next == null ? null : String(next),
          changed_at: now,
        });
        changed.push(field);
      }
    });
    tx();
    return changed;
  }

  /**
   * Idempotent-per-day visit counter. If `last_visit_date` is already
   * today, this is a no-op other than touching `last_seen_at`. Returns
   * the updated profile row (or null if it didn't exist).
   *
   * Bands:
   *   cold: visit_count < 3
   *   warm: 3 <= visit_count < 10, OR last visit > 7 days ago
   *   hot:  visit_count >= 10 AND last visit within 7 days
   *
   * The "7 days ago" check uses the *previous* last_visit_date — i.e.
   * the state *before* this visit. Otherwise every user is "within
   * 7 days" on the visit that triggers the upgrade, which trivialises
   * the warm tier.
   */
  recordVisit(
    userId: string,
    today: string = isoDate(this.now()),
  ): UserProfileRow | null {
    const profile = this.getProfile(userId);
    if (!profile) return null;
    const lastVisitDate = profile.last_visit_date;
    const newVisitCount =
      lastVisitDate === today
        ? profile.visit_count
        : profile.visit_count + 1;
    const band = computeEngagementBand({
      visitCount: newVisitCount,
      lastVisitDate,
      today,
    });
    const now = this.now();
    const tx = this.db.transaction(() => {
      this.updateProfileVisitStmt.run({
        visit_count: newVisitCount,
        last_visit_date: today,
        engagement_band: band,
        updated_at: now,
        user_id: userId,
      });
      this.updateLastSeenStmt.run(now, userId);
    });
    tx();
    return this.getProfile(userId);
  }

  listHistory(userId: string): UserProfileHistoryRow[] {
    return this.listHistoryStmt.all(userId) as UserProfileHistoryRow[];
  }
}

// ---------- helpers ----------

/** ISO YYYY-MM-DD for a given epoch ms (UTC). */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Number of whole days between two YYYY-MM-DD strings (b - a). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86_400_000);
}

export function computeEngagementBand(args: {
  visitCount: number;
  lastVisitDate: string | null;
  today: string;
}): "cold" | "warm" | "hot" {
  const { visitCount, lastVisitDate, today } = args;
  const recent =
    lastVisitDate != null && daysBetween(lastVisitDate, today) <= 7;
  if (visitCount >= 10 && recent) return "hot";
  if (visitCount >= 3) return "warm";
  if (!recent && visitCount > 0) return "warm";
  return "cold";
}
