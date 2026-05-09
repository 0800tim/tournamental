/**
 * Deterministic, content-addressable clip IDs.
 *
 * Two requests with byte-identical inputs MUST produce the same clip_id.
 * Two requests differing in any input field (match, window, format, overlay,
 * src) MUST produce different IDs. SHA-256 over a canonical JSON string,
 * truncated to 16 hex chars (64 bits) — collision probability is vanishing
 * at our scale and the short form fits cleanly in URLs.
 */

import { createHash } from "node:crypto";

import type { ClipRequest } from "./types.js";

export function clipIdFor(req: ClipRequest): string {
  const canonical = canonicalize({
    match_id: req.match_id,
    start_ms: req.start_ms,
    end_ms: req.end_ms,
    format: req.format,
    overlay: req.overlay ?? null,
    src: req.src ?? null,
  });
  const hex = createHash("sha256").update(canonical).digest("hex");
  return `clip_${hex.slice(0, 16)}`;
}

/**
 * Canonical JSON: keys sorted recursively so the hash is stable regardless
 * of the order the caller assembled the object.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}
