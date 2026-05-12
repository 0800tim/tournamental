// Unit tests for the hello-producer state machine. Verifies that
// the synthetic match emits a valid MatchInit, advances the clock
// monotonically, and fires scripted events at the right times.
//
// Run: node --test src/index.test.mjs

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { MATCH_INIT, newMatchState, tick, formatClock } from "./index.mjs";

test("MATCH_INIT conforms to the v0.1.1 spec", () => {
  assert.equal(MATCH_INIT.type, "match.init");
  assert.equal(MATCH_INIT.spec_version, "0.1.1");
  assert.equal(MATCH_INIT.teams.length, 2);
  assert.equal(MATCH_INIT.teams[0].code, "HOM");
  assert.equal(MATCH_INIT.teams[1].code, "AWY");
  assert.ok(MATCH_INIT.field.length_m > 0);
  assert.ok(MATCH_INIT.field.width_m > 0);
});

test("tick() advances the match clock monotonically", () => {
  const s = newMatchState();
  const a = tick(s, 1000);
  const b = tick(s, 1000);
  assert.equal(a.frame.t, 1000);
  assert.equal(b.frame.t, 2000);
});

test("tick() emits scripted goal events at the right time", () => {
  const s = newMatchState();
  let totalEvents = [];
  // Jump straight to 12:01 in one big tick.
  const { events } = tick(s, 12 * 60 * 1000 + 1000);
  totalEvents = totalEvents.concat(events);

  const goal = totalEvents.find((e) => e.type === "event.goal");
  assert.ok(goal, "should have emitted an event.goal");
  assert.equal(goal.team, "HOM");
  assert.equal(s.score.home, 1);
  assert.equal(s.score.away, 0);
});

test("formatClock pads correctly", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(45_000), "00:45");
  assert.equal(formatClock(60_000), "01:00");
  assert.equal(formatClock(45 * 60 * 1000), "45:00");
});
