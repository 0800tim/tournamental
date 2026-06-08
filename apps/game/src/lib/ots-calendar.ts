/**
 * OpenTimestamps calendar HTTP client.
 *
 * The OTS protocol is dead simple at the wire level (full spec at
 * https://github.com/opentimestamps/python-opentimestamps and
 * https://petertodd.org/2016/opentimestamps-announcement). For our
 * purposes a "Timestamp" is:
 *
 *   - A starting 32-byte SHA-256 digest of the user data.
 *   - A sequence of cryptographic ops (append / prepend bytes, then
 *     hash with sha256 / ripemd160) that walk the digest toward an
 *     "attestation". The two attestations we care about are:
 *
 *       * Pending calendar attestation: the calendar will eventually
 *         include this digest in a Bitcoin transaction. Present
 *         within ~1s of submission.
 *       * Bitcoin block-header attestation: the digest is committed
 *         in the Merkle root of the named block. Lands once the
 *         calendar has aggregated enough digests and posted a tx,
 *         which is on the order of an hour.
 *
 * Wire protocol per OTS calendar (a.lt.opentimestamps.org etc.):
 *
 *   POST /digest               body = raw 32-byte SHA-256
 *     200 OK, body = binary "Timestamp" ops (no magic header,
 *                           starts at the first op after the input
 *                           digest)
 *
 *   GET  /timestamp/<hex>      hex = lowercase 64-char SHA-256
 *     200 OK, body = the upgraded Timestamp ops (same shape, longer
 *                    once a Bitcoin attestation is appended)
 *     404      = digest not known to this calendar yet (still pending
 *                aggregation; retry later)
 *
 * The `.ots` file format adds a fixed magic header + version byte +
 * a FileHash header that encodes (hash algorithm, original digest)
 * before the ops. We emit that here so the file produced by
 * `serialiseOtsFile()` is byte-compatible with the official
 * `ots verify` CLI.
 *
 * The handwritten approach keeps us off the heavy `bitcore-lib`
 * dependency tree that the `opentimestamps` npm package drags in.
 * For Phase 1 we only need to:
 *   - Submit a root to N calendars
 *   - Persist the calendar-pending blobs
 *   - Poll for upgrades
 *   - Serve the canonical `.ots` file via the verify route
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */

import { setTimeout as delay } from "node:timers/promises";

/** Default public calendar servers (free, no auth). */
export const DEFAULT_CALENDARS: readonly string[] = [
  "https://a.pool.opentimestamps.org",
  "https://b.pool.opentimestamps.org",
  "https://a.pool.eternitywall.com",
  "https://finney.calendar.eternitywall.com",
];

/** OTS file header (magic bytes 31 chars), version 1, SHA-256 hash tag. */
const OTS_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d,
  0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2,
  0xe8, 0x84, 0xe8, 0x92, 0x94,
]);
const OTS_VERSION = 0x01;
/** Op tag for SHA-256 (per python-opentimestamps `ops.py::OpSHA256`). */
const OP_SHA256_TAG = 0x08;

export interface CalendarSubmissionResult {
  readonly calendar_url: string;
  /** Raw bytes returned by POST /digest. Pending calendar attestation
   *  is encoded inside; no upgrade yet. */
  readonly pending_bytes: Uint8Array;
  readonly submitted_at: number;
}

export interface CalendarUpgradeResult {
  readonly calendar_url: string;
  readonly upgraded_bytes: Uint8Array;
  readonly upgraded_at: number;
  /** True iff the bytes contain a Bitcoin block attestation (heuristic
   *  match on the `0x05` BTC block attestation tag). */
  readonly bitcoin_confirmed: boolean;
}

export interface SubmitOptions {
  /** Override the default calendar set. */
  readonly calendars?: readonly string[];
  /** Per-request timeout in ms. Default 10s. */
  readonly timeoutMs?: number;
  /** Override fetch (used by tests). */
  readonly fetchImpl?: typeof fetch;
}

