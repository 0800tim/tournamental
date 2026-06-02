/**
 * Syndicate persistence, SQLite write layer shared with `apps/game`.
 *
 * Opens the same SQLite file the game service uses (`GAME_DB_PATH`,
 * default `apps/game/data/game.db`). The schema for `syndicates`,
 * `syndicate_owners_membership`, and `syndicates_pending_ghl` is
 * created by migration `apps/game/migrations/0003_syndicates.sql`.
 *
 * Why same DB: the future `/s/<slug>` landing page is owned by a
 * parallel agent and reads from the same `syndicates` row this module
 * writes. Sharing the file avoids a cross-process hop on the
 * syndicate-creation hot path.
 *
 * Why better-sqlite3 in the Next.js process: it's a synchronous,
 * in-process driver. We're a single-machine deploy for launch; WAL
 * mode means multiple readers + a single writer per process coexist.
 * If we ever scale to multiple Next.js instances we replace this with
 * a call to the game service's REST API, the surface here is narrow
 * enough that the swap is contained.
 *
 * Schema bootstrap: when running outside the game service (tests, dev
 * previews without a migrated DB), `ensureSchema()` creates the tables
 * idempotently. Production relies on the game service running its
 * migrations first.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import type { Database as DatabaseT, Statement } from "better-sqlite3";

import { serialiseAllowedCountries } from "./country-gate";

export type SyndicateTier = "free" | "premium" | "past_due";

export interface SyndicateRow {
  id: string;
  slug: string;
  name: string;
  tournament_id: string;
  owner_email: string;
  owner_phone: string;
  owner_user_id: string | null;
  owner_handle: string | null;
  size_band: string;
  topic: string | null;
  marketing_consent: number; // 0 | 1
  created_at: number;
  member_count: number;
  share_guid: string;
  /**
   * Commercial tier flag. 'free' by default. Flipped to 'premium' or
   * 'past_due' by the HighLevel webhook. All billing/provisioning
   * happens inside HL; this is the only piece of commercial state
   * the codebase persists.
   */
  tier: SyndicateTier;
  /** HighLevel Location id, null on free tier. Opaque. */
  hl_location_id: string | null;
  /** Stripe subscription id forwarded by HL. Opaque, for support refs. */
  hl_subscription_id: string | null;
  /** Epoch ms of first premium activation; survives later downgrades. */
  hl_premium_since: number | null;
  /** Branding hex `#rrggbb`; renders as primary accent on the embed. */
  branding_primary_colour: string | null;
  /** Branding hex `#rrggbb`; renders as secondary accent. */
  branding_accent_colour: string | null;
  /** Hosted logo URL shown in the embed header. */
  branding_logo_url: string | null;
  /** Hosted hero/background image. */
  branding_hero_url: string | null;
  /** "Sponsored by ..." line shown in widget footer. */
  sponsor_name: string | null;
  /** Sponsor's own site; logo links here in a new tab. */
  sponsor_url: string | null;
  /** Sponsor logo URL. */
  sponsor_logo_url: string | null;
  /** Free-form prize copy ("Win a $250 store voucher"). */
  prize_text: string | null;
  /** Entry fee in cents (e.g. 1000 = $10.00). NULL = no fee. */
  entry_fee_cents: number | null;
  /** ISO 4217 currency code for the entry fee. Defaults to NZD. */
  entry_fee_currency: string | null;
  /**
   * JSON-serialised prize-pool split as a stringified array of
   * `{ rank, percent, label?, sponsor_name? }` entries. Percentages
   * must sum to 100; the API validates this on PATCH.
   */
  prize_split_json: string | null;
  /** Free-form copy for an extra prize (e.g. "longest streak"). */
  bonus_prize_text: string | null;
  /** Long-form "about" copy shown on the embed widget's About tab. */
  about_text: string | null;
  /** Visual theme for the embed widget: "light" (default) or "dark". */
  theme_mode: "light" | "dark" | null;
  /** Admin-authored terms & payment instructions shown on the join flow
   * for paid pools (Tournamental never handles the money). Free-form. */
  join_fee_terms_text: string | null;
  /** Visibility flag. When 1, the pool shows up in the public pool
   * directory and anyone can join in one tap. When 0 (default), the
   * pool is unlisted and only reachable via the share link. */
  is_public: number; // 0 | 1
  /** Approval gate. When 1, joining puts the requester into a
   * `pending` membership row and the owner gets a WhatsApp + email
   * notification to approve or deny. Mutually exclusive with
   * is_public (public pools accept everyone). */
  requires_approval: number; // 0 | 1
  /** Optional country allow-list as a CSV of bare E.164 dial codes
   * (e.g. "64" for NZ-only, "64,61" for ANZAC). NULL = no
   * restriction. Verified at join time against the joiner's
   * WhatsApp-OTP-verified phone. Spec: docs/68-country-gated-pools.md. */
  allowed_phone_countries: string | null;
  /** T&Cs for sponsored / giveaway prizes. Rendered on /s/<slug>
   * under the prize copy. Separate from join_fee_terms_text so a
   * pool can advertise paid-entry terms AND brand-giveaway terms
   * without conflating them. Tim 2026-06-02. */
  prize_terms_text: string | null;
}

