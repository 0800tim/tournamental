/**
 * Tiny deterministic state-token generator. Real impl will use crypto.
 * Keeping it deterministic for v0.1 makes tests stable.
 */

let counter = 0;

export function mintState(prefix = 'st'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/** Test seam — reset the counter. */
export function __resetStateForTests(): void {
  counter = 0;
}
