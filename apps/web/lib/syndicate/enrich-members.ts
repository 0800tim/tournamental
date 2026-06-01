/**
 * Enrich a syndicate's `members[]` with cross-DB and per-bracket data
 * the share-landing page wants to render on each member card:
 *
 *   - avatar_url           (whether `data/avatars/<user_id>.jpg` exists)
 *   - display_name         (from auth-sms users table)
 *   - favourite_team_code  (from auth-sms users.favourite_team_code)
 *   - country_iso2         (from auth-sms users.country, e.g. "NZ")
 *   - predicted_winner_code (cascade of their bracket → final winner)
 *   - flag_emoji           (resolved per Tim's priority chain:
 *                           predicted_winner > favourite_team > country)
 *
 * The chain is computed inline here so the renderer can just read
 * `member.flag_emoji` without knowing the priority rule.
 *
 * Server-only: reads two SQLite files (game.db, auth.db) and one
 * filesystem path (apps/web/data/avatars/). Never throws on missing
 * data; falls back to the member's pre-existing fields.
 *
 * Performance: one batched SELECT per DB + one filesystem stat per
 * member. Brackets are cascaded one by one (cheap; ~5ms each), with
 * the result memoised inside this call so a member appearing twice
 * (impossible today but cheap to guard) isn't re-cascaded.
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  cascade,
  loadFixtures2026,
  type BracketPrediction,
  type Tournament,
} from "@tournamental/bracket-engine";

import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";
import { avatarUrlFor } from "@/lib/profile/avatar";

import type { SyndicateMember } from "./store";

interface CanonicalTeam {
  readonly code: string;
  readonly flag_emoji: string;
}

const TEAM_FLAG_BY_CODE: Map<string, string> = (() => {
  const out = new Map<string, string>();
  const raw = (canonicalTeamsRaw as { teams: CanonicalTeam[] }).teams;
  for (const t of raw) out.set(t.code, t.flag_emoji);
  return out;
})();

const COUNTRY_FALLBACK_EMOJI = "🏳️";

/**
 * ISO-3166-1 alpha-2 country code → emoji flag via the regional
 * indicator codepoint trick. "NZ" → 🇳🇿, "AU" → 🇦🇺. Bad input → null.
 */
function iso2ToFlagEmoji(code: string | null | undefined): string | null {
  if (!code || code.length !== 2) return null;
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return null;
  const base = 0x1f1e6 - "A".charCodeAt(0);
  return String.fromCodePoint(
    base + upper.charCodeAt(0),
    base + upper.charCodeAt(1),
  );
}

function teamCodeToFlag(code: string | null | undefined): string | null {
  if (!code) return null;
  return TEAM_FLAG_BY_CODE.get(code.toUpperCase()) ?? null;
}

function resolveAuthDbPath(): string | null {
  const explicit =
    process.env.AUTH_DB_PATH ?? process.env.AUTH_SMS_DB_PATH ?? null;
  if (explicit) return explicit;
  // apps/web's cwd is .../apps/web at runtime; the auth-sms db sits in
  // a sibling app's data dir. Walk up two levels to the repo root.
  const root = resolve(process.cwd(), "..", "..");
  return resolve(root, "apps/auth-sms/data/auth.db");
}

function resolveGameDbPath(): string | null {
  const explicit = process.env.GAME_DB_PATH ?? process.env.VTORN_GAME_DB_PATH;
  if (explicit) return explicit;
  const root = resolve(process.cwd(), "..", "..");
  return resolve(root, "apps/game/data/game.db");
}

function resolveAvatarOnDiskPath(userId: string): string {
  const dir =
    process.env.AVATARS_DIR ??
    resolve(process.cwd(), "..", "..", "apps/web/data/avatars");
  return resolve(dir, `${userId}.jpg`);
}

interface AuthRow {
  readonly id: string;
  readonly country: string | null;
  readonly favourite_team_code: string | null;
  readonly display_name: string | null;
}