/** Decoded prize-split entry, as the API and UI both manipulate it. */
export interface PrizeSplitEntry {
  rank: number;
  percent: number;
  label?: string | null;
  sponsor_name?: string | null;
}

/** Subset of fields a syndicate owner can edit via the manage screen. */
export interface SyndicateBrandingPatch {
  name?: string;
  branding_primary_colour?: string | null;
  branding_accent_colour?: string | null;
  branding_logo_url?: string | null;
  branding_hero_url?: string | null;
  sponsor_name?: string | null;
  sponsor_url?: string | null;
  sponsor_logo_url?: string | null;
  prize_text?: string | null;
  entry_fee_cents?: number | null;
  entry_fee_currency?: string | null;
  prize_split_json?: string | null;
  bonus_prize_text?: string | null;
  about_text?: string | null;
  theme_mode?: "light" | "dark" | null;
  join_fee_terms_text?: string | null;
  prize_terms_text?: string | null;
  /** Pool intro / description shown under the title on /s/<slug>. */
  topic?: string | null;
  /** Public pools appear in the directory and anyone can join in one tap. */
  is_public?: boolean;
  /** Approval-gated pools queue join requests for the owner. The route
   * enforces the invariant that requires_approval is ignored when
   * is_public=true. */
  requires_approval?: boolean;
  /** Allow-list of bare E.164 dial codes (e.g. ["64","61"]). The
   * settings PATCH route accepts the array form here; persistence
   * canonicalises to CSV via serialiseAllowedCountries before write. */
  allowed_phone_countries?: readonly string[];
}

export interface PendingGhlRow {
  id: number;
  syndicate_id: string;
  payload_json: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  next_attempt_at: number;
}

export interface PersistenceOptions {
  /** Filesystem path to the SQLite file. ":memory:" for tests. */
  dbPath: string;
}

export class SyndicatePersistence {
  readonly db: DatabaseT;
  private insertSyndicateStmt!: Statement;
  private getBySlugStmt!: Statement;
  private getByIdStmt!: Statement;
  private insertMemberStmt!: Statement;
  private handleTakenStmt!: Statement;
  private getMembersBySyndicateStmt!: Statement;
  private upsertUserStmt!: Statement;
  private insertPendingGhlStmt!: Statement;
  private listPendingGhlStmt!: Statement;

  constructor(opts: PersistenceOptions) {
    if (opts.dbPath !== ":memory:") {
      mkdirSync(dirname(resolve(opts.dbPath)), { recursive: true });
    }
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    // Run additive ALTER TABLE migrations BEFORE preparing statements
    // — `prepareStatements` references handle + display_name columns
    // on syndicate_owners_membership and would throw if the table
    // exists with the legacy schema.
    try {
      this.migrateMembershipColumns();
    } catch {
      /* swallow on a brand-new DB where the table doesn't exist yet —
       * ensureSchema() will create it with the full schema. */
    }
    this.prepareStatements();
  }

