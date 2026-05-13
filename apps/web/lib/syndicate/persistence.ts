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
        bonus_prize_text    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_syndicates_slug ON syndicates(slug);
      CREATE INDEX IF NOT EXISTS idx_syndicates_share_guid ON syndicates(share_guid);
      CREATE INDEX IF NOT EXISTS idx_syndicates_tier ON syndicates(tier);
      CREATE INDEX IF NOT EXISTS idx_syndicates_owner_user_id ON syndicates(owner_user_id);
      CREATE TABLE IF NOT EXISTS syndicate_owners_membership (
        syndicate_id TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'owner',
        joined_at    INTEGER NOT NULL,
        PRIMARY KEY (syndicate_id, user_id)
      );
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
    this.prepareStatements();
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
        marketing_consent, created_at, member_count, share_guid
      ) VALUES (
        @id, @slug, @name, @tournament_id, @owner_email, @owner_phone,
        @owner_user_id, @owner_handle, @size_band, @topic,
        @marketing_consent, @created_at, 1, @share_guid
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
         (syndicate_id, user_id, role, joined_at)
       VALUES (@syndicate_id, @user_id, @role, @joined_at)
       ON CONFLICT(syndicate_id, user_id) DO NOTHING`,
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
    return row ?? null;
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
      });
      this.insertMemberStmt.run({
        syndicate_id: input.id,
        user_id: ownerMemberId,
        role: "owner",
        joined_at: now,
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
    return this.db
      .prepare(
        `SELECT * FROM syndicates
         WHERE owner_user_id = ?
         ORDER BY created_at DESC`,
      )
      .all(userId) as SyndicateRow[];
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
  // In test/dev where the game service hasn't run, ensure schema is
  // present so the web route doesn't blow up on first use.
  if (!_persistence.isReady()) {
    _persistence.ensureSchema();
  }
  return _persistence;
}

/** Test-only helper to swap in a fresh persistence layer. */
export function __setPersistenceForTests(p: SyndicatePersistence | null): void {
  _persistence = p;
}
