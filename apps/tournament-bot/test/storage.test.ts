import { describe, expect, it } from "vitest";
import { Storage } from "../src/storage.js";

function fresh(): Storage {
  return new Storage(":memory:");
}

describe("Storage.tg_user", () => {
  it("creates a new user with sane defaults", () => {
    const s = fresh();
    const u = s.upsertUser({ chat_id: 1001 });
    expect(u.chat_id).toBe(1001);
    expect(u.user_id).toBeNull();
    expect(u.tz).toBe("Pacific/Auckland");
    expect(u.notify_market_move).toBe(1);
    expect(u.notify_kickoff).toBe(1);
    expect(u.notify_goal).toBe(1);
    expect(u.notify_affiliate).toBe(0);
    expect(u.quiet_start).toBe("22:00");
    expect(u.quiet_end).toBe("08:00");
    expect(u.push_count_today).toBe(0);
  });

  it("upserts updates only the supplied fields", () => {
    const s = fresh();
    s.upsertUser({ chat_id: 1, language_code: "en" });
    s.upsertUser({ chat_id: 1, user_id: "u_42" });
    const got = s.getUser(1)!;
    expect(got.user_id).toBe("u_42");
    expect(got.language_code).toBe("en");
  });

  it("looks up by user_id once linked", () => {
    const s = fresh();
    s.upsertUser({ chat_id: 1, user_id: "u_42" });
    expect(s.getUserByUserId("u_42")?.chat_id).toBe(1);
    expect(s.getUserByUserId("nope")).toBeNull();
  });

  it("setNotifyPref toggles the right column", () => {
    const s = fresh();
    s.upsertUser({ chat_id: 1 });
    s.setNotifyPref(1, "affiliate", true);
    expect(s.getUser(1)?.notify_affiliate).toBe(1);
    s.setNotifyPref(1, "goal", false);
    expect(s.getUser(1)?.notify_goal).toBe(0);
  });

  it("setQuietHours persists the override", () => {
    const s = fresh();
    s.upsertUser({ chat_id: 1 });
    s.setQuietHours(1, "23:30", "07:30");
    const u = s.getUser(1)!;
    expect(u.quiet_start).toBe("23:30");
    expect(u.quiet_end).toBe("07:30");
  });

  it("recordPush increments same-day and resets across days", () => {
    const s = fresh();
    s.upsertUser({ chat_id: 1 });
    s.recordPush(1, 1_700_000_000_000, "2026-05-09");
    s.recordPush(1, 1_700_000_001_000, "2026-05-09");
    expect(s.getUser(1)?.push_count_today).toBe(2);
    s.recordPush(1, 1_700_000_002_000, "2026-05-10");
    expect(s.getUser(1)?.push_count_today).toBe(1);
    expect(s.getUser(1)?.push_count_day).toBe("2026-05-10");
  });
});

describe("Storage.syndicate", () => {
  it("creates a syndicate and adds the owner", () => {
    const s = fresh();
    const syn = s.createSyndicate({
      id: "syn_a_1",
      slug: "jasons-office",
      name: "Jason's Office",
      owner_user_id: "u_owner",
      format: "podium",
      privacy: "invite_only",
    });
    expect(syn.slug).toBe("jasons-office");
    const members = s.listMembers(syn.id);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
  });

  it("rejects duplicate slugs at the SQL level", () => {
    const s = fresh();
    s.createSyndicate({
      id: "syn_a_1",
      slug: "dupe",
      name: "A",
      owner_user_id: null,
      format: "points",
      privacy: "public",
    });
    expect(() =>
      s.createSyndicate({
        id: "syn_a_2",
        slug: "dupe",
        name: "B",
        owner_user_id: null,
        format: "points",
        privacy: "public",
      }),
    ).toThrow();
  });

  it("addMember is idempotent", () => {
    const s = fresh();
    const syn = s.createSyndicate({
      id: "syn_a_1",
      slug: "office",
      name: "Office",
      owner_user_id: null,
      format: "points",
      privacy: "public",
    });
    s.addMember(syn.id, "u_1", "member");
    s.addMember(syn.id, "u_1", "member");
    expect(s.listMembers(syn.id)).toHaveLength(1);
  });

  it("removeMember drops only that user", () => {
    const s = fresh();
    const syn = s.createSyndicate({
      id: "syn_a_1",
      slug: "office",
      name: "Office",
      owner_user_id: "u_owner",
      format: "points",
      privacy: "public",
    });
    s.addMember(syn.id, "u_a");
    s.addMember(syn.id, "u_b");
    s.removeMember(syn.id, "u_a");
    const remaining = s.listMembers(syn.id).map((m) => m.user_id);
    expect(remaining.sort()).toEqual(["u_b", "u_owner"]);
  });

  it("listMemberships returns all the user's syndicates", () => {
    const s = fresh();
    s.createSyndicate({
      id: "syn_1",
      slug: "office",
      name: "Office",
      owner_user_id: "u_a",
      format: "points",
      privacy: "public",
    });
    s.createSyndicate({
      id: "syn_2",
      slug: "fam",
      name: "Family",
      owner_user_id: "u_a",
      format: "winner_take_all",
      privacy: "invite_only",
    });
    const got = s.listMemberships("u_a");
    expect(got.map((x) => x.slug).sort()).toEqual(["fam", "office"]);
  });

  it("foreign keys block phantom members", () => {
    const s = fresh();
    expect(() => s.addMember("does-not-exist", "u_a")).toThrow();
  });
});
