/**
 * API key DAO for the Open Bot Arena.
 *
 * Keys are minted plaintext at issuance and the plaintext is returned
 * to the caller ONCE. All subsequent lookups go through a sha256 hash
 * stored in the api_key table, so a DB leak does not expose any
 * callable keys.
 *
 * Academic emails (.edu, .ac.uk, .ac.nz, .edu.au, .ac.za, .edu.cn,
 * .ac.jp) get 10x the default per-key quotas to support research
 * swarms. The list is intentionally small; ad-hoc requests go through
 * the manual /admin/api-keys page or info@tournamental.com.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.3, §14
 */
import { createHash, randomBytes } from "node:crypto";

import type { Database as DatabaseT } from "better-sqlite3";

const ACADEMIC_SUFFIXES = [
  ".edu",
  ".ac.uk",
  ".ac.nz",
  ".edu.au",
  ".ac.za",
  ".edu.cn",
  ".ac.jp",
];

const DEFAULT_QUOTA_BOTS = 1_000;
const ACADEMIC_QUOTA_BOTS = 10_000;
const DEFAULT_QUOTA_PICKS_PER_HOUR = 100_000;
const ACADEMIC_QUOTA_PICKS_PER_HOUR = 1_000_000;

export interface ApiKeyRow {
  key_hash: string;
  owner_email: string;
  label: string | null;
  quota_bots: number;
  quota_picks_per_hour: number;
  created_at: number;
  revoked_at: number | null;
}

export interface IssueParams {
  owner_email: string;
  label?: string | null;
  /** Override the clock (tests). */
  now?: number;
}

export interface IssueResult {
  /** Plaintext key, returned ONCE at issuance. Caller must surface to the user and not persist server-side. */
  api_key: string;
  key_hash: string;
  owner_email: string;
  label: string | null;
  quota_bots: number;
  quota_picks_per_hour: number;
  created_at: number;
}

/**
 * Mint a fresh 32-character base64url key with a stable `tnm_` prefix.
 * 24 random bytes = 192 bits, ~32 base64url chars after stripping
 * padding. Comfortably wider than the 128-bit unguessable threshold.
 */
export function generateApiKey(): string {
  const raw = randomBytes(24).toString("base64url").slice(0, 32);
  return `tnm_${raw}`;
}

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

function isAcademic(email: string): boolean {
  const lower = email.toLowerCase();
  return ACADEMIC_SUFFIXES.some((s) => lower.endsWith(s));
}

export class ApiKeyStore {
  constructor(private readonly db: DatabaseT) {}

  issue(params: IssueParams): IssueResult {
    const api_key = generateApiKey();
    const key_hash = hashApiKey(api_key);
    const academic = isAcademic(params.owner_email);
    const quota_bots = academic ? ACADEMIC_QUOTA_BOTS : DEFAULT_QUOTA_BOTS;
    const quota_picks_per_hour = academic
      ? ACADEMIC_QUOTA_PICKS_PER_HOUR
      : DEFAULT_QUOTA_PICKS_PER_HOUR;
    const created_at = params.now ?? Date.now();
    const label = params.label ?? null;
    this.db
      .prepare(
        `INSERT INTO api_key
           (key_hash, owner_email, label, quota_bots,
            quota_picks_per_hour, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        key_hash,
        params.owner_email,
        label,
        quota_bots,
        quota_picks_per_hour,
        created_at,
      );
    return {
      api_key,
      key_hash,
      owner_email: params.owner_email,
      label,
      quota_bots,
      quota_picks_per_hour,
      created_at,
    };
  }

  /**
   * Look up an active (non-revoked) key by its plaintext value. Returns
   * null on miss so the caller can answer 401 without leaking whether
   * the key existed and was revoked vs never minted.
   */
  lookupByPlain(plain: string): ApiKeyRow | null {
    const key_hash = hashApiKey(plain);
    return this.lookupByHash(key_hash);
  }

  lookupByHash(key_hash: string): ApiKeyRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM api_key
           WHERE key_hash = ? AND revoked_at IS NULL`,
      )
      .get(key_hash) as ApiKeyRow | undefined;
    return row ?? null;
  }

  revoke(plain: string, now: number = Date.now()): void {
    const key_hash = hashApiKey(plain);
    this.db
      .prepare(`UPDATE api_key SET revoked_at = ? WHERE key_hash = ?`)
      .run(now, key_hash);
  }
}