  /**
   * Create the syndicate schema directly. Tests use this with
   * `:memory:`; production relies on the game service migrations
   * being run beforehand. Idempotent, safe to call against an
   * already-migrated DB.
   */
  ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        created_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS syndicates (
        id                  TEXT PRIMARY KEY,
        slug                TEXT UNIQUE NOT NULL,
        name                TEXT NOT NULL,
        tournament_id       TEXT NOT NULL,
        owner_email         TEXT NOT NULL,
        owner_phone         TEXT NOT NULL,
        owner_user_id       TEXT,
        owner_handle        TEXT,
        size_band           TEXT NOT NULL,
        topic               TEXT,
        marketing_consent   INTEGER NOT NULL DEFAULT 0,
        created_at          INTEGER NOT NULL,
        member_count        INTEGER NOT NULL DEFAULT 1,
        share_guid          TEXT NOT NULL UNIQUE,
        tier                TEXT NOT NULL DEFAULT 'free',
        hl_location_id      TEXT,
        hl_subscription_id  TEXT,
        hl_premium_since    INTEGER,
        branding_primary_colour TEXT,
        branding_accent_colour TEXT,
        branding_logo_url   TEXT,
        branding_hero_url   TEXT,
        sponsor_name        TEXT,
        sponsor_url         TEXT,
        sponsor_logo_url    TEXT,
        prize_text          TEXT,
        entry_fee_cents     INTEGER,
        entry_fee_currency  TEXT DEFAULT 'NZD',
        prize_split_json    TEXT,
        bonus_prize_text    TEXT,
        join_fee_terms_text TEXT,
        prize_terms_text    TEXT,
        is_public           INTEGER NOT NULL DEFAULT 0,
        requires_approval   INTEGER NOT NULL DEFAULT 0,
        allowed_phone_countries TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_syndicates_slug ON syndicates(slug);
      CREATE INDEX IF NOT EXISTS idx_syndicates_share_guid ON syndicates(share_guid);
      CREATE INDEX IF NOT EXISTS idx_syndicates_tier ON syndicates(tier);
      CREATE INDEX IF NOT EXISTS idx_syndicates_owner_user_id ON syndicates(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_syndicates_public_created ON syndicates(is_public, created_at DESC);
      CREATE TABLE IF NOT EXISTS syndicate_owners_membership (
        syndicate_id TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'owner',
        joined_at    INTEGER NOT NULL,
        handle       TEXT,
        display_name TEXT,
        PRIMARY KEY (syndicate_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_membership_handle
        ON syndicate_owners_membership(syndicate_id, handle COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS syndicates_pending_ghl (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        syndicate_id    TEXT NOT NULL,
        payload_json    TEXT NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        created_at      INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_ghl_next_attempt
        ON syndicates_pending_ghl(next_attempt_at);
    `);
    this.migrateMembershipColumns();
    this.prepareStatements();
  }

  /** 2026-05-22: add `handle` + `display_name` to membership for the
   * pool-scoped join modal, plus `status` for the approval-gated
   * join flow added later the same day. SQLite ADD COLUMN is
   * non-destructive on the existing rows so the migration runs
   * idempotently. Also adds is_public + requires_approval to the
   * syndicates table for the public-directory + approval-gate
   * features. */
  private migrateMembershipColumns(): void {
    const memCols = this.db
      .prepare(`PRAGMA table_info(syndicate_owners_membership)`)
      .all() as { name: string }[];
    const hasMem = (n: string) => memCols.some((c) => c.name === n);
    if (!hasMem("handle")) {
      this.db.exec(
        `ALTER TABLE syndicate_owners_membership ADD COLUMN handle TEXT`,
      );
    }
    if (!hasMem("display_name")) {
      this.db.exec(
        `ALTER TABLE syndicate_owners_membership ADD COLUMN display_name TEXT`,
      );
    }
    if (!hasMem("status")) {
      // status is NULL for legacy rows (treated as 'active' in queries)
      // and one of 'active' | 'pending' | 'denied' for new rows.
      this.db.exec(
        `ALTER TABLE syndicate_owners_membership ADD COLUMN status TEXT`,
      );
    }
    // Index may not exist yet on legacy DBs that pre-date the schema
    // bump; recreate it idempotently.
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_membership_handle
         ON syndicate_owners_membership(syndicate_id, handle COLLATE NOCASE)`,
    );

    const synCols = this.db
      .prepare(`PRAGMA table_info(syndicates)`)
      .all() as { name: string }[];
    const hasSyn = (n: string) => synCols.some((c) => c.name === n);
    if (!hasSyn("is_public")) {
      this.db.exec(
        `ALTER TABLE syndicates ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`,
      );
    }
    if (!hasSyn("requires_approval")) {
      this.db.exec(
        `ALTER TABLE syndicates ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0`,
      );
    }
    if (!hasSyn("join_fee_terms_text")) {
      this.db.exec(
        `ALTER TABLE syndicates ADD COLUMN join_fee_terms_text TEXT`,
      );
    }
    if (!hasSyn("allowed_phone_countries")) {
      // 2026-05-29: country-gated public pools. Stored as CSV of bare
      // E.164 dial codes, NULL = no restriction. See migration
      // 0011_syndicates_country_gate.sql and docs/68-country-gated-pools.md.
      this.db.exec(
        `ALTER TABLE syndicates ADD COLUMN allowed_phone_countries TEXT`,
      );
    }
    if (!hasSyn("prize_terms_text")) {
      // 2026-06-02: T&Cs for sponsored / giveaway prizes (the Branding
      // section's "terms" field). Separate from join_fee_terms_text
      // (which is paid-pool entry T&Cs) so a pool can advertise both
      // a paid entry split AND brand-giveaway terms without conflating.
      this.db.exec(
        `ALTER TABLE syndicates ADD COLUMN prize_terms_text TEXT`,
      );
    }
  }

  private prepareStatements(): void {
    // If tables don't exist yet (web hits the route before game has
    // booted), prepare() would throw. Guard with a fast existence check.
    const tables = new Set(
      (this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[])
        .map((r) => r.name),
    );
    if (!tables.has("syndicates")) {
      return;
    }
    this.insertSyndicateStmt = this.db.prepare(
      `INSERT INTO syndicates (
        id, slug, name, tournament_id, owner_email, owner_phone,
        owner_user_id, owner_handle, size_band, topic,
        marketing_consent, created_at, member_count, share_guid,
        is_public, requires_approval, allowed_phone_countries
      ) VALUES (
        @id, @slug, @name, @tournament_id, @owner_email, @owner_phone,
        @owner_user_id, @owner_handle, @size_band, @topic,
        @marketing_consent, @created_at, 1, @share_guid,
        @is_public, @requires_approval, @allowed_phone_countries
      )`,
    );
    this.getBySlugStmt = this.db.prepare(
      `SELECT * FROM syndicates WHERE slug = ?`,
    );
    this.getByIdStmt = this.db.prepare(
      `SELECT * FROM syndicates WHERE id = ?`,
    );
    this.upsertUserStmt = this.db.prepare(
      `INSERT INTO users (id, created_at) VALUES (?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    this.insertMemberStmt = this.db.prepare(
      `INSERT INTO syndicate_owners_membership
         (syndicate_id, user_id, role, joined_at, handle, display_name, status)
       VALUES (@syndicate_id, @user_id, @role, @joined_at, @handle, @display_name, @status)
       ON CONFLICT(syndicate_id, user_id) DO UPDATE SET
         handle = COALESCE(excluded.handle, syndicate_owners_membership.handle),
         display_name = COALESCE(excluded.display_name, syndicate_owners_membership.display_name)
         /* status is intentionally NOT updated on conflict so a denied
            user can't bypass denial by re-joining, and an existing
            active member can't be downgraded to pending by a malformed
            request. Status changes go through the approve/deny
            endpoints exclusively. */`,
    );
    this.handleTakenStmt = this.db.prepare(
      `SELECT 1 FROM syndicate_owners_membership
        WHERE syndicate_id = ? AND LOWER(handle) = LOWER(?) LIMIT 1`,
    );
    // Default `getMembers` query excludes pending + denied rows: the
    // public landing + member-count surfaces should only ever count
    // confirmed members. Owners use `listPendingMembers` separately.
    this.getMembersBySyndicateStmt = this.db.prepare(
      `SELECT user_id, role, joined_at, handle, display_name
         FROM syndicate_owners_membership
        WHERE syndicate_id = ?
          AND (status IS NULL OR status = 'active')
        ORDER BY joined_at ASC`,
    );
    this.insertPendingGhlStmt = this.db.prepare(
      `INSERT INTO syndicates_pending_ghl
         (syndicate_id, payload_json, attempts, last_error,
          created_at, next_attempt_at)
       VALUES (?, ?, 0, ?, ?, ?)`,
    );
    this.listPendingGhlStmt = this.db.prepare(
      `SELECT * FROM syndicates_pending_ghl
        WHERE next_attempt_at <= ?
        ORDER BY next_attempt_at ASC
        LIMIT ?`,
    );
  }

  /** True if the schema is present (game migrations have run). */
  isReady(): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='syndicates'`)
      .get() as { name: string } | undefined;
    return Boolean(row);
  }

  /**
   * Look up a syndicate by slug. Returns null if no row.
   */
  getBySlug(slug: string): SyndicateRow | null {
    if (!this.getBySlugStmt) this.prepareStatements();
    if (!this.getBySlugStmt) {
      throw new Error("syndicate schema not ready");
    }
    const row = this.getBySlugStmt.get(slug.toLowerCase()) as
      | SyndicateRow
      | undefined;
    return row ? this.withRealMemberCount(row) : null;
  }

  /**
   * Replace the cached `member_count` on a SyndicateRow with the live
   * count from `syndicate_owners_membership`. The cached column used to
   * drift on duplicate self-joins; reading from the membership table
   * directly keeps every consumer consistent even on legacy rows.
   */
  private withRealMemberCount(row: SyndicateRow): SyndicateRow {
    try {
      const real = this.getMembers(row.id).length;
      if (real > 0 && real !== row.member_count) {
        return { ...row, member_count: real };
      }
    } catch {
      /* fall through to cached value */
    }
    return row;
  }

  /**
   * Return the real membership rows for a syndicate, oldest first.
   * Includes the owner (role='owner') and any joined members (role='member').
   * Used by the public landing to avoid synthesising fake handles from
   * the cached `member_count` column.
   */
  getMembers(syndicateId: string): Array<{
    user_id: string;
    role: string;
    joined_at: number;
    handle?: string | null;
    display_name?: string | null;
  }> {
    if (!this.getMembersBySyndicateStmt) this.prepareStatements();
    if (!this.getMembersBySyndicateStmt) return [];
    return this.getMembersBySyndicateStmt.all(syndicateId) as Array<{
      user_id: string;
      role: string;
      joined_at: number;
      handle?: string | null;
      display_name?: string | null;
    }>;
  }

  /** True if another member of this syndicate already claims this
   * handle (case-insensitive). The join modal calls this BEFORE
   * sending the OTP so the user can pick again without spending an
   * OTP attempt. */
  isHandleTakenInSyndicate(syndicateId: string, handle: string): boolean {
    if (!this.handleTakenStmt) this.prepareStatements();
    if (!this.handleTakenStmt) return false;
    const row = this.handleTakenStmt.get(syndicateId, handle.trim()) as
      | { 1: number }
      | undefined;
    return !!row;
  }

  /** Insert (or upsert) a pool membership row with optional handle +
   * display name. Returns `inserted` (true on a new row, false on a
   * dedupe collision). The owner-create path uses the same stmt
   * during createSyndicate. */
  addMember(args: {
    syndicate_id: string;
    user_id: string;
    role?: "owner" | "member";
    handle?: string | null;
    display_name?: string | null;
    /** Membership state. Defaults to 'active' for the standard flow.
     * Pass 'pending' for approval-gated joins; the approve/deny
     * endpoints flip it to 'active' or 'denied' later. */
    status?: "active" | "pending" | "denied" | null;
    now?: number;
  }): { inserted: boolean } {
    if (!this.insertMemberStmt) this.prepareStatements();
    if (!this.insertMemberStmt) throw new Error("syndicate schema not ready");
    const now = args.now ?? Date.now();
    // The membership table foreign-keys to users(id). A member who hasn't
    // saved a bracket yet has no users row, so the insert would throw a FK
    // violation (surfacing as a 500 on /join). Ensure the user row exists
    // first — mirrors the owner-creation flow.
    this.upsertUserStmt.run(args.user_id, now);
    const result = this.insertMemberStmt.run({
      syndicate_id: args.syndicate_id,
      user_id: args.user_id,
      role: args.role ?? "member",
      joined_at: now,
      handle: args.handle ?? null,
      display_name: args.display_name ?? null,
      status: args.status ?? "active",
    });
    return { inserted: (result.changes ?? 0) > 0 };
  }

  /** True when the user holds an active membership in this pool. Legacy
   * rows predate the `status` column and store NULL; those are treated
   * as active (consistent with the getMembers query). */
  isMember(syndicateId: string, userId: string): boolean {
    if (!this.db) return false;
    const row = this.db
      .prepare(
        `SELECT 1 FROM syndicate_owners_membership
          WHERE syndicate_id = ? AND user_id = ?
            AND (status IS NULL OR status = 'active')
          LIMIT 1`,
      )
      .get(syndicateId, userId);
    return !!row;
  }

  /** The caller's membership status in this pool: 'active' | 'pending' |
   * 'denied', or 'none' when there's no row. Legacy rows with NULL status
   * count as 'active'. Ownership lives on the syndicates row, not here, so
   * callers fold that in separately. Non-mutating: safe to call on every
   * page load without re-triggering owner notifications. */
  getMembershipStatus(
    syndicateId: string,
    userId: string,
  ): "active" | "pending" | "denied" | "none" {
    if (!this.db) return "none";
    const row = this.db
      .prepare(
        `SELECT status FROM syndicate_owners_membership
          WHERE syndicate_id = ? AND user_id = ? LIMIT 1`,
      )
      .get(syndicateId, userId) as { status?: string | null } | undefined;
    if (!row) return "none";
    if (row.status == null || row.status === "active") return "active";
    if (row.status === "pending") return "pending";
    if (row.status === "denied") return "denied";
    return "none";
  }

  /** Remove a member from a pool (a user leaving). Owners cannot leave
   * their own pool this way (role = 'owner' rows are protected). Returns
   * whether a row was removed. */
  removeMember(syndicateId: string, userId: string): { removed: boolean } {
    if (!this.db) return { removed: false };
    const r = this.db
      .prepare(
        `DELETE FROM syndicate_owners_membership
          WHERE syndicate_id = ? AND user_id = ? AND role != 'owner'`,
      )
      .run(syndicateId, userId);
    return { removed: (r.changes ?? 0) > 0 };
  }

  /** Flip a membership row's status. Used by the approve/deny owner
   * endpoints to move a 'pending' row to 'active' or 'denied'. Returns
   * the number of rows affected (0 if the syndicate_id/user_id pair
   * doesn't exist or the new status is already set). */
  setMemberStatus(args: {
    syndicate_id: string;
    user_id: string;
    status: "active" | "denied";
  }): number {
    const stmt = this.db.prepare(
      `UPDATE syndicate_owners_membership
          SET status = ?
        WHERE syndicate_id = ? AND user_id = ? AND status = 'pending'`,
    );
    const r = stmt.run(args.status, args.syndicate_id, args.user_id);
    return r.changes ?? 0;
  }

  /** Look up a single pending membership row. Used by the approve/deny
   * landing page to render the requester's handle / display name. */
  getPendingMember(
    syndicate_id: string,
    user_id: string,
  ): {
    user_id: string;
    role: string;
    joined_at: number;
    handle?: string | null;
    display_name?: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT user_id, role, joined_at, handle, display_name
           FROM syndicate_owners_membership
          WHERE syndicate_id = ? AND user_id = ? AND status = 'pending'`,
      )
      .get(syndicate_id, user_id) as
      | {
          user_id: string;
          role: string;
          joined_at: number;
          handle?: string | null;
          display_name?: string | null;
        }
      | undefined;
    return row ?? null;
  }

  /** List pending join requests for a syndicate, oldest first. The
   * owner manage dashboard renders this as the approval queue. */
  listPendingMembers(syndicate_id: string): Array<{
    user_id: string;
    handle?: string | null;
    display_name?: string | null;
    joined_at: number;
  }> {
    return this.db
      .prepare(
        `SELECT user_id, handle, display_name, joined_at
           FROM syndicate_owners_membership
          WHERE syndicate_id = ? AND status = 'pending'
          ORDER BY joined_at ASC`,
      )
      .all(syndicate_id) as Array<{
      user_id: string;
      handle?: string | null;
      display_name?: string | null;
      joined_at: number;
    }>;
  }

  /**
   * Look up a syndicate by its short share_guid (nanoid). Used by the
   * /s/<guid> resolver so legacy guid links still resolve, then the
   * page redirects to the canonical /s/<slug> URL.
   */
  getByShareGuid(shareGuid: string): SyndicateRow | null {
    if (!this.db) return null;
    try {
      const row = this.db
        .prepare(`SELECT * FROM syndicates WHERE share_guid = ?`)
        .get(shareGuid) as SyndicateRow | undefined;
      return row ? this.withRealMemberCount(row) : null;
    } catch {
      return null;
    }
  }

  /**
   * Create a syndicate + owner membership row in one transaction.
   * Returns the persisted row. Throws on slug collision (caller maps
   * to a 409 response).
   */
  createSyndicate(input: {
    id: string;
    slug: string;
    name: string;
    tournament_id: string;
    owner_email: string;
    owner_phone: string;
    owner_user_id: string | null;
    owner_handle: string | null;
    size_band: string;
    topic: string | null;
    marketing_consent: boolean;
    share_guid: string;
    /** Public pools appear in the directory and accept anyone in one tap. */
    is_public?: boolean;
    /** Approval-gated pools queue join requests for the owner. Ignored
     * when is_public is true. */
    requires_approval?: boolean;
    /** Optional country allow-list as bare E.164 dial codes
     * (e.g. ["64","61"]). Empty/undefined = no restriction. */
    allowed_phone_countries?: readonly string[];
    now?: number;
  }): SyndicateRow {
    if (!this.insertSyndicateStmt) this.prepareStatements();
    if (!this.insertSyndicateStmt) {
      throw new Error("syndicate schema not ready");
    }
    const now = input.now ?? Date.now();
    // Anonymous-creation path has no Supabase user id; use the
    // syndicate id itself prefixed with `anon:` so the membership row
    // is non-null and uniquely scoped to this syndicate. When the
    // owner later signs in we can reconcile.
    const ownerMemberId = input.owner_user_id ?? `anon:${input.id}`;

    const txn = this.db.transaction(() => {
      this.upsertUserStmt.run(ownerMemberId, now);
      // Public pools never require approval — the two flags are
      // mutually exclusive per the form UI. We enforce that invariant
      // here too so a misbehaving client can't sneak both flags through.
      const isPublic = !!input.is_public;
      const requiresApproval = !isPublic && !!input.requires_approval;
      this.insertSyndicateStmt.run({
        id: input.id,
        slug: input.slug.toLowerCase(),
        name: input.name,
        tournament_id: input.tournament_id,
        owner_email: input.owner_email,
        owner_phone: input.owner_phone,
        owner_user_id: input.owner_user_id,
        owner_handle: input.owner_handle,
        size_band: input.size_band,
        topic: input.topic,
        marketing_consent: input.marketing_consent ? 1 : 0,
        created_at: now,
        share_guid: input.share_guid,
        is_public: isPublic ? 1 : 0,
        requires_approval: requiresApproval ? 1 : 0,
        allowed_phone_countries: serialiseAllowedCountries(
          input.allowed_phone_countries ?? [],
        ),
      });
      this.insertMemberStmt.run({
        syndicate_id: input.id,
        user_id: ownerMemberId,
        role: "owner",
        joined_at: now,
        handle: input.owner_handle ?? null,
        display_name: null,
        // The owner is always active -- the pending status is only
        // applied to join requests on private pools (approve/deny
        // flow). Without this the INSERT throws
        // "Missing named parameter status" and the whole
        // createSyndicate transaction rolls back.
        status: "active",
      });
    });
    txn();
    const row = this.getByIdStmt.get(input.id) as SyndicateRow;
    return row;
  }

  /**
   * Park a payload that we failed to push to GHL. A daily cron job
   * (out of scope here) reads rows where `next_attempt_at <= now()`,
   * retries the call, and either deletes the row on success or
   * increments `attempts` + bumps `next_attempt_at` on continued
   * failure.
   */
  enqueueGhlRetry(args: {
    syndicate_id: string;
    payload: unknown;
    error: string;
    now?: number;
    retry_after_ms?: number;
  }): void {
    if (!this.insertPendingGhlStmt) this.prepareStatements();
    if (!this.insertPendingGhlStmt) {
      throw new Error("syndicate schema not ready");
    }
    const now = args.now ?? Date.now();
    // Default backoff: try again in 15 minutes. The retry job applies
    // exponential backoff on subsequent failures.
    const retryAfter = args.retry_after_ms ?? 15 * 60 * 1000;
    this.insertPendingGhlStmt.run(
      args.syndicate_id,
      JSON.stringify(args.payload),
      args.error,
      now,
      now + retryAfter,
    );
  }

  /** Test helper: list pending GHL rows that are eligible to retry. */
  listPendingGhl(now: number, limit = 50): PendingGhlRow[] {
    if (!this.listPendingGhlStmt) this.prepareStatements();
    if (!this.listPendingGhlStmt) return [];
    return this.listPendingGhlStmt.all(now, limit) as PendingGhlRow[];
  }

  /**
   * List every syndicate this user owns. Drives the affiliate dashboard
   * at `/dashboard/syndicates`. Ordered by most recently created so
   * fresh creations float to the top.
   */
  listByOwnerUserId(userId: string): SyndicateRow[] {
    if (!this.isReady()) return [];
    const rows = this.db
      .prepare(
        `SELECT * FROM syndicates
         WHERE owner_user_id = ?
         ORDER BY created_at DESC`,
      )
      .all(userId) as SyndicateRow[];
    return rows.map((r) => this.withRealMemberCount(r));
  }

  /**
   * Like listByOwnerUserId but reconciles two legacy ownership shapes
   * for pools created before the create-route learned to set
   * owner_user_id from the session:
   *
   *   - owner_user_id IS NULL/empty AND owner_email matches (the
   *     auth-sms email is OTP-verified so this is verified-email
   *     == typed-email)
   *   - owner_user_id IS NULL AND syndicate_owners_membership has a
   *     row with role='owner', user_id LIKE 'anon:%', and the
   *     `handle` column slugifies to the user's display_name slug
   *
   * `emailLower` and `handleSlug` should already be normalised by the
   * caller (lower-case email, slugified handle). Either may be null
   * when the upstream lookup didn't yield anything; in that case the
   * corresponding reconciliation path is skipped.
   *
   * Returned rows are de-duped by syndicate id; ownership wins over
   * any other classification. Order: most recent first.
   * (Tim 2026-05-24: My pools page was only showing The Crate because
   * his other three pools all live in the anon-owner bucket.)
   */
  listOwnedByUserIdOrLegacyHints(
    userId: string,
    hints: { emailLower: string | null; handleSlug: string | null },
  ): SyndicateRow[] {
    if (!this.isReady()) return [];
    const byId = this.db
      .prepare(
        `SELECT * FROM syndicates
         WHERE owner_user_id = ?
         ORDER BY created_at DESC`,
      )
      .all(userId) as SyndicateRow[];
    const byEmail = hints.emailLower
      ? (this.db
          .prepare(
            `SELECT * FROM syndicates
             WHERE (owner_user_id IS NULL OR owner_user_id = '')
               AND LOWER(owner_email) = ?
             ORDER BY created_at DESC`,
          )
          .all(hints.emailLower) as SyndicateRow[])
      : [];
    const byHandle = hints.handleSlug
      ? (this.db
          .prepare(
            `SELECT s.*
             FROM syndicate_owners_membership m
             JOIN syndicates s ON s.id = m.syndicate_id
             WHERE m.role = 'owner'
               AND m.user_id LIKE 'anon:%'
               AND m.handle IS NOT NULL
               AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(m.handle, ' ', ''), '.', ''), '-', ''), '_', ''))
                   = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(?, ' ', ''), '.', ''), '-', ''), '_', ''))
               AND ((s.owner_user_id IS NULL) OR (s.owner_user_id = ''))
             ORDER BY s.created_at DESC`,
          )
          .all(hints.handleSlug) as SyndicateRow[])
      : [];
    const seen = new Set<string>();
    const merged: SyndicateRow[] = [];
    for (const r of byId) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }
    for (const r of byEmail) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }
    for (const r of byHandle) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }
    return merged.map((r) => this.withRealMemberCount(r));
  }

  /**
   * List public syndicates for the public pool directory (`/pools`).
   * Only `is_public = 1` rows; newest first. An optional `search` does a
   * case-insensitive substring match across name, slug, and topic. Paged
   * via limit/offset (limit clamped 1..100).
   */
  listPublic(opts: {
    search?: string;
    limit?: number;
    offset?: number;
    /** Optional E.164 phone (e.g. "+447700900123") OR bare dial code
     * (e.g. "44"). When set, the listing is post-filtered to pools
     * the visitor with this phone can join: pools with no country
     * restriction PLUS pools whose allow-list matches. Used by the
     * /pools?eligible_for=... query to back the join-flow upsell.
     * Filtering happens in-memory because the allow-list lives in a
     * CSV column; v1 directory caps at 60 rows so this is cheap. */
    eligibleFor?: string | null;
  } = {}): SyndicateRow[] {
    if (!this.isReady()) return [];
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 60), 1), 100);
    const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);
    const search = opts.search?.trim();
    let rows: SyndicateRow[];
    if (search) {
      // Escape LIKE wildcards in user input so "%" / "_" are literal.
      const like = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      rows = this.db
        .prepare(
          `SELECT * FROM syndicates
            WHERE is_public = 1
              AND (name LIKE ? ESCAPE '\\'
                   OR slug LIKE ? ESCAPE '\\'
                   OR topic LIKE ? ESCAPE '\\')
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?`,
        )
        .all(like, like, like, limit, offset) as SyndicateRow[];
    } else {
      rows = this.db
        .prepare(
          `SELECT * FROM syndicates
            WHERE is_public = 1
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as SyndicateRow[];
    }
    let withCounts = rows.map((r) => this.withRealMemberCount(r));
    if (opts.eligibleFor) {
      // Lazy import to keep the persistence module's hot path free of
      // a circular dep on country-gate (which already imports types
      // from here).
      const { parseAllowedCountries, phoneMatchesAllowed } = require("./country-gate") as typeof import("./country-gate");
      const raw = opts.eligibleFor.trim();
      // Accept either a full E.164 phone or a bare dial code. Bare
      // dial codes get a leading + so phoneMatchesAllowed treats them
      // uniformly.
      const phoneish = raw.startsWith("+") ? raw : `+${raw.replace(/\D/g, "")}`;
      withCounts = withCounts.filter((r) =>
        phoneMatchesAllowed(phoneish, parseAllowedCountries(r.allowed_phone_countries)),
      );
    }
    return withCounts;
  }

  /**
   * Update the commercial-tier state of a syndicate. Called only by the
   * HighLevel webhook receiver. All billing, subscription state, and
   * provisioning logic lives inside HL automations; this method is the
   * single mutation surface the codebase exposes.
   *
   * Passing `tier: 'premium'` with a fresh `hl_location_id` activates
   * premium and stamps `hl_premium_since` if it wasn't already set.
   * Passing `tier: 'free'` downgrades but preserves `hl_premium_since`
   * for loyalty metrics.
   */
  setTierBySlug(args: {
    slug: string;
    tier: SyndicateTier;
    hl_location_id?: string | null;
    hl_subscription_id?: string | null;
    now?: number;
  }): SyndicateRow | null {
    if (!this.isReady()) return null;
    const now = args.now ?? Date.now();
    const existing = this.getBySlug(args.slug);
    if (!existing) return null;

    const premiumSince =
      args.tier === "premium" && existing.hl_premium_since === null
        ? now
        : existing.hl_premium_since;

    this.db
      .prepare(
        `UPDATE syndicates
            SET tier = @tier,
                hl_location_id = @hl_location_id,
                hl_subscription_id = @hl_subscription_id,
                hl_premium_since = @hl_premium_since
          WHERE slug = @slug`,
      )
      .run({
        slug: args.slug.toLowerCase(),
        tier: args.tier,
        hl_location_id:
          args.hl_location_id !== undefined
            ? args.hl_location_id
            : existing.hl_location_id,
        hl_subscription_id:
          args.hl_subscription_id !== undefined
            ? args.hl_subscription_id
            : existing.hl_subscription_id,
        hl_premium_since: premiumSince,
      });

    return this.getBySlug(args.slug);
  }

  /**
   * Apply a partial branding patch from the owner. Empty strings are
   * normalised to null (so clearing a field works). Caller is
   * responsible for authorisation; this method does not check
   * ownership. Returns the updated row or null if no row matches.
   */
  updateBranding(slug: string, patch: SyndicateBrandingPatch): SyndicateRow | null {
    if (!this.isReady()) return null;
    const existing = this.getBySlug(slug);
    if (!existing) return null;

    const normalise = (v: string | null | undefined): string | null => {
      if (v === undefined) return undefined as unknown as string | null;
      if (v === null) return null;
      const trimmed = v.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    // Build the SET clause dynamically so unspecified fields don't move.
    const updates: Record<string, string | number | null> = {};
    const stringFields: ReadonlyArray<keyof SyndicateBrandingPatch> = [
      "name",
      "branding_primary_colour",
      "branding_accent_colour",
      "branding_logo_url",
      "branding_hero_url",
      "sponsor_name",
      "sponsor_url",
      "sponsor_logo_url",
      "prize_text",
      "entry_fee_currency",
      "prize_split_json",
      "bonus_prize_text",
      "about_text",
      "theme_mode",
      "join_fee_terms_text",
      "prize_terms_text",
      "topic",
    ];
    for (const f of stringFields) {
      if (patch[f] !== undefined) {
        const next = normalise(patch[f] as string | null | undefined);
        if (next !== (undefined as unknown as string | null)) {
          updates[f] = next;
        }
      }
    }
    // Integer field handled separately so we don't normalise it through string land.
    if (patch.entry_fee_cents !== undefined) {
      updates.entry_fee_cents =
        patch.entry_fee_cents === null
          ? null
          : Math.max(0, Math.round(patch.entry_fee_cents));
    }
    // Visibility flags. Mirror the createSyndicate invariant: public
    // pools never require approval, so when the patch flips is_public=true
    // we also clear requires_approval. Honoured even when only one of
    // the two fields is in the patch (we read the latest values across
    // the merged state).
    const nextIsPublic =
      patch.is_public !== undefined ? patch.is_public : existing.is_public === 1;
    const nextRequiresApproval =
      patch.requires_approval !== undefined
        ? patch.requires_approval
        : existing.requires_approval === 1;
    if (patch.is_public !== undefined) {
      updates.is_public = nextIsPublic ? 1 : 0;
    }
    if (patch.requires_approval !== undefined || patch.is_public !== undefined) {
      updates.requires_approval = !nextIsPublic && nextRequiresApproval ? 1 : 0;
    }
    if (Object.keys(updates).length === 0) return existing;

    // `name` is NOT NULL in the schema; reject a clear-attempt rather
    // than producing a constraint violation.
    if ("name" in updates && updates.name === null) {
      delete updates.name;
    }

    const assignments = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
    this.db
      .prepare(`UPDATE syndicates SET ${assignments} WHERE slug = @slug`)
      .run({ ...updates, slug: slug.toLowerCase() });

    return this.getBySlug(slug);
  }

  close(): void {
    this.db.close();
  }
}

// ----------------------------------------------------------------------------
// Module-level singleton for the Next.js route. The DB path is read from
// env once per process; tests use `__setPersistenceForTests` to inject a
// fresh in-memory store.
// ----------------------------------------------------------------------------

let _persistence: SyndicatePersistence | null = null;

export function getPersistence(): SyndicatePersistence {
  if (_persistence) return _persistence;
  const dbPath = process.env.GAME_DB_PATH ?? "./apps/game/data/game.db";
  _persistence = new SyndicatePersistence({ dbPath });
  // Always run ensureSchema so additive ALTER-TABLE migrations (e.g.
  // 2026-05-22's `handle` + `display_name` columns on the membership
  // table) get applied even when the base tables already exist.
  // CREATE TABLE IF NOT EXISTS + the explicit migration step are
  // both idempotent so this is safe to call on every cold start.
  _persistence.ensureSchema();
  return _persistence;
}

/** Test-only helper to swap in a fresh persistence layer. */
export function __setPersistenceForTests(p: SyndicatePersistence | null): void {
  _persistence = p;
}