export interface UpgradeOptions {
  readonly calendar_url: string;
  readonly digest_hex: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** OTS calendars sometimes redirect or block clients without a UA. */
const USER_AGENT = "tournamental-ots/0.1 (+https://tournamental.com)";

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hex string has odd length: ${hex.length}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

/**
 * POST a digest to a single calendar. Returns the pending-attestation
 * bytes the calendar sends back. Throws on non-2xx responses; caller
 * decides how to handle multi-calendar fallback.
 */
export async function submitDigest(
  calendarUrl: string,
  digest: Uint8Array,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<CalendarSubmissionResult> {
  if (digest.byteLength !== 32) {
    throw new Error(`digest must be 32 bytes, got ${digest.byteLength}`);
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Use a fresh ArrayBuffer copy to avoid passing a TypedArray view
    // backed by a Node Buffer (which fetch doesn't always serialise
    // cleanly across implementations).
    const body = new Uint8Array(digest.byteLength);
    body.set(digest);
    const res = await fetchImpl(`${calendarUrl.replace(/\/$/, "")}/digest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "User-Agent": USER_AGENT,
        Accept: "application/vnd.opentimestamps.v1",
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `calendar ${calendarUrl} returned HTTP ${res.status} ${res.statusText}`,
      );
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      calendar_url: calendarUrl,
      pending_bytes: buf,
      submitted_at: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Submit a digest to every calendar in parallel. Returns one row per
 * successful calendar; failures land in `errors`. Caller decides on
 * the required quorum (typically 3 of 4 for Phase 1).
 */
export async function submitToCalendars(
  digest: Uint8Array,
  opts: SubmitOptions = {},
): Promise<{
  successes: CalendarSubmissionResult[];
  errors: Array<{ calendar_url: string; message: string }>;
}> {
  const calendars = opts.calendars ?? DEFAULT_CALENDARS;
  const successes: CalendarSubmissionResult[] = [];
  const errors: Array<{ calendar_url: string; message: string }> = [];
  await Promise.all(
    calendars.map(async (url) => {
      try {
        const result = await submitDigest(url, digest, {
          timeoutMs: opts.timeoutMs,
          fetchImpl: opts.fetchImpl,
        });
        successes.push(result);
      } catch (err) {
        errors.push({
          calendar_url: url,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
  return { successes, errors };
}

/**
 * GET the upgraded timestamp from a calendar. Returns null if the
 * calendar reports the digest is not yet ready (HTTP 404 / 405).
 */
export async function fetchUpgrade(
  opts: UpgradeOptions,
): Promise<CalendarUpgradeResult | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${opts.calendar_url.replace(/\/$/, "")}/timestamp/${opts.digest_hex.toLowerCase()}`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/vnd.opentimestamps.v1",
      },
      signal: controller.signal,
    });
    if (res.status === 404 || res.status === 405) return null;
    if (!res.ok) {
      throw new Error(
        `calendar ${opts.calendar_url} returned HTTP ${res.status} ${res.statusText}`,
      );
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      calendar_url: opts.calendar_url,
      upgraded_bytes: buf,
      upgraded_at: Date.now(),
      bitcoin_confirmed: containsBitcoinAttestation(buf),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Heuristic Bitcoin-attestation detector. The python-opentimestamps
 * library serialises a Bitcoin block-header attestation as:
 *
 *   tag (1 byte 0x00) + magic_bytes (8 bytes) + payload
 *
 * where the magic for BitcoinBlockHeaderAttestation is the constant
 * defined at python-opentimestamps `notary.py::BitcoinBlockHeaderAttestation`:
 *
 *   b'\x05\x88\x96\x0d\x73\xd7\x19\x01'
 *
 * Rather than parse the full Timestamp tree (the binary format is a
 * variable-length op DAG), we scan the response for this magic.
 * Performance is fine: the upgraded bytes are typically < 500 bytes.
 */
const BTC_ATTESTATION_MAGIC = new Uint8Array([
  0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
]);

export function containsBitcoinAttestation(bytes: Uint8Array): boolean {
  if (bytes.byteLength < BTC_ATTESTATION_MAGIC.byteLength) return false;
  outer: for (let i = 0; i <= bytes.byteLength - BTC_ATTESTATION_MAGIC.byteLength; i++) {
    for (let j = 0; j < BTC_ATTESTATION_MAGIC.byteLength; j++) {
      if (bytes[i + j] !== BTC_ATTESTATION_MAGIC[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Build a v1 `.ots` proof file from a pending or upgraded timestamp.
 *
 * Format (binary, big-endian):
 *
 *   magic (31 bytes) || version (1 byte) || file_hash_tag (1 byte 0x08
 *   for sha256) || digest (32 bytes) || ops (variable; calendar bytes)
 *
 * The bytes returned by `submitDigest` / `fetchUpgrade` already start
 * with the op sequence; we just prepend the magic + version + FileHash
 * header. This produces a file `ots info` and `ots verify` recognise.
 */
export function serialiseOtsFile(args: {
  digest: Uint8Array;
  timestamp_bytes: Uint8Array;
}): Uint8Array {
  if (args.digest.byteLength !== 32) {
    throw new Error(`digest must be 32 bytes, got ${args.digest.byteLength}`);
  }
  return concat([
    OTS_MAGIC,
    new Uint8Array([OTS_VERSION, OP_SHA256_TAG]),
    args.digest,
    args.timestamp_bytes,
  ]);
}

/**
 * Convenience: combine multiple calendars' timestamp bytes into a
 * single `.ots` file. The OTS Timestamp binary format supports a
 * "fork" op that lets one input digest carry attestations from
 * multiple calendars, but the safe minimal-viable approach for Phase 1
 * is to emit ONE `.ots` per calendar source and let the verifier pick
 * whichever it trusts. We expose the multi-calendar surface via the
 * /v1/swarm/proof route, which returns metadata + per-calendar files.
 *
 * For convenience the function also exposes the digest hex so callers
 * can reference the canonical filename `<digest>.ots`.
 */
export interface BuiltOtsFile {
  readonly digest_hex: string;
  readonly calendar_url: string;
  readonly bytes: Uint8Array;
  readonly bitcoin_confirmed: boolean;
}

export function buildOtsFile(args: {
  digest: Uint8Array;
  calendar_url: string;
  timestamp_bytes: Uint8Array;
}): BuiltOtsFile {
  return {
    digest_hex: bytesToHex(args.digest),
    calendar_url: args.calendar_url,
    bytes: serialiseOtsFile({
      digest: args.digest,
      timestamp_bytes: args.timestamp_bytes,
    }),
    bitcoin_confirmed: containsBitcoinAttestation(args.timestamp_bytes),
  };
}

export { hexToBytes, bytesToHex, concat };

/**
 * Tiny polling helper used by the scheduler. Re-tries `fn` every
 * `intervalMs` until it returns a truthy value or `until` is reached.
 * The OTS server-side scheduler uses this to spin on each pending
 * calendar until an upgraded proof comes back or we give up.
 */
/**
 * Build a `postOts(root)` hook compatible with
 * `services/kickoff-commit.ts`. The hook:
 *
 *   1. Converts the hex root to a 32-byte digest.
 *   2. Submits it to every calendar in parallel.
 *   3. Resolves once at least `quorum` calendars ack (default 1).
 *   4. Calls `onPending(pending)` with the raw pending blobs so the
 *      caller can persist them for later upgrade.
 *
 * The hook never throws on calendar errors — the kickoff commitment
 * is "best effort" against the OTS pool. Persistent failures are
 * surfaced via `onPending([])` so the caller can flag them in the
 * audit log.
 */
export interface OtsPostOpts {
  readonly calendars?: readonly string[];
  readonly quorum?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onPending?: (
    blobs: ReadonlyArray<{
      calendar_url: string;
      pending_bytes_hex: string;
      submitted_at: number;
    }>,
  ) => void | Promise<void>;
}

export function buildOtsPostHook(
  opts: OtsPostOpts = {},
): (rootHex: string) => Promise<void> {
  const calendars = opts.calendars ?? DEFAULT_CALENDARS;
  const quorum = opts.quorum ?? 1;
  return async (rootHex: string) => {
    let digest: Uint8Array;
    try {
      digest = hexToBytes(rootHex);
    } catch {
      // Bad input — treat as a no-op so the kickoff job keeps moving.
      if (opts.onPending) await opts.onPending([]);
      return;
    }
    if (digest.byteLength !== 32) {
      if (opts.onPending) await opts.onPending([]);
      return;
    }
    const { successes } = await submitToCalendars(digest, {
      calendars,
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
    });
    const blobs = successes.map((s) => ({
      calendar_url: s.calendar_url,
      pending_bytes_hex: bytesToHex(s.pending_bytes),
      submitted_at: s.submitted_at,
    }));
    // Below-quorum is logged via onPending; the kickoff job itself
    // does not throw because the merkle root + pending blobs are
    // still good evidence and can be retried later by the scheduler.
    if (blobs.length < quorum) {
      if (opts.onPending) await opts.onPending(blobs);
      return;
    }
    if (opts.onPending) await opts.onPending(blobs);
  };
}

export async function pollUntil<T>(
  fn: () => Promise<T | null>,
  args: { intervalMs: number; untilMs: number; nowFn?: () => number },
): Promise<T | null> {
  const now = args.nowFn ?? Date.now;
  while (now() < args.untilMs) {
    const v = await fn();
    if (v !== null) return v;
    await delay(args.intervalMs);
  }
  return null;
}
