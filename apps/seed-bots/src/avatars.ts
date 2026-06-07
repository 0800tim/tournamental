/**
 * Avatar picker.
 *
 * Three pools per spec §4.2:
 *   - 33% AI-generated faces from the vendored set at `data/avatars/faces/`
 *   - 33% Dicebear-style SVG generated at runtime from the handle hash
 *   - 34% initials fallback (same component humans use)
 *
 * v0.1 ships URL pointers only; the renderer dereferences. The faces
 * directory is a placeholder in this PR (Tim populates the 6k synthetic
 * face set separately so the source files are not in the seed PR diff).
 */

import { createHash } from "node:crypto";

import { makeRng, rngWeightedIndex } from "./rng.js";

export type AvatarKind = "face" | "dicebear" | "initials";

export interface AvatarSpec {
  readonly kind: AvatarKind;
  /** Resolved URL the leaderboard / profile component renders. */
  readonly url: string;
}

const POOL_WEIGHTS: readonly number[] = [33, 33, 34];
const POOLS: readonly AvatarKind[] = ["face", "dicebear", "initials"];

/**
 * Synthetic face set size. Faces are named `face-0001.webp` ... up to
 * the cap. The renderer rounds up to the next 1-indexed integer.
 * Vendored set is 6,000 images per spec; in this PR the directory is a
 * placeholder, so callers must treat the URL as "future-resolvable".
 */
const FACES_POOL_SIZE = 6000;

export function pickAvatar(args: {
  masterSeed: string;
  index: number;
  handle: string;
}): AvatarSpec {
  const { masterSeed, index, handle } = args;
  const rng = makeRng(`${masterSeed}:avatar:pool:${index}`);
  const poolIdx = rngWeightedIndex(rng, POOL_WEIGHTS);
  const kind = POOLS[poolIdx] ?? "initials";

  if (kind === "face") {
    // Deterministic face id from the bot index.
    const rngFace = makeRng(`${masterSeed}:avatar:face:${index}`);
    const faceId = (Math.floor(rngFace() * FACES_POOL_SIZE) + 1)
      .toString()
      .padStart(4, "0");
    return {
      kind,
      url: `/avatars/faces/face-${faceId}.webp`,
    };
  }

  if (kind === "dicebear") {
    // Dicebear thumbs-style URL. The seed is the handle hash so two
    // bots with the same handle would (impossibly) collide on the same
    // SVG; in practice handles are unique per bot.
    const seedHash = createHash("sha256")
      .update(handle)
      .digest("hex")
      .slice(0, 16);
    return {
      kind,
      url: `https://api.dicebear.com/9.x/thumbs/svg?seed=${seedHash}`,
    };
  }

  // Initials fallback uses our own component path; the renderer renders
  // a coloured circle with the first letter of the display name. We
  // emit a sentinel URL the leaderboard component already understands.
  return { kind: "initials", url: `tnm-initials://${handle}` };
}
