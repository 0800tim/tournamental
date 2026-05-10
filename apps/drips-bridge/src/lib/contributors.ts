/**
 * Contributor + RevenueDistribution domain model and JSONL-backed store.
 *
 * Tournamental is Apache-2.0 licensed; contributors (humans + agents) share the
 * platform's revenue via Drips Network per the pitch. This module is the
 * source of truth for *who* contributes and *how much* of each period's
 * receipts flows to whom.
 *
 * Persistence is append-only JSONL so the on-disk file doubles as an audit
 * log — every state transition shows up as a new line. The in-memory map is
 * rebuilt by replaying the file on boot. A "tombstone" record (op: 'delete')
 * marks a contributor as removed without rewriting history; we don't expose
 * delete in v0.1 but the schema supports it.
 *
 * Two stores live side-by-side:
 *   - `data/contributors.jsonl` — Contributor records (insert + patch + tombstone)
 *   - `data/distributions.jsonl` — RevenueDistribution records (create + status updates)
 *
 * Both are line-delimited JSON; one record per line, each with an `op` discriminator.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Role buckets used for shares allocation policy (informational; not enforced here). */
export type ContributorRole = 'core' | 'agent' | 'contributor' | 'founder';

export interface Contributor {
  /** Stable internal ID, format `c_<24-hex>`. */
  id: string;
  /** GitHub login (lowercased). The idempotency key for registration. */
  githubLogin: string;
  /** Optional Ethereum payout address. Required before push to Drips. */
  ethAddress?: string;
  /** Display name (defaults to githubLogin if not supplied). */
  displayName: string;
  /** ISO-8601 timestamp the contributor was first registered. */
  joinedAt: string;
  /** Role bucket — informational; splits use `activeShares` directly. */
  role: ContributorRole;
  /**
   * Active shares — non-negative integer. Splits are proportional to this
   * across all contributors with `activeShares > 0`.
   */
  activeShares: number;
}

/** Per-contributor split inside a RevenueDistribution (snapshot at create time). */
export interface DistributionSplit {
  contributorId: string;
  /** Shares the contributor held at the moment the distribution was created. */
  sharesAtSnapshot: number;
  /** USD payout this contributor earns; rounded to 2dp. */
  payoutUsd: number;
  /** Tx hash if the distribution was pushed on-chain (mock or real). */
  txHash?: string;
}

export type DistributionStatus = 'pending' | 'pushed' | 'confirmed';

export interface RevenueDistribution {
  /** Stable ID, format `d_<24-hex>`. */
  id: string;
  /** YYYY-MM (e.g. "2026-05") — the receipts period this distribution covers. */
  period: string;
  /** Total USD receipts being distributed. */
  totalReceiptsUsd: number;
  /** Per-contributor splits (sum of payoutUsd ≤ totalReceiptsUsd, modulo rounding). */
  splits: DistributionSplit[];
  /** ISO-8601 timestamp distribution was created. */
  createdAt: string;
  /** Lifecycle status. */
  status: DistributionStatus;
  /** Tx hash from the underlying Drips backend if pushed. */
  txHash?: string;
  /** ISO-8601 timestamp set when status changes. */
  updatedAt?: string;
}

// ---------- JSONL record envelopes ----------

interface ContributorInsertRecord {
  op: 'insert';
  contributor: Contributor;
}
interface ContributorPatchRecord {
  op: 'patch';
  id: string;
  patch: Partial<Pick<Contributor, 'ethAddress' | 'role' | 'activeShares' | 'displayName'>>;
  ts: string;
}
interface ContributorDeleteRecord {
  op: 'delete';
  id: string;
  ts: string;
}
type ContributorRecord =
  | ContributorInsertRecord
  | ContributorPatchRecord
  | ContributorDeleteRecord;

interface DistributionInsertRecord {
  op: 'insert';
  distribution: RevenueDistribution;
}
interface DistributionStatusRecord {
  op: 'status';
  id: string;
  status: DistributionStatus;
  txHash?: string;
  splits?: DistributionSplit[];
  ts: string;
}
type DistributionRecord = DistributionInsertRecord | DistributionStatusRecord;

// ---------- helpers ----------

