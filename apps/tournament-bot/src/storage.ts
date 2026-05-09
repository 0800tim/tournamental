// Storage — SQLite-backed mapping from Telegram chat_id to our user_id, plus
// per-user push prefs and syndicate metadata. Doc 13 says "no bot-specific
// database" and recommends Redis. For v0 we keep everything in SQLite so the
// bot can boot standalone without the gamification stack online; the schema
// is small enough that swapping to Redis later is a half-day job.

import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";

export interface TgUser {
  chat_id: number;
  user_id: string | null;
  tz: string;
  notify_market_move: number;
  notify_kickoff: number;
  notify_goal: number;
  notify_affiliate: number;
  notify_match_day: number;
  quiet_start: string;
  quiet_end: string;
  last_push_at: number | null;
  push_count_today: number;
  push_count_day: string | null;
  country_code: string | null;
  language_code: string | null;
  created_at: number;
}

export interface Syndicate {
  id: string;
  slug: string;
  name: string;
  owner_user_id: string | null;
  format: "winner_take_all" | "podium" | "points";
  privacy: "public" | "invite_only";
  created_at: number;
}

export interface SyndicateMember {
  syndicate_id: string;
  user_id: string;
  joined_at: number;
  role: "owner" | "admin" | "member";
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tg_user (
  chat_id INTEGER PRIMARY KEY,
  user_id TEXT,
  tz TEXT NOT NULL DEFAULT 'Pacific/Auckland',
  notify_market_move INTEGER NOT NULL DEFAULT 1,
  notify_kickoff INTEGER NOT NULL DEFAULT 1,
  notify_goal INTEGER NOT NULL DEFAULT 1,
  notify_affiliate INTEGER NOT NULL DEFAULT 0,
  notify_match_day INTEGER NOT NULL DEFAULT 0,
  quiet_start TEXT NOT NULL DEFAULT '22:00',
  quiet_end TEXT NOT NULL DEFAULT '08:00',
  last_push_at INTEGER,
  push_count_today INTEGER NOT NULL DEFAULT 0,
  push_count_day TEXT,
  country_code TEXT,
  language_code TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS syndicate (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT,
  format TEXT NOT NULL CHECK (format IN ('winner_take_all','podium','points')),
  privacy TEXT NOT NULL CHECK (privacy IN ('public','invite_only')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS syndicate_member (
  syndicate_id TEXT NOT NULL REFERENCES syndicate(id),
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  PRIMARY KEY (syndicate_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_user_user_id ON tg_user(user_id);
CREATE INDEX IF NOT EXISTS idx_syndicate_member_user ON syndicate_member(user_id);
`;

export class Storage {
  readonly db: DB;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- tg_user --------------------------------------------------------

  upsertUser(input: {
    chat_id: number;
    user_id?: string | null;
    tz?: string;
    country_code?: string | null;
    language_code?: string | null;
  }): TgUser {
    const now = Date.now();
    const existing = this.getUser(input.chat_id);

    if (existing) {
      const next: Partial<TgUser> = {};
      if (input.user_id !== undefined) next.user_id = input.user_id;
      if (input.tz !== undefined) next.tz = input.tz;
      if (input.country_code !== undefined) next.country_code = input.country_code;
      if (input.language_code !== undefined) next.language_code = input.language_code;
      if (Object.keys(next).length > 0) {
        const sets = Object.keys(next).map((k) => `${k} = @${k}`).join(", ");
        this.db
          .prepare(`UPDATE tg_user SET ${sets} WHERE chat_id = @chat_id`)
          .run({ ...next, chat_id: input.chat_id });
      }
      return this.getUser(input.chat_id)!;
    }

    this.db
      .prepare(
        `INSERT INTO tg_user (chat_id, user_id, tz, country_code, language_code, created_at)
         VALUES (@chat_id, @user_id, @tz, @country_code, @language_code, @created_at)`,
      )
      .run({
        chat_id: input.chat_id,
        user_id: input.user_id ?? null,
        tz: input.tz ?? "Pacific/Auckland",
        country_code: input.country_code ?? null,
        language_code: input.language_code ?? null,
        created_at: now,
      });
    return this.getUser(input.chat_id)!;
  }

  getUser(chat_id: number): TgUser | null {
    const row = this.db
      .prepare("SELECT * FROM tg_user WHERE chat_id = ?")
      .get(chat_id) as TgUser | undefined;
    return row ?? null;
  }

  getUserByUserId(user_id: string): TgUser | null {
    const row = this.db
      .prepare("SELECT * FROM tg_user WHERE user_id = ? LIMIT 1")
      .get(user_id) as TgUser | undefined;
    return row ?? null;
  }

  setNotifyPref(
    chat_id: number,
    pref: "market_move" | "kickoff" | "goal" | "affiliate" | "match_day",
    enabled: boolean,
  ): void {
    const col = `notify_${pref}`;
    this.db
      .prepare(`UPDATE tg_user SET ${col} = ? WHERE chat_id = ?`)
      .run(enabled ? 1 : 0, chat_id);
  }

  setQuietHours(chat_id: number, start: string, end: string): void {
    this.db
      .prepare("UPDATE tg_user SET quiet_start = ?, quiet_end = ? WHERE chat_id = ?")
      .run(start, end, chat_id);
  }

  recordPush(chat_id: number, ts: number, dayKey: string): void {
    const u = this.getUser(chat_id);
    if (!u) return;
    const sameDay = u.push_count_day === dayKey;
    const nextCount = sameDay ? u.push_count_today + 1 : 1;
    this.db
      .prepare(
        `UPDATE tg_user
         SET last_push_at = ?, push_count_today = ?, push_count_day = ?
         WHERE chat_id = ?`,
      )
      .run(ts, nextCount, dayKey, chat_id);
  }

  // ---- syndicates ------------------------------------------------------

  createSyndicate(input: {
    id: string;
    slug: string;
    name: string;
    owner_user_id: string | null;
    format: Syndicate["format"];
    privacy: Syndicate["privacy"];
  }): Syndicate {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO syndicate (id, slug, name, owner_user_id, format, privacy, created_at)
         VALUES (@id, @slug, @name, @owner_user_id, @format, @privacy, @created_at)`,
      )
      .run({ ...input, created_at: now });
    if (input.owner_user_id) {
      this.addMember(input.id, input.owner_user_id, "owner");
    }
    return this.getSyndicateById(input.id)!;
  }

  getSyndicateBySlug(slug: string): Syndicate | null {
    const row = this.db
      .prepare("SELECT * FROM syndicate WHERE slug = ?")
      .get(slug) as Syndicate | undefined;
    return row ?? null;
  }

  getSyndicateById(id: string): Syndicate | null {
    const row = this.db
      .prepare("SELECT * FROM syndicate WHERE id = ?")
      .get(id) as Syndicate | undefined;
    return row ?? null;
  }

  addMember(
    syndicate_id: string,
    user_id: string,
    role: SyndicateMember["role"] = "member",
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO syndicate_member (syndicate_id, user_id, joined_at, role)
         VALUES (?, ?, ?, ?)`,
      )
      .run(syndicate_id, user_id, Date.now(), role);
  }

  removeMember(syndicate_id: string, user_id: string): void {
    this.db
      .prepare("DELETE FROM syndicate_member WHERE syndicate_id = ? AND user_id = ?")
      .run(syndicate_id, user_id);
  }

  listMembers(syndicate_id: string): SyndicateMember[] {
    return this.db
      .prepare("SELECT * FROM syndicate_member WHERE syndicate_id = ?")
      .all(syndicate_id) as SyndicateMember[];
  }

  listMemberships(user_id: string): Syndicate[] {
    return this.db
      .prepare(
        `SELECT s.* FROM syndicate s
         JOIN syndicate_member m ON m.syndicate_id = s.id
         WHERE m.user_id = ?
         ORDER BY s.created_at DESC`,
      )
      .all(user_id) as Syndicate[];
  }
}
