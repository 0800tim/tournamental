/**
 * Freeze `Date` before the tournament for component tests.
 *
 * The bracket builder and the match rows read the real clock to decide
 * whether a match has kicked off (lock chips, "In progress", disabled
 * picks). Tests written while FWC 2026 was in the future started
 * failing once the real date passed the first kickoff. Call
 * `pinClockBeforeTournament()` at the top of a describe block to pin
 * `Date.now()` to 1 May 2026 UTC for every test in that file.
 *
 * Only `Date` is faked, so `setTimeout`, `waitFor` and promises keep
 * running on the real event loop.
 */
import { afterAll, beforeAll, vi } from "vitest";

export const PRE_TOURNAMENT_NOW = Date.UTC(2026, 4, 1, 0, 0, 0);

export function pinClockBeforeTournament(now: number = PRE_TOURNAMENT_NOW): void {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now });
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}