function newId(prefix: 'c' | 'd'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(filePath: string): void {
  const d = dirname(filePath);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function appendLine(path: string, obj: unknown): void {
  ensureDir(path);
  appendFileSync(path, `${JSON.stringify(obj)}\n`, 'utf8');
}

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  return raw.split('\n').filter((l) => l.trim().length > 0);
}

/** Round to 2dp using banker-safe rounding-half-away-from-zero. */
export function round2dp(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------- Splits maths ----------

export interface ComputeSplitsInput {
  contributors: Contributor[];
  totalReceiptsUsd: number;
}

/**
 * Compute proportional splits over the contributors with activeShares > 0.
 *
 * - Skips contributors with activeShares === 0 (no allocation).
 * - Each share gets `totalReceiptsUsd / sumShares` USD; per-contributor payout
 *   is rounded to 2dp.
 * - The largest-shares contributor absorbs any rounding remainder so the
 *   allocations sum to exactly `totalReceiptsUsd` (within 0.01 USD).
 * - Contributors with no eth address are still included in the snapshot —
 *   they just won't be pushable to Drips until they add one. This is a
 *   deliberate choice: shares are earned by *contribution*, not by having
 *   a wallet ready.
 */
export function computeSplits(input: ComputeSplitsInput): DistributionSplit[] {
  const eligible = input.contributors.filter((c) => c.activeShares > 0);
  const sumShares = eligible.reduce((acc, c) => acc + c.activeShares, 0);
  if (sumShares === 0 || input.totalReceiptsUsd <= 0) return [];

  const provisional: DistributionSplit[] = eligible.map((c) => {
    const share = c.activeShares / sumShares;
    return {
      contributorId: c.id,
      sharesAtSnapshot: c.activeShares,
      payoutUsd: round2dp(share * input.totalReceiptsUsd),
    };
  });

  // Reconcile the rounding error onto the highest-share contributor.
  const allocated = provisional.reduce((acc, s) => acc + s.payoutUsd, 0);
  const remainder = round2dp(input.totalReceiptsUsd - allocated);
  if (remainder !== 0 && provisional.length > 0) {
    let topIdx = 0;
    for (let i = 1; i < provisional.length; i++) {
      if (provisional[i].sharesAtSnapshot > provisional[topIdx].sharesAtSnapshot) {
        topIdx = i;
      }
    }
    provisional[topIdx] = {
      ...provisional[topIdx],
      payoutUsd: round2dp(provisional[topIdx].payoutUsd + remainder),
    };
  }

  return provisional;
}

// ---------- ContributorStore ----------

export interface ContributorStoreOptions {
  /** Path to JSONL file. Use the literal string ":memory:" for tests. */
  path: string;
}

export class ContributorStore {
  private readonly path: string;
  private readonly memOnly: boolean;
  private readonly byId = new Map<string, Contributor>();
  private readonly byLogin = new Map<string, string>(); // githubLogin (lc) -> id

  constructor(opts: ContributorStoreOptions) {
    this.path = opts.path;
    this.memOnly = opts.path === ':memory:';
    if (!this.memOnly) {
      this.replay();
    }
  }

  private replay(): void {
    const lines = readLines(this.path);
    for (const line of lines) {
      let rec: ContributorRecord;
      try {
        rec = JSON.parse(line) as ContributorRecord;
      } catch {
        // Skip corrupt lines defensively — JSONL append-only stores can
        // tear on power loss; one bad line shouldn't lose the whole log.
        continue;
      }
      this.applyRecord(rec);
    }
  }

  private applyRecord(rec: ContributorRecord): void {
    if (rec.op === 'insert') {
      this.byId.set(rec.contributor.id, rec.contributor);
      this.byLogin.set(rec.contributor.githubLogin.toLowerCase(), rec.contributor.id);
    } else if (rec.op === 'patch') {
      const existing = this.byId.get(rec.id);
      if (!existing) return;
      const next: Contributor = { ...existing, ...rec.patch };
      this.byId.set(rec.id, next);
    } else if (rec.op === 'delete') {
      const existing = this.byId.get(rec.id);
      if (!existing) return;
      this.byId.delete(rec.id);
      this.byLogin.delete(existing.githubLogin.toLowerCase());
    }
  }

  /**
   * Register a contributor. Idempotent on githubLogin (case-insensitive):
   *   - If the login exists, the existing contributor is returned untouched
   *     unless `upsert: true` is passed, in which case the patchable fields
   *     (ethAddress, role, activeShares, displayName) are merged.
   */
  register(input: {
    githubLogin: string;
    ethAddress?: string;
    displayName?: string;
    role?: ContributorRole;
    activeShares?: number;
    upsert?: boolean;
  }): { contributor: Contributor; created: boolean } {
    const login = input.githubLogin.toLowerCase();
    const existingId = this.byLogin.get(login);
    if (existingId) {
      const existing = this.byId.get(existingId);
      if (!existing) throw new Error('contributor index out of sync');
      if (!input.upsert) {
        return { contributor: existing, created: false };
      }
      const patch: Partial<Contributor> = {};
      if (input.ethAddress !== undefined) patch.ethAddress = input.ethAddress;
      if (input.displayName !== undefined) patch.displayName = input.displayName;
      if (input.role !== undefined) patch.role = input.role;
      if (input.activeShares !== undefined) patch.activeShares = input.activeShares;
      const updated = this.update(existingId, patch);
      return { contributor: updated, created: false };
    }

    const contributor: Contributor = {
      id: newId('c'),
      githubLogin: login,
      ethAddress: input.ethAddress,
      displayName: input.displayName ?? input.githubLogin,
      joinedAt: nowIso(),
      role: input.role ?? 'contributor',
      activeShares: input.activeShares ?? 0,
    };
    const rec: ContributorInsertRecord = { op: 'insert', contributor };
    this.applyRecord(rec);
    if (!this.memOnly) appendLine(this.path, rec);
    return { contributor, created: true };
  }

  update(
    id: string,
    patch: Partial<Pick<Contributor, 'ethAddress' | 'role' | 'activeShares' | 'displayName'>>,
  ): Contributor {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`contributor not found: ${id}`);
    if (patch.activeShares !== undefined && patch.activeShares < 0) {
      throw new Error('activeShares must be >= 0');
    }
    if (patch.ethAddress !== undefined && patch.ethAddress.length > 0) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(patch.ethAddress)) {
        throw new Error('ethAddress must be 0x + 40 hex chars');
      }
    }
    const rec: ContributorPatchRecord = { op: 'patch', id, patch, ts: nowIso() };
    this.applyRecord(rec);
    if (!this.memOnly) appendLine(this.path, rec);
    return this.byId.get(id)!;
  }

  get(id: string): Contributor | undefined {
    return this.byId.get(id);
  }

  getByLogin(login: string): Contributor | undefined {
    const id = this.byLogin.get(login.toLowerCase());
    return id ? this.byId.get(id) : undefined;
  }

  list(): Contributor[] {
    return [...this.byId.values()].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  count(): number {
    return this.byId.size;
  }
}

