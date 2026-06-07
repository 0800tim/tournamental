/**
 * Sorted-pair sha256 merkle tree.
 *
 * Used by the OTS kickoff commitment job (and the federated nodes that
 * will mirror it in Phase 2). The on-chain commit posts the root; any
 * third party can later request a single bot's pick + inclusion proof
 * and verify it against the root anchored on Bitcoin.
 *
 * Why sorted-pair: it lets a verifier compute the parent without
 * needing to know which side of the pair the sibling was on. Saves
 * one bit per proof step. Apaches the same construction as OpenZeppelin
 * MerkleProof.sol so the on-chain verifier (Phase 2) ports trivially.
 *
 * Why a fresh in-game implementation when apps/vstamp already has a
 * domain-separated merkle: vstamp's variant is RFC 6962 (left/right
 * position encoded in the proof step) and is the right shape for that
 * service's daily-root receipts. The Phase 2 federation audit needs
 * the simpler sorted-pair variant so external operators can port the
 * verifier to any language in 50 lines.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */
import { createHash } from "node:crypto";

export type Outcome = "home_win" | "draw" | "away_win";

export interface PickLeaf {
  bot_id: string;
  match_id: string;
  outcome: Outcome;
  /** locked_at_utc in epoch ms */
  t: number;
}

export interface MerkleTree {
  root: string;
  /** Hex sha256 of every leaf, in input order. */
  leaves: string[];
  /** proofs[i] is the inclusion path for picks[i] (each entry is a hex sibling). */
  proofs: string[][];
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256ConcatHex(a: string, b: string): string {
  return sha256Hex(Buffer.from(a + b, "hex"));
}

export function leafHash(
  bot_id: string,
  match_id: string,
  outcome: string,
  t: number,
): string {
  return sha256Hex(
    Buffer.from(`${bot_id}|${match_id}|${outcome}|${t}`, "utf8"),
  );
}

function pairHash(a: string, b: string): string {
  // Sort lexicographically so the parent is independent of left/right order.
  return a <= b ? sha256ConcatHex(a, b) : sha256ConcatHex(b, a);
}

/**
 * Build the tree. Empty picks produce the canonical empty-tree root
 * (sha256 of the empty string) so callers do not have to special-case
 * "no picks landed pre-kickoff".
 */
export function buildMerkle(picks: readonly PickLeaf[]): MerkleTree {
  if (picks.length === 0) {
    return {
      root: sha256Hex(Buffer.alloc(0)),
      leaves: [],
      proofs: [],
    };
  }
  const leaves = picks.map((p) =>
    leafHash(p.bot_id, p.match_id, p.outcome, p.t),
  );
  if (leaves.length === 1) {
    return { root: leaves[0]!, leaves, proofs: [[]] };
  }
  // Build every level. Duplicate the trailing node on odd levels.
  const levels: string[][] = [leaves.slice()];
  while (levels[levels.length - 1]!.length > 1) {
    const cur = levels[levels.length - 1]!;
    if (cur.length % 2 === 1) cur.push(cur[cur.length - 1]!);
    const next: string[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(pairHash(cur[i]!, cur[i + 1]!));
    }
    levels.push(next);
  }
  const root = levels[levels.length - 1]![0]!;
  const proofs = leaves.map((_, idx) => buildProof(levels, idx));
  return { root, leaves, proofs };
}

function buildProof(levels: readonly string[][], leafIdx: number): string[] {
  const proof: string[] = [];
  let idx = leafIdx;
  for (let lvl = 0; lvl < levels.length - 1; lvl++) {
    const level = levels[lvl]!;
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const sibling = level[siblingIdx];
    if (sibling !== undefined) proof.push(sibling);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyProof(
  leaf: string,
  proof: readonly string[],
  root: string,
): boolean {
  let h = leaf;
  for (const sib of proof) {
    h = pairHash(h, sib);
  }
  return h === root;
}
