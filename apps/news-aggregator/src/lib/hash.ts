/**
 * Stable id derivation. We hash (source-id + canonical-url) into a
 * short hex string. Implementation: FNV-1a 32-bit, encoded as 8 hex
 * chars. Not cryptographic — collision-resistance only needs to be
 * "good enough" across at most a few thousand items.
 */
export function stableId(sourceId: string, url: string): string {
  const canonical = canonicalUrl(url);
  const input = `${sourceId}::${canonical}`;
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned for hex
  const unsigned = hash >>> 0;
  return `${sourceId}-${unsigned.toString(16).padStart(8, '0')}`;
}

/**
 * Strip well-known tracking params and trailing slashes so two URLs
 * that point at the same article hash to the same id even when one
 * carries `?utm_*=...`.
 */
export function canonicalUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const drop = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
      'CMP',
      'cmp',
      'ref',
      'ref_src',
    ]);
    for (const k of [...u.searchParams.keys()]) {
      if (drop.has(k)) u.searchParams.delete(k);
    }
    // Lowercase host; preserve path case (some publishers are case-sensitive).
    u.hostname = u.hostname.toLowerCase();
    // Trim trailing slash unless the path is just "/".
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    u.hash = '';
    return u.toString();
  } catch {
    return rawUrl;
  }
}
