/**
 * Drips Network adapter.
 *
 * Two backends behind a uniform interface:
 *
 *   - 'mock' (default): no network, no chain, no keys. Returns deterministic
 *     pseudo-tx-hashes derived from the input so unit tests can assert.
 *   - 'real': stub. Reads RPC URL + account + private key from env. Constructs
 *     payload shape compatible with Drips Drip Lists on Sepolia testnet.
 *     Does NOT actually transact.
 *
 * WARNING: Mainnet integration with real on-chain writes requires an external
 * smart-contract security audit (per docs/21 + docs/40) before flipping a
 * real signer on. The 'real' backend stub deliberately throws if asked to
 * sign — the audit-gate is enforced in code, not just in docs.
 *
 * The interface here mirrors what we actually need from Drips for v0.1:
 *   - setSplits(splits): push the configured contributor weights to a Drip List.
 *   - pushPayout(periodId, totalUsd): trigger a payout for a configured period.
 *
 * The Drips Network has a richer API (NFT-driven Drip Lists, streaming Drips,
 * etc.); we only model the slice the bridge needs.
 */

import { createHash } from 'node:crypto';

export type DripsBackend = 'mock' | 'real';

export interface DripsRecipient {
  /** Ethereum address `0x...` (40 hex chars). */
  recipient: string;
  /**
   * Weight in basis points of 1_000_000 (Drips' canonical resolution).
   * Sum across recipients must be ≤ 1_000_000; the difference is implicit
   * "overhead" / treasury share in real Drips.
   */
  weight: number;
}

export interface SetSplitsResult {
  ok: true;
  backend: DripsBackend;
  /** Pseudo-tx hash (mock) or tx hash returned by the chain (real). */
  txHash: string;
  recipientCount: number;
}

export interface PushPayoutResult {
  ok: true;
  backend: DripsBackend;
  /** Pseudo-tx hash (mock) or tx hash returned by the chain (real). */
  txHash: string;
  periodId: string;
  totalAmountUsd: number;
}

export interface DripsClient {
  readonly backend: DripsBackend;
  setSplits(splits: DripsRecipient[]): Promise<SetSplitsResult>;
  pushPayout(periodId: string, totalAmountUsd: number): Promise<PushPayoutResult>;
}

export interface DripsClientOptions {
  backend?: DripsBackend;
  /** Used by the real backend; ignored by mock. */
  rpcUrl?: string;
  /** Address of the controlling Drips Drip List owner; ignored by mock. */
  accountAddress?: string;
  /** Hex-encoded private key for the controlling owner; ignored by mock. */
  privateKey?: string;
  /** Drip List ID (uint256, decimal string); ignored by mock. */
  dripListId?: string;
  /** Optional clock for test determinism. */
  now?: () => number;
}

/** Weight basis-points constant (Drips canonical resolution). */
export const DRIPS_WEIGHT_TOTAL = 1_000_000;

/**
 * Convert a payout-USD distribution into Drips weights (basis-points of 1e6).
 *
 * The largest recipient absorbs rounding remainder so the weights sum to
 * exactly DRIPS_WEIGHT_TOTAL.
 */
export function payoutsToWeights(
  payouts: Array<{ recipient: string; payoutUsd: number }>,
): DripsRecipient[] {
  const total = payouts.reduce((acc, p) => acc + p.payoutUsd, 0);
  if (total <= 0 || payouts.length === 0) return [];

  const provisional: DripsRecipient[] = payouts.map((p) => ({
    recipient: p.recipient,
    weight: Math.floor((p.payoutUsd / total) * DRIPS_WEIGHT_TOTAL),
  }));
  const allocated = provisional.reduce((acc, r) => acc + r.weight, 0);
  const remainder = DRIPS_WEIGHT_TOTAL - allocated;
  if (remainder !== 0 && provisional.length > 0) {
    let topIdx = 0;
    for (let i = 1; i < provisional.length; i++) {
      if (provisional[i].weight > provisional[topIdx].weight) topIdx = i;
    }
    provisional[topIdx] = {
      ...provisional[topIdx],
      weight: provisional[topIdx].weight + remainder,
    };
  }
  return provisional;
}

function deterministicHash(parts: string[]): string {
  const h = createHash('sha256').update(parts.join('|')).digest('hex');
  return `0x${h}`;
}

/**
 * Mock client: does not touch the network. Returns deterministic pseudo-tx
 * hashes derived from the inputs so test assertions are stable.
 */
export class MockDripsClient implements DripsClient {
  readonly backend: DripsBackend = 'mock';
  private readonly now: () => number;
  private callCounter = 0;

