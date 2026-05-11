/**
 * Lightweight team-form lookup for use anywhere in the web app (the bracket
 * row, match preview cards, etc).
 *
 * Reads the same stub as `app/team/[code]/_lib/team-data.ts` but exposes a
 * trimmed surface, just the W/D/L sequence, so consumers don't need to
 * pull in the full team-detail toolkit.
 *
 * TODO(live-data): replace stub source with the live results feed once
 * wired (see `apps/web/data/team-form.json`).
 */

import teamForm from "../data/team-form.json";

export type FormResult = "W" | "D" | "L";

interface RawFormGame {
  readonly date: string;
  readonly opponent: string;
  readonly home: boolean;
  readonly goals_for: number;
  readonly goals_against: number;
  readonly result: FormResult;
  readonly competition: string;
}

interface FormFile {
  readonly teams: Record<string, RawFormGame[]>;
}

const FORM_BY_CODE: Record<string, RawFormGame[]> = (
  teamForm as unknown as FormFile
).teams;

/**
 * Last-5 W/D/L results for `code`, **most-recent first**. Falls back to an
 * empty array when the team isn't in the stub.
 */
export function recentFormResults(code: string): readonly FormResult[] {
  const games = FORM_BY_CODE[code.toUpperCase()];
  if (!games) return [];
  return games.slice(0, 5).map((g) => g.result);
}
