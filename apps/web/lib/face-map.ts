/**
 * Face URL map: looks up a player's portrait image by name.
 *
 * The renderer's spec stream uses synthetic player ids (e.g. `ARG_10`,
 * `FRA_10`) while the Wikidata-derived CSV uses StatsBomb player ids
 * (e.g. `5503`, `3009`). The two id spaces don't share keys, so we
 * resolve face URLs by *name match* with case-folding and accent
 * stripping.
 *
 * Single small CSV (~22 rows) so we just walk it linearly. The CSV is
 * served from `/data/wc2022-final-players.csv` (copied at scene mount
 * from the statsbomb-replay package, see
 * `apps/web/scripts/copy-player-csv.mjs`).
 */
import type { Player } from "@vtorn/spec";

export interface FaceCsvRow {
  player_id: string;
  name: string;
  number: number;
  country: string;
  image_url: string;
  attribution?: string;
}

const FOLD_REGEX = /[̀-ͯ]/g;

/**
 * Normalise a name for fuzzy match: NFD-decompose accents, drop combining
 * marks, lower-case, collapse whitespace. "Ángel Di María" → "angel di maria".
 */
export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(FOLD_REGEX, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a CSV file (header row + body) into typed rows. Handles plain
 * comma-separated values; the wc2022 CSV does not use quoted fields, so
 * we keep the parser deliberately simple.
 */
export function parseFaceCsv(text: string): FaceCsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const rows: FaceCsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const r: Record<string, string> = {};
    header.forEach((h, j) => {
      r[h] = cells[j] ?? "";
    });
    rows.push({
      player_id: r.player_id ?? "",
      name: r.name ?? "",
      number: Number(r.number ?? 0),
      country: r.country ?? "",
      image_url: r.image_url ?? "",
      attribution: r.attribution,
    });
  }
  return rows;
}

/** Minimal CSV cell splitter: handles unquoted comma-separated rows. */
function splitCsvLine(line: string): string[] {
  return line.split(",").map((c) => c.trim());
}

export interface FaceLookupOptions {
  /** Optional country filter to disambiguate when names collide across teams. */
  country?: string;
}

/**
 * Build a lookup that resolves a `Player` to a face URL. Match strategy:
 *   1. Exact normalised-name match.
 *   2. Last-name match (only if unambiguous within the row set).
 *
 * Players with no match resolve to `undefined`, the renderer falls back
 * to a `<BillboardFace>` initials disc per docs/07.
 */
export function buildFaceLookup(rows: FaceCsvRow[]): (player: Player) => string | undefined {
  const byFullName = new Map<string, FaceCsvRow>();
  const byLastName = new Map<string, FaceCsvRow[]>();
  for (const row of rows) {
    const norm = normaliseName(row.name);
    byFullName.set(norm, row);
    const parts = norm.split(" ");
    const last = parts[parts.length - 1];
    if (last) {
      const list = byLastName.get(last) ?? [];
      list.push(row);
      byLastName.set(last, list);
    }
  }

  return (player) => {
    const normPlayer = normaliseName(player.name);
    // Exact match first.
    const exact = byFullName.get(normPlayer);
    if (exact) return exact.image_url;

    // Then try CSV row whose normalised full-name CONTAINS the player's
    // full normalised name (handles "Messi" vs "Lionel Messi"). Also
    // accepts the reverse, CSV's full-name fully contains the player
    // name's last token (handles "E. Martínez" → "Damián Emiliano Martínez").
    for (const row of rows) {
      const normRow = normaliseName(row.name);
      if (normRow.includes(normPlayer) || normPlayer.includes(normRow)) {
        return row.image_url;
      }
    }

    // Last-name match: split player name on whitespace, take last token,
    // look for a CSV row whose last token matches uniquely.
    const tokens = normPlayer.split(" ").filter(Boolean);
    if (tokens.length > 0) {
      const last = tokens[tokens.length - 1];
      const candidates = byLastName.get(last);
      if (candidates && candidates.length === 1) return candidates[0].image_url;
    }

    return undefined;
  };
}

/** Convenience: typed map keyed by spec player id, eagerly resolved. */
export type PlayerIdToFaceUrl = Record<string, string | undefined>;

export function indexFacesByPlayerId(
  players: Player[],
  rows: FaceCsvRow[],
): PlayerIdToFaceUrl {
  const lookup = buildFaceLookup(rows);
  const out: PlayerIdToFaceUrl = {};
  for (const p of players) out[p.id] = lookup(p);
  return out;
}