  constructor(opts: DripsClientOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  async setSplits(splits: DripsRecipient[]): Promise<SetSplitsResult> {
    if (splits.length === 0) {
      throw new Error('setSplits: at least one recipient required');
    }
    const totalWeight = splits.reduce((acc, s) => acc + s.weight, 0);
    if (totalWeight > DRIPS_WEIGHT_TOTAL) {
      throw new Error(
        `setSplits: total weight ${totalWeight} exceeds DRIPS_WEIGHT_TOTAL ${DRIPS_WEIGHT_TOTAL}`,
      );
    }
    for (const s of splits) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(s.recipient)) {
        throw new Error(`setSplits: invalid recipient address: ${s.recipient}`);
      }
      if (s.weight < 0) {
        throw new Error(`setSplits: weight must be >= 0`);
      }
    }
    this.callCounter++;
    const txHash = deterministicHash([
      'setSplits',
      String(this.callCounter),
      String(this.now()),
      ...splits.map((s) => `${s.recipient}:${s.weight}`),
    ]);
    return {
      ok: true,
      backend: 'mock',
      txHash,
      recipientCount: splits.length,
    };
  }

  async pushPayout(periodId: string, totalAmountUsd: number): Promise<PushPayoutResult> {
    if (!periodId) throw new Error('pushPayout: periodId required');
    if (!Number.isFinite(totalAmountUsd) || totalAmountUsd <= 0) {
      throw new Error('pushPayout: totalAmountUsd must be > 0');
    }
    this.callCounter++;
    const txHash = deterministicHash([
      'pushPayout',
      periodId,
      totalAmountUsd.toFixed(2),
      String(this.callCounter),
      String(this.now()),
    ]);
    return {
      ok: true,
      backend: 'mock',
      txHash,
      periodId,
      totalAmountUsd,
    };
  }
}

/**
 * Real client: stub interface only.
 *
 * WARNING: mainnet integration requires an external smart-contract security
 * audit per docs/21 + docs/40. This stub does not sign or broadcast txs. It
 * exists so route handlers can be written against the same shape the real
 * adapter will eventually fulfil.
 *
 * To wire up real Drips:
 *   1. `pnpm add viem @drips-network/sdk` (gated behind a follow-up PR)
 *   2. Implement setSplits via the Drip List contract on Sepolia first.
 *   3. After audit, flip a `DRIPS_NETWORK=mainnet` env switch and the same
 *      code path goes to mainnet.
 */
export class RealDripsClient implements DripsClient {
  readonly backend: DripsBackend = 'real';
  private readonly opts: DripsClientOptions;

  constructor(opts: DripsClientOptions = {}) {
    this.opts = opts;
    if (!opts.rpcUrl) throw new Error('RealDripsClient: rpcUrl is required');
    if (!opts.accountAddress) {
      throw new Error('RealDripsClient: accountAddress is required');
    }
    if (!opts.privateKey) {
      throw new Error('RealDripsClient: privateKey is required (load from env, never commit)');
    }
    if (!opts.dripListId) {
      throw new Error('RealDripsClient: dripListId is required');
    }
  }

  async setSplits(_splits: DripsRecipient[]): Promise<SetSplitsResult> {
    // WARNING: mainnet integration requires audit. This stub MUST NOT sign
    // or broadcast. Replace with viem + Drip List ABI call only after the
    // Phase-2 audit completes (docs/21).
    throw new Error(
      'RealDripsClient.setSplits: not implemented — mainnet writes are audit-gated. ' +
        'See docs/40-drips-network-integration.md for the audit checklist.',
    );
  }

  async pushPayout(_periodId: string, _totalAmountUsd: number): Promise<PushPayoutResult> {
    throw new Error(
      'RealDripsClient.pushPayout: not implemented — mainnet writes are audit-gated. ' +
        'See docs/40-drips-network-integration.md for the audit checklist.',
    );
  }
}

/**
 * Factory used by the server. Reads DRIPS_BACKEND from env (default 'mock').
 *
 * Caller can pass explicit opts to override env-driven config (used by tests).
 */
export function makeDripsClient(opts: DripsClientOptions = {}): DripsClient {
  const backend = opts.backend ?? (process.env.DRIPS_BACKEND as DripsBackend | undefined) ?? 'mock';
  if (backend === 'real') {
    return new RealDripsClient({
      rpcUrl: opts.rpcUrl ?? process.env.DRIPS_RPC_URL,
      accountAddress: opts.accountAddress ?? process.env.DRIPS_ACCOUNT_ADDRESS,
      privateKey: opts.privateKey ?? process.env.DRIPS_PRIVATE_KEY,
      dripListId: opts.dripListId ?? process.env.DRIPS_DRIP_LIST_ID,
      now: opts.now,
    });
  }
  return new MockDripsClient(opts);
}