function loadAuthRows(userIds: string[]): Map<string, AuthRow> {
  const out = new Map<string, AuthRow>();
  if (userIds.length === 0) return out;
  const path = resolveAuthDbPath();
  if (!path || !existsSync(path)) return out;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    const placeholders = userIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id, country, favourite_team_code, display_name
           FROM user
          WHERE id IN (${placeholders})`,
      )
      .all(...userIds) as AuthRow[];
    for (const r of rows) out.set(r.id, r);
    db.close();
  } catch {
    // best-effort: fall back to country/flag defaults
  }
  return out;
}

function loadBracketChampions(
  userIds: string[],
  tournament: Tournament,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (userIds.length === 0) return out;
  const path = resolveGameDbPath();
  if (!path || !existsSync(path)) return out;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    const placeholders = userIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT user_id, payload_json
           FROM brackets
          WHERE tournament_id = ?
            AND user_id IN (${placeholders})`,
      )
      .all(tournament.id, ...userIds) as Array<{
      user_id: string;
      payload_json: string;
    }>;
    for (const r of rows) {
      try {
        const bracket = JSON.parse(r.payload_json);
        const input: BracketPrediction = bracketToCascadeInput(
          tournament,
          bracket,
          r.user_id,
        );
        const cascaded = cascade(tournament, input);
        const final = cascaded.knockouts.find((k) => k.stage === "f");
        const champion =
          final?.effective_winner ?? final?.predicted_winner ?? null;
        out.set(r.user_id, champion);
      } catch {
        out.set(r.user_id, null);
      }
    }
    db.close();
  } catch {
    // best-effort
  }
  return out;
}

/**
 * Resolve the flag emoji a member's card should display, per Tim's
 * priority chain (predicted winner > favourite team > country of
 * origin). Returns the country white-flag fallback only when nothing
 * resolves at all.
 */
function resolveDisplayFlag(args: {
  readonly predictedWinner: string | null;
  readonly favouriteTeam: string | null;
  readonly countryIso2: string | null;
  readonly legacyEmoji: string;
}): string {
  const fromPredicted = teamCodeToFlag(args.predictedWinner);
  if (fromPredicted) return fromPredicted;
  const fromFavourite = teamCodeToFlag(args.favouriteTeam);
  if (fromFavourite) return fromFavourite;
  const fromCountry = iso2ToFlagEmoji(args.countryIso2);
  if (fromCountry) return fromCountry;
  // Honour an explicitly-set legacy emoji (e.g. the 🇳🇿 default the
  // pre-enrichment SyndicateRecord builder bakes in) over the white-flag.
  if (args.legacyEmoji && args.legacyEmoji !== "🏳️") return args.legacyEmoji;
  return COUNTRY_FALLBACK_EMOJI;
}

export function enrichSyndicateMembers(args: {
  readonly members: ReadonlyArray<SyndicateMember>;
  readonly tournamentId: string;
}): ReadonlyArray<SyndicateMember> {
  const { members, tournamentId } = args;
  if (members.length === 0) return members;

  // Resolve only members that carry a real user_id; anon:* rows can't
  // be enriched (no auth-sms row, no bracket).
  const realUserIds = members
    .map((m) => m.user_id ?? "")
    .filter((id) => id && !id.startsWith("anon:"));

  let tournament: Tournament | null = null;
  try {
    if (tournamentId === "fifa-wc-2026") tournament = loadFixtures2026();
  } catch {
    tournament = null;
  }

  const authByUserId = loadAuthRows(realUserIds);
  const championByUserId = tournament
    ? loadBracketChampions(realUserIds, tournament)
    : new Map<string, string | null>();

  return members.map((m) => {
    const userId = m.user_id ?? "";
    const auth = userId ? authByUserId.get(userId) ?? null : null;
    const predictedWinner = userId
      ? championByUserId.get(userId) ?? null
      : null;
    const favouriteTeam = auth?.favourite_team_code ?? null;
    const countryIso2 = auth?.country ?? null;
    const displayName = m.display_name ?? auth?.display_name ?? null;
    const avatarOnDisk = userId
      ? existsSync(resolveAvatarOnDiskPath(userId))
      : false;
    const avatarUrl = avatarOnDisk ? avatarUrlFor(userId) : null;
    const flagEmoji = resolveDisplayFlag({
      predictedWinner,
      favouriteTeam,
      countryIso2,
      legacyEmoji: m.flag_emoji,
    });
    return {
      ...m,
      display_name: displayName,
      avatar_url: avatarUrl,
      predicted_winner_code: predictedWinner,
      favourite_team_code: favouriteTeam,
      country_iso2: countryIso2,
      flag_emoji: flagEmoji,
    };
  });
}
