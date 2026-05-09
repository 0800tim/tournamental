/**
 * Receipt issuance and finalisation logic.
 *
 * The leaf hash for a receipt is:
 *   leafHash( canonicalBytes(bracket) || salt )
 *
 * where leafHash applies the domain-separated SHA-256 from merkle.ts and the
 * salt is a per-receipt 32-byte random value handed back to the user. Two
 * properties:
 *
 * 1. Privacy. Without the salt, an adversary cannot brute-force a guess of
 *    the bracket — even a small bracket space (16 teams to seed) would
 *    otherwise be checkable in a fraction of a second. With a 256-bit
 *    secret salt the search becomes infeasible.
 *
 * 2. Independence. Two users predicting the same bracket get distinct leaf
 *    hashes, so neither can claim the other's receipt by replaying its
 *    payload.
 *
 * Day-bucket determination is UTC midnight; if the operator wants finer
 * cadence (per-hour, per-tournament-window) they can override at finalise
 * time. For Phase 1 we keep it daily.
 */

import { randomBytes } from 'node:crypto';
import { sha256 } from '@noble/hashes/sha256';
import {
  bytesToHex,
  buildTree,
  concatBytes,
  hexToBytes,
  leafHash,
  makeProof,
  type ProofStep,
} from './merkle.js';
import { canonicalBytes } from './canonical.js';

export const SALT_LEN = 32;

export interface IssueInput {
  bracketCanonicalJson: unknown;
  userId: string;
  tournamentId: string;
  /** Override for tests; defaults to Date.now(). */
  now?: number;
  /** Override for tests; defaults to randomBytes(32). */
  salt?: Uint8Array;
}

export interface IssueResult {
  leafHash: string; // hex
  salt: string; // hex
  lockedAt: number; // unix ms
  dayBucket: string; // YYYY-MM-DD UTC
  userIdHash: string; // hex (sha256 of userId)
}

export function dayBucketFor(unixMs: number): string {
  const d = new Date(unixMs);
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function hashUserId(userId: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(userId)));
}

export function computeLeafHash(bracketCanonicalJson: unknown, salt: Uint8Array): string {
  if (salt.length !== SALT_LEN) {
    throw new Error(`salt must be ${SALT_LEN} bytes; got ${salt.length}`);
  }
  const payload = concatBytes(canonicalBytes(bracketCanonicalJson), salt);
  return bytesToHex(leafHash(payload));
}

export function buildIssue(input: IssueInput): IssueResult {
  const lockedAt = input.now ?? Date.now();
  const salt = input.salt ?? new Uint8Array(randomBytes(SALT_LEN));
  if (salt.length !== SALT_LEN) {
    throw new Error(`salt must be ${SALT_LEN} bytes; got ${salt.length}`);
  }
  const leafHex = computeLeafHash(input.bracketCanonicalJson, salt);
  return {
    leafHash: leafHex,
    salt: bytesToHex(salt),
    lockedAt,
    dayBucket: dayBucketFor(lockedAt),
    userIdHash: hashUserId(input.userId),
  };
}

export interface FinaliseLeavesInput {
  leafHashes: string[]; // hex, in stable order (we use insertion order from the DB)
}

export interface FinaliseLeavesResult {
  rootHex: string;
  proofs: Map<string, ProofStep[]>; // leafHex → proof
  leafCount: number;
}

export function finaliseLeaves(input: FinaliseLeavesInput): FinaliseLeavesResult {
  const leaves = input.leafHashes.map(hexToBytes);
  if (leaves.length === 0) {
    throw new Error('cannot finalise an empty leaf set');
  }
  const tree = buildTree(leaves);
  const proofs = new Map<string, ProofStep[]>();
  for (let i = 0; i < input.leafHashes.length; i++) {
    proofs.set(input.leafHashes[i], makeProof(tree, i));
  }
  return {
    rootHex: bytesToHex(tree.root),
    proofs,
    leafCount: leaves.length,
  };
}

/**
 * The exact byte sequence Ed25519-signed when finalising a root. We sign the
 * raw 32-byte root rather than its hex string so a verifier in another
 * language doesn't have to worry about hex-case canonicalisation.
 */
export function rootSigningMessage(rootHex: string): Uint8Array {
  return hexToBytes(rootHex);
}
