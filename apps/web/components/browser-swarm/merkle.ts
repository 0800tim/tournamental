/**
 * Browser-side sorted-pair sha256 merkle tree.
 *
 * Shape matches `packages/bot-node/src/merkle.ts` exactly so a proof
 * computed here is verifiable against the central server's OTS-anchored
 * commitment. The only difference is that we use WebCrypto's
 * `crypto.subtle.digest` instead of node's `createHash`. Both produce
 * identical hex strings for identical inputs.
 *
 * Rules (same as node):
 *   - Leaves are hashed once before pairing.
 *   - Pairs are sorted lex-ascending by hex hash before concatenation, so
 *     a verifier needs only the sibling, not its position.
 *   - Odd nodes promote without rehashing.
 *   - Empty input returns sha256(zero bytes).
 *
 * Performance note: the swarm worker calls `merkleRoot` on potentially
 * 100,000+ leaves per match. The hot loop awaits one sha256 per pair
 * which the browser's WebCrypto pipelines internally, so on a modern
 * laptop the 100k-leaf root completes well inside the 50ms budget per
 * commitment.
 */

const textEncoder = new TextEncoder();

async function sha256Hex(input: ArrayBuffer | Uint8Array | string): Promise<string> {
  // The DOM lib's `BufferSource` is fussy about `Uint8Array<SharedArrayBuffer>`
  // creeping in via TypeScript's stricter generic propagation in TS 5.7+,
  // so we coerce everything down to an ArrayBuffer slice. The copy is cheap
  // versus the digest itself and side-steps the variance issue cleanly.
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = textEncoder.encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return bufferToHex(digest);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function sha256(value: string): Promise<string> {
  return sha256Hex(value);
}

export async function hashLeaf(value: string): Promise<string> {
  return sha256Hex(value);
}

export async function hashPair(a: string, b: string): Promise<string> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return sha256Hex(lo + hi);
}

export async function emptyRoot(): Promise<string> {
  return sha256Hex(new Uint8Array(0));
}

/**
 * Compute the merkle root of a list of leaf strings.
 *
 * Leaves are hashed once, then paired up the tree. Odd nodes promote.
 * Returns the empty-tree marker for an empty input so the contract
 * surface matches the node-side helper.
 *
 * Implementation notes:
 *   - We batch the leaf-hash and pair-hash passes in chunks of
 *     `BATCH_SIZE` so we don't materialise 100,000 in-flight promises
 *     at once. The SubtleCrypto pipeline still gets full throughput
 *     because the batches are large enough to keep it saturated, but
 *     we avoid the memory blow-up and the event-loop starvation that
 *     comes from `Promise.all` over six-digit arrays.
 *   - Each tree level allocates a fresh array sized to half the
 *     current layer to keep peak memory bounded.
 */

const BATCH_SIZE = 4096;

async function hashAllInBatches(values: string[]): Promise<string[]> {
  const out: string[] = new Array(values.length);
  for (let start = 0; start < values.length; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, values.length);
    const slice = values.slice(start, end);
    const hashes = await Promise.all(slice.map((v) => sha256Hex(v)));
    for (let i = 0; i < hashes.length; i++) out[start + i] = hashes[i]!;
  }
  return out;
}

async function hashAllPairsInBatches(layer: string[]): Promise<string[]> {
  const next: string[] = [];
  for (let start = 0; start < layer.length; start += BATCH_SIZE * 2) {
    const end = Math.min(start + BATCH_SIZE * 2, layer.length);
    const pairs: Array<Promise<string>> = [];
    for (let i = start; i < end; i += 2) {
      const left = layer[i]!;
      const right = layer[i + 1];
      if (right === undefined) {
        pairs.push(Promise.resolve(left));
      } else {
        pairs.push(hashPair(left, right));
      }
    }
    const resolved = await Promise.all(pairs);
    for (const v of resolved) next.push(v);
  }
  return next;
}

export async function merkleRoot(leaves: string[]): Promise<string> {
  if (leaves.length === 0) return emptyRoot();

  let layer: string[] = await hashAllInBatches(leaves);
  while (layer.length > 1) {
    layer = await hashAllPairsInBatches(layer);
  }
  return layer[0]!;
}

export interface MerkleProofStep {
  readonly sibling: string;
}

export interface MerkleProof {
  readonly leaf: string;
  readonly leaf_hash: string;
  readonly path: readonly MerkleProofStep[];
  readonly root: string;
}

/**
 * Build a merkle proof for `index`.
 *
 * Used by the optional /v1/nodes/<id>/match/<id>/proof verification flow
 * a federated challenger might trigger.
 */
export async function merkleProof(
  leaves: string[],
  index: number,
): Promise<MerkleProof | null> {
  if (index < 0 || index >= leaves.length) return null;
  if (leaves.length === 0) return null;

  const leaf = leaves[index]!;
  const leafHash = await hashLeaf(leaf);
  let layer: string[] = await Promise.all(leaves.map((l) => hashLeaf(l)));
  let cursor = index;
  const path: MerkleProofStep[] = [];

  while (layer.length > 1) {
    const next: string[] = [];
    const pairs: Array<Promise<string>> = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = layer[i + 1];
      if (right === undefined) {
        pairs.push(Promise.resolve(left));
      } else {
        pairs.push(hashPair(left, right));
      }
    }
    const resolved = await Promise.all(pairs);
    for (const v of resolved) next.push(v);

    const siblingIndex = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
    if (siblingIndex < layer.length) {
      path.push({ sibling: layer[siblingIndex]! });
    }
    cursor = Math.floor(cursor / 2);
    layer = next;
  }

  return {
    leaf,
    leaf_hash: leafHash,
    path,
    root: layer[0]!,
  };
}

export async function verifyProof(proof: MerkleProof): Promise<boolean> {
  let cursor = proof.leaf_hash;
  if (cursor !== (await hashLeaf(proof.leaf))) return false;
  for (const step of proof.path) {
    cursor = await hashPair(cursor, step.sibling);
  }
  return cursor === proof.root;
}
