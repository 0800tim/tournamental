import { describe, expect, it } from "vitest";
import { Storage, type TgUser } from "../src/storage.js";
import { dayKey, shouldSendPush } from "../src/rate-limit.js";

function makeUser(overrides: Partial<TgUser> = {}): TgUser {
  return {
    chat_id: 1,
    user_id: "u_1",
    tz: "Pacific/Auckland",
    notify_market_move: 1,
    notify_kickoff: 1,
    notify_goal: 1,
    notify_affiliate: 0,
    notify_match_day: 0,
    quiet_start: "22:00",
    quiet_end: "08:00",
    last_push_at: null,
    push_count_today: 0,
    push_count_day: null,
    country_code: "NZ",
    language_code: "en",
    created_at: 0,
    ...overrides,
  };
}

// Pacific/Auckland in May is UTC+12 (no DST).
function aucklandWallclock(hour: number, minute = 0): Date {
  // 1 May 2026 (NZST = UTC+12). 02:00 UTC = 14:00 NZST same day.
  const utc = Date.UTC(2026, 4, 1, hour - 12, minute);
  return new Date(utc);
}

describe("rate-limit.shouldSendPush", () => {
  it("allows market_move during waking hours within cap", () => {
    const u = makeUser({ push_count_today: 0 });
    const r = shouldSendPush({
      user: u,
      category: "market_move",
      now: aucklandWallclock(14),
      in_match_window: false,
    });
    expect(r.allow).toBe(true);
  });

  it("blocks market_move during quiet hours (22:00–08:00 default)", () => {
    const u = makeUser();
    const r = shouldSendPush({
      user: u,
      category: "market_move",
      now: aucklandWallclock(23),
      in_match_window: false,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("quiet_hours");
  });

  it("blocks market_move just after midnight (still in quiet block)", () => {
    const u = makeUser();
    const r = shouldSendPush({
      user: u,
      category: "market_move",
      now: aucklandWallclock(3),
      in_match_window: false,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("quiet_hours");
  });

  it("kickoff bypasses quiet hours when in_match_window", () => {
    const u = makeUser();
    const r = shouldSendPush({
      user: u,
      category: "kickoff",
      now: aucklandWallclock(2),
      in_match_window: true,
    });
    expect(r.allow).toBe(true);
  });

  it("goal bypasses quiet hours during match window", () => {
    const u = makeUser();
    const r = shouldSendPush({
      user: u,
      category: "goal",
      now: aucklandWallclock(23, 45),
      in_match_window: true,
    });
    expect(r.allow).toBe(true);
  });

  it("market_move does NOT bypass quiet hours even mid-match", () => {
    const u = makeUser();
    const r = shouldSendPush({
      user: u,
      category: "market_move",
      now: aucklandWallclock(23, 30),
      in_match_window: true,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("quiet_hours");
  });

  it("respects daily cap of 3", () => {
    const u = makeUser({
      push_count_today: 3,
      push_count_day: dayKey(aucklandWallclock(14), "Pacific/Auckland"),
    });
    const r = shouldSendPush({
      user: u,
      category: "market_move",
      now: aucklandWallclock(14),
      in_match_window: false,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("daily_cap_reached");
  });

  it("daily cap resets across day boundary (per user TZ)", () => {
    const u = makeUser({
      push_count_today: 3,
      push_count_day: "2026-04-30",
    });
    const r = shouldSendPush({
      user: u,
      category: "market_move",
      now: aucklandWallclock(14),
      in_match_window: false,
    });
    expect(r.allow).toBe(true);
  });

  it("match-day mode + match window lifts daily cap", () => {
    const u = makeUser({
      notify_match_day: 1,
      push_count_today: 5,
      push_count_day: dayKey(aucklandWallclock(14), "Pacific/Auckland"),
    });
    const r = shouldSendPush({
      user: u,
      category: "goal",
      now: aucklandWallclock(14),
      in_match_window: true,
    });
    expect(r.allow).toBe(true);
  });

  it("match-day mode without match window does NOT lift cap", () => {
    const u = makeUser({
      notify_match_day: 1,
      push_count_today: 3,
      push_count_day: dayKey(aucklandWallclock(14), "Pacific/Auckland"),
    });
    const r = shouldSendPush({
      user: u,
      category: "market_move",
      now: aucklandWallclock(14),
      in_match_window: false,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("daily_cap_reached");
  });

  it("category opt-out blocks even allowed time/cap", () => {
    const u = makeUser({ notify_goal: 0 });
    const r = shouldSendPush({
      user: u,
      category: "goal",
      now: aucklandWallclock(14),
      in_match_window: true,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("category_disabled");
  });

  it("affiliate is opt-out by default", () => {
    const u = makeUser();
    const r = shouldSendPush({
      user: u,
      category: "affiliate",
      now: aucklandWallclock(14),
      in_match_window: false,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("category_disabled");
  });

  it("affiliate works once user opts in (and cap not exhausted)", () => {
    const u = makeUser({ notify_affiliate: 1 });
    const r = shouldSendPush({
      user: u,
      category: "affiliate",
      now: aucklandWallclock(14),
      in_match_window: false,
    });
    expect(r.allow).toBe(true);
  });

  it("dayKey renders local YYYY-MM-DD in user TZ", () => {
    // 2026-05-01 11:00 UTC == 2026-05-01 23:00 NZST (same date) BUT
    // 2026-04-30 13:00 UTC == 2026-05-01 01:00 NZST (next date).
    const utc = new Date(Date.UTC(2026, 3, 30, 13, 0));
    expect(dayKey(utc, "Pacific/Auckland")).toBe("2026-05-01");
    expect(dayKey(utc, "UTC")).toBe("2026-04-30");
  });
});

describe("Storage.recordPush + rate-limit interplay", () => {
  it("simulates a 4-push day and confirms cap kicks in on the 4th", () => {
    const s = new Storage(":memory:");
    s.upsertUser({ chat_id: 1, user_id: "u_1" });
    const now = aucklandWallclock(14);
    const day = dayKey(now, "Pacific/Auckland");

    for (let i = 0; i < 3; i++) {
      const u = s.getUser(1)!;
      const r = shouldSendPush({
        user: u,
        category: "market_move",
        now,
        in_match_window: false,
      });
      expect(r.allow).toBe(true);
      s.recordPush(1, now.getTime() + i, day);
    }

    const u = s.getUser(1)!;
    const r4 = shouldSendPush({
      user: u,
      category: "market_move",
      now,
      in_match_window: false,
    });
    expect(r4.allow).toBe(false);
    expect(r4.reason).toBe("daily_cap_reached");
  });
});
