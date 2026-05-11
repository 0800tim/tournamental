/**
 * Overlay URL codec.
 *
 * URL scheme:
 *   ?overlay=<kind>[,<kind>...] &<param>=<value> ...
 *
 * - Multiple stacked overlays serialise as a comma-separated `overlay`
 *   query param. The leftmost kind is the bottom of the stack (rendered
 *   first), the rightmost is the top.
 * - Each overlay's params are flat keys on the same query string; the
 *   parser hands every non-`overlay` param to *every* frame, but each
 *   overlay component only reads the keys it knows about.
 * - This keeps deep-links short and human-readable: a single overlay
 *   like `team` only needs `?overlay=team&code=NZL`, no nested
 *   bracket-syntax.
 *
 * Limitation: two stacked overlays of the *same kind* with conflicting
 * params can't both encode, we only support one frame per kind in the
 * URL. In practice the bracket UX never stacks two `team` overlays
 * (tapping a second team replaces the first), so this is fine.
 */

import type { OverlayFrame, OverlayKind } from "./types";

/** Known kinds, kept in sync with `types.ts`. */
const KNOWN_KINDS: readonly OverlayKind[] = ["team", "match", "leaderboard-entry"];

function isKnownKind(s: string): s is OverlayKind {
  return (KNOWN_KINDS as readonly string[]).includes(s);
}

/**
 * Parse a URL search-string into an overlay stack. Tolerates leading `?`
 * and unknown kinds (skipped with no error). Order is preserved.
 */
export function parseOverlayUrl(search: string | URLSearchParams): readonly OverlayFrame[] {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const overlay = sp.get("overlay");
  if (!overlay) return [];
  const kinds = overlay
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Build a flat params bag from every other key on the URL.
  const flat: Record<string, string> = {};
  sp.forEach((value, key) => {
    if (key === "overlay") return;
    flat[key] = value;
  });
  const frames: OverlayFrame[] = [];
  for (const k of kinds) {
    if (!isKnownKind(k)) continue;
    frames.push({ kind: k, params: { ...flat } });
  }
  return frames;
}

/**
 * Serialise an overlay stack onto an existing search-string (preserving
 * any non-overlay params that aren't claimed by overlay frames). Returns
 * a string starting with `?` if non-empty, else "".
 *
 * Strategy:
 *   1. Strip every `overlay` key + every key that *exactly matches* one
 *      of the param keys used by the new stack.
 *   2. Re-add `overlay=<kind1,kind2,...>` if the stack is non-empty.
 *   3. Re-add the overlay frames' params (deduped by key, last frame
 *      wins).
 *   4. Re-add anything else (existing non-overlay params untouched).
 */
export function encodeOverlayUrl(
  stack: readonly OverlayFrame[],
  existingSearch: string | URLSearchParams = "",
): string {
  const existing =
    typeof existingSearch === "string"
      ? new URLSearchParams(existingSearch)
      : new URLSearchParams(existingSearch.toString());

  // All keys claimed by the new stack.
  const claimedKeys = new Set<string>();
  for (const f of stack) {
    for (const k of Object.keys(f.params)) claimedKeys.add(k);
  }

  // Drop the old overlay key + any claimed keys.
  const out = new URLSearchParams();
  existing.forEach((value, key) => {
    if (key === "overlay") return;
    if (claimedKeys.has(key)) return;
    out.append(key, value);
  });

  if (stack.length > 0) {
    out.set("overlay", stack.map((f) => f.kind).join(","));
    // Apply each frame's params (later frames override earlier ones).
    for (const f of stack) {
      for (const [k, v] of Object.entries(f.params)) out.set(k, v);
    }
  }

  const s = out.toString();
  return s.length === 0 ? "" : `?${s}`;
}

/**
 * Stack equality, used by the provider to skip no-op history pushes.
 */
export function stacksEqual(
  a: readonly OverlayFrame[],
  b: readonly OverlayFrame[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const aF = a[i]!;
    const bF = b[i]!;
    if (aF.kind !== bF.kind) return false;
    const aKeys = Object.keys(aF.params);
    const bKeys = Object.keys(bF.params);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (aF.params[k] !== bF.params[k]) return false;
    }
  }
  return true;
}
