/**
 * Stable match-id helpers for both group fixtures and knockout fixtures.
 *
 * Group fixtures use `match_no` (1..72) stringified; knockout fixtures
 * use the engine's existing `id` (e.g. "r32_03", "final"). Keeping these
 * as plain strings means the bracket prediction map is JSON-friendly.
 */

import type { GroupFixture, KnockoutFixture } from "@tournamental/bracket-engine";

export function groupMatchId(f: GroupFixture): string {
  return String(f.match_no);
}

export function knockoutMatchId(f: KnockoutFixture): string {
  return f.id;
}