// ---------- DistributionStore ----------

export interface DistributionStoreOptions {
  path: string;
}

export class DistributionStore {
  private readonly path: string;
  private readonly memOnly: boolean;
  private readonly byId = new Map<string, RevenueDistribution>();

  constructor(opts: DistributionStoreOptions) {
    this.path = opts.path;
    this.memOnly = opts.path === ':memory:';
    if (!this.memOnly) {
      this.replay();
    }
  }

  private replay(): void {
    const lines = readLines(this.path);
    for (const line of lines) {
      let rec: DistributionRecord;
      try {
        rec = JSON.parse(line) as DistributionRecord;
      } catch {
        continue;
      }
      this.applyRecord(rec);
    }
  }

  private applyRecord(rec: DistributionRecord): void {
    if (rec.op === 'insert') {
      this.byId.set(rec.distribution.id, rec.distribution);
    } else if (rec.op === 'status') {
      const existing = this.byId.get(rec.id);
      if (!existing) return;
      const updated: RevenueDistribution = {
        ...existing,
        status: rec.status,
        txHash: rec.txHash ?? existing.txHash,
        splits: rec.splits ?? existing.splits,
        updatedAt: rec.ts,
      };
      this.byId.set(rec.id, updated);
    }
  }

  create(input: {
    period: string;
    totalReceiptsUsd: number;
    splits: DistributionSplit[];
  }): RevenueDistribution {
    const dist: RevenueDistribution = {
      id: newId('d'),
      period: input.period,
      totalReceiptsUsd: input.totalReceiptsUsd,
      splits: input.splits,
      createdAt: nowIso(),
      status: 'pending',
    };
    const rec: DistributionInsertRecord = { op: 'insert', distribution: dist };
    this.applyRecord(rec);
    if (!this.memOnly) appendLine(this.path, rec);
    return dist;
  }

  setStatus(
    id: string,
    status: DistributionStatus,
    opts: { txHash?: string; splits?: DistributionSplit[] } = {},
  ): RevenueDistribution {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`distribution not found: ${id}`);
    const rec: DistributionStatusRecord = {
      op: 'status',
      id,
      status,
      txHash: opts.txHash,
      splits: opts.splits,
      ts: nowIso(),
    };
    this.applyRecord(rec);
    if (!this.memOnly) appendLine(this.path, rec);
    return this.byId.get(id)!;
  }

  get(id: string): RevenueDistribution | undefined {
    return this.byId.get(id);
  }

  list(): RevenueDistribution[] {
    return [...this.byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  count(): number {
    return this.byId.size;
  }
}

/** Validate a YYYY-MM period string. */
export function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}
