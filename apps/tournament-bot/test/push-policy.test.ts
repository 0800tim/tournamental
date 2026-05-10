import { describe, expect, it } from "vitest";
import { makeHarness } from "./helpers.js";
import { sendMarketMovePush } from "../src/push/market-move.js";
import { sendLockMultExpiryPush } from "../src/push/lock-mult-expiry.js";
import { sendKickoffPush } from "../src/push/kickoff.js";
import { sendGoalPush } from "../src/push/goal.js";
import {
  DEFAULT_AFFILIATE_CONFIG,
  sendAffiliateCtaPush,
} from "../src/push/affiliate-cta.js";

function aucklandWallclock(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 4, 1, hour - 12, minute));
}

describe("market-move push", () => {
  it("sends when the user is paired and within policy", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });

    const r = await sendMarketMovePush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        team_name: "Argentina",
        old_pp: 0.42,
        new_pp: 0.34,
      },
      aucklandWallclock(14),
    );
    expect(r.sent).toBe(true);
    const last = h.calls[h.calls.length - 1];
    expect(last.method).toBe("sendMessage");
    expect(String(last.payload.text)).toContain("Argentina");
    expect(String(last.payload.text)).toContain("dropped");
    expect(String(last.payload.text)).toContain("42%");
    expect(String(last.payload.text)).toContain("34%");
  });

  it("noop when no telegram-link exists for that user_id", async () => {
    const h = makeHarness();
    const r = await sendMarketMovePush(h.bot, h.storage, {
      user_id: "u_ghost",
      team_name: "Argentina",
      old_pp: 0.42,
      new_pp: 0.34,
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("no_telegram_link");
    expect(h.calls).toHaveLength(0);
  });

  it("blocked by quiet hours", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    const r = await sendMarketMovePush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        team_name: "Argentina",
        old_pp: 0.4,
        new_pp: 0.3,
      },
      aucklandWallclock(2),
    );
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("quiet_hours");
  });

  it("market-move says climbed when prob increases", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    await sendMarketMovePush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        team_name: "France",
        old_pp: 0.3,
        new_pp: 0.4,
      },
      aucklandWallclock(14),
    );
    const last = h.calls[h.calls.length - 1];
    expect(String(last.payload.text)).toContain("climbed");
    expect(String(last.payload.text)).toContain("Doubling down");
  });

  it("increments push counters in storage on send", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    await sendMarketMovePush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        team_name: "ARG",
        old_pp: 0.4,
        new_pp: 0.3,
      },
      aucklandWallclock(14),
    );
    expect(h.storage.getUser(100)?.push_count_today).toBe(1);
  });
});

describe("lock-mult-expiry push", () => {
  it("sends and includes hours-until-drop", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    const r = await sendLockMultExpiryPush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        team_name: "Senegal",
        current_mult: 3.5,
        hours_until_drop: 24,
      },
      aucklandWallclock(14),
    );
    expect(r.sent).toBe(true);
    const last = h.calls[h.calls.length - 1];
    expect(String(last.payload.text)).toContain("Senegal");
    expect(String(last.payload.text)).toContain("3.5×");
    expect(String(last.payload.text)).toContain("24h");
  });
});

describe("kickoff push", () => {
  it("sends inside quiet hours when in_match_window", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    const r = await sendKickoffPush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        match_label: "ARG vs FRA",
        user_pick: "Argentina to win",
        kickoff_iso: "2026-06-01T20:00:00Z",
        match_id: "wc-arg-fra-2026",
      },
      aucklandWallclock(2),
    );
    expect(r.sent).toBe(true);
    const last = h.calls[h.calls.length - 1];
    expect(String(last.payload.text)).toContain("ARG vs FRA");
    expect(String(last.payload.text)).toContain("Argentina to win");
  });

  it("respects category opt-out", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    h.storage.setNotifyPref(100, "kickoff", false);
    const r = await sendKickoffPush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        match_label: "ARG vs FRA",
        user_pick: null,
        kickoff_iso: "2026-06-01T20:00:00Z",
        match_id: "wc-arg-fra-2026",
      },
      aucklandWallclock(14),
    );
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("category_disabled");
  });
});

describe("goal push", () => {
  it("includes the bracket signal when winning", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    await sendGoalPush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        team_name: "Argentina",
        scoreline: "ARG 2 - 0 FRA",
        match_id: "wc-arg-fra-2026",
        bracket_signal: "your_pick_winning",
      },
      aucklandWallclock(14),
    );
    const last = h.calls[h.calls.length - 1];
    expect(String(last.payload.text)).toContain("just scored");
    expect(String(last.payload.text)).toContain("looking good");
  });

  it("includes the trouble signal when losing", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    await sendGoalPush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        team_name: "France",
        scoreline: "ARG 0 - 1 FRA",
        match_id: "wc-arg-fra-2026",
        bracket_signal: "your_pick_losing",
      },
      aucklandWallclock(14),
    );
    const last = h.calls[h.calls.length - 1];
    expect(String(last.payload.text)).toContain("in trouble");
  });

  it("omits the signal line when neutral", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    await sendGoalPush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        team_name: "Brazil",
        scoreline: "BRA 1 - 0 GER",
        match_id: "wc-bra-ger-2026",
        bracket_signal: "neutral",
      },
      aucklandWallclock(14),
    );
    const last = h.calls[h.calls.length - 1];
    expect(String(last.payload.text)).not.toContain("looking good");
    expect(String(last.payload.text)).not.toContain("in trouble");
  });
});

