/**
 * Pre-rendered commentary track, pure logic.
 *
 * Per `docs/27c-fidelity-phase3-stadium-crowd.md` § "Pre-rendered
 * MP3s":
 *   - Load JSON manifest at `data/commentary/<match>/manifest.json`.
 *   - For each line `Lxxxx`, fetch
 *     `/audio/commentary/{lang}/Lxxxx.mp3`.
 *   - Schedule playback via the audio mixer keyed on `t_ms` in the
 *     timeline.
 *   - On scrub, find the nearest line and resync.
 *
 * Manifest shape (Phase-3 stub, not yet authored for the AR-FR final):
 *
 *   { "match": "...", "lang": "en", "lines": [
 *     { "id": "L0001", "t_ms": 0, "duration_ms": 4000, "text": "..." },
 *     { "id": "L0002", "t_ms": 4500, "duration_ms": 3500, "text": "..." }
 *   ] }
 */

export interface CommentaryLine {
  id: string;
  /** Start time in match-clock ms. */
  t_ms: number;
  /** Duration of the spoken line. */
  duration_ms: number;
  text: string;
}

export interface CommentaryManifest {
  match: string;
  lang: string;
  lines: CommentaryLine[];
}

/**
 * Find the line that should be playing at `tMs`, or the nearest
 * upcoming line if none is currently active.
 *
 * Returns:
 *   - `{ kind: "active", line }`  , line is currently playing
 *   - `{ kind: "next", line }`    , no active, next line is in the future
 *   - `{ kind: "after-end" }`     , past the last line
 *   - `{ kind: "before-start", line }`, first line is in the future
 */
export type ScheduleResult =
  | { kind: "active"; line: CommentaryLine }
  | { kind: "next"; line: CommentaryLine }
  | { kind: "after-end" }
  | { kind: "before-start"; line: CommentaryLine };

export function lineAt(
  manifest: CommentaryManifest,
  tMs: number,
): ScheduleResult {
  const lines = manifest.lines;
  if (lines.length === 0) return { kind: "after-end" };
  if (tMs < lines[0].t_ms) return { kind: "before-start", line: lines[0] };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (tMs >= l.t_ms && tMs < l.t_ms + l.duration_ms) {
      return { kind: "active", line: l };
    }
    if (tMs < l.t_ms) return { kind: "next", line: l };
  }
  return { kind: "after-end" };
}

/**
 * On scrub: find the line nearest the new clock time. Used by the
 * `<TimelineScrubber />` integration.
 */
export function nearestLine(
  manifest: CommentaryManifest,
  tMs: number,
): CommentaryLine | null {
  const lines = manifest.lines;
  if (lines.length === 0) return null;
  let best = lines[0];
  let bestDist = Math.abs(best.t_ms - tMs);
  for (let i = 1; i < lines.length; i++) {
    const d = Math.abs(lines[i].t_ms - tMs);
    if (d < bestDist) {
      best = lines[i];
      bestDist = d;
    }
  }
  return best;
}

/**
 * URL helper, constructs the CDN URL for a single line's MP3.
 * Hashed-filename caching: the line id is a content-hash so the
 * `Cache-Control: max-age=31536000, immutable` header on the CDN
 * is safe.
 */
export function audioUrlForLine(
  matchId: string,
  lang: string,
  lineId: string,
): string {
  return `/audio/commentary/${matchId}/${encodeURIComponent(lang)}/${encodeURIComponent(lineId)}.mp3`;
}

/**
 * Fetch the manifest JSON. The route may be missing (Phase-3 stub
 * mode), in that case we synthesise a silent, empty manifest so
 * the renderer mounts cleanly.
 */
export async function loadManifest(
  matchId: string,
  lang: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CommentaryManifest> {
  const url = `/api/commentary/manifest/${encodeURIComponent(matchId)}/${encodeURIComponent(lang)}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`manifest fetch ${res.status}`);
    return (await res.json()) as CommentaryManifest;
  } catch {
    return { match: matchId, lang, lines: [] };
  }
}