describe("affiliate-cta push", () => {
  it("blocks Polymarket CTA in NZ", async () => {
    const h = makeHarness();
    h.storage.upsertUser({
      chat_id: 100,
      user_id: "u_nz",
      country_code: "NZ",
    });
    h.storage.setNotifyPref(100, "affiliate", true);
    const r = await sendAffiliateCtaPush(
      h.bot,
      h.storage,
      {
        user_id: "u_nz",
        kind: "polymarket-trade",
        copy: "Back Argentina on Polymarket",
        url: "https://polymarket.com/?ref=tournamental",
        campaign_id: "c_1",
      },
      DEFAULT_AFFILIATE_CONFIG,
      aucklandWallclock(14),
    );
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("geo_blocked");
    expect(h.calls).toHaveLength(0);
  });

  it("blocks Polymarket CTA in AU", async () => {
    const h = makeHarness();
    h.storage.upsertUser({
      chat_id: 100,
      user_id: "u_au",
      country_code: "AU",
    });
    h.storage.setNotifyPref(100, "affiliate", true);
    const r = await sendAffiliateCtaPush(
      h.bot,
      h.storage,
      {
        user_id: "u_au",
        kind: "polymarket-trade",
        copy: "...",
        url: "https://polymarket.com/?ref=tournamental",
        campaign_id: "c_1",
      },
      DEFAULT_AFFILIATE_CONFIG,
      aucklandWallclock(14),
    );
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("geo_blocked");
  });

  it("allows Polymarket CTA in US for opted-in users", async () => {
    const h = makeHarness();
    h.storage.upsertUser({
      chat_id: 100,
      user_id: "u_us",
      country_code: "US",
    });
    h.storage.setNotifyPref(100, "affiliate", true);
    const r = await sendAffiliateCtaPush(
      h.bot,
      h.storage,
      {
        user_id: "u_us",
        kind: "polymarket-trade",
        copy: "Back Argentina on Polymarket",
        url: "https://polymarket.com/?ref=tournamental",
        campaign_id: "c_1",
      },
      DEFAULT_AFFILIATE_CONFIG,
      aucklandWallclock(14),
    );
    expect(r.sent).toBe(true);
  });

  it("blocks any affiliate when not opted in", async () => {
    const h = makeHarness();
    h.storage.upsertUser({
      chat_id: 100,
      user_id: "u_us",
      country_code: "US",
    });
    // affiliate flag intentionally NOT enabled.
    const r = await sendAffiliateCtaPush(
      h.bot,
      h.storage,
      {
        user_id: "u_us",
        kind: "polymarket-trade",
        copy: "...",
        url: "https://polymarket.com/?ref=tournamental",
        campaign_id: "c_1",
      },
      DEFAULT_AFFILIATE_CONFIG,
      aucklandWallclock(14),
    );
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("category_disabled");
  });

  it("paytv-stream allowed in NZ (Sky NZ etc.)", async () => {
    const h = makeHarness();
    h.storage.upsertUser({
      chat_id: 100,
      user_id: "u_nz",
      country_code: "NZ",
    });
    h.storage.setNotifyPref(100, "affiliate", true);
    const r = await sendAffiliateCtaPush(
      h.bot,
      h.storage,
      {
        user_id: "u_nz",
        kind: "paytv-stream",
        copy: "Watch ARG vs FRA — Sky NZ 4-week pass $14.99",
        url: "https://sky.co.nz/?aff=tournamental",
        campaign_id: "c_paytv_1",
      },
      DEFAULT_AFFILIATE_CONFIG,
      aucklandWallclock(14),
    );
    expect(r.sent).toBe(true);
  });

  it("polymarket without country info is blocked", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_unknown" });
    h.storage.setNotifyPref(100, "affiliate", true);
    const r = await sendAffiliateCtaPush(
      h.bot,
      h.storage,
      {
        user_id: "u_unknown",
        kind: "polymarket-trade",
        copy: "...",
        url: "https://polymarket.com/?ref=tournamental",
        campaign_id: "c_1",
      },
      DEFAULT_AFFILIATE_CONFIG,
      aucklandWallclock(14),
    );
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("geo_unknown");
  });
});

describe("push interplay with daily cap", () => {
  it("4th push of the day is rejected for category-disabled reason or cap", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 100, user_id: "u_a" });
    const now = aucklandWallclock(14);

    for (let i = 0; i < 3; i++) {
      const r = await sendMarketMovePush(
        h.bot,
        h.storage,
        {
          user_id: "u_a",
          team_name: "ARG",
          old_pp: 0.4,
          new_pp: 0.3,
        },
        now,
      );
      expect(r.sent).toBe(true);
    }
    const r4 = await sendMarketMovePush(
      h.bot,
      h.storage,
      {
        user_id: "u_a",
        team_name: "ARG",
        old_pp: 0.3,
        new_pp: 0.2,
      },
      now,
    );
    expect(r4.sent).toBe(false);
    expect(r4.reason).toBe("daily_cap_reached");
  });
});
