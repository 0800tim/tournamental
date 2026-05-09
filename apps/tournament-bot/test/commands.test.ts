import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastReply, makeHarness, makeMessageUpdate } from "./helpers.js";
import { parseStartPayload, buildSyndicateDeepLink } from "../src/bots/syndicate-factory.js";
import { parseTeamArg } from "../src/commands/odds.js";

describe("/start", () => {
  it("creates a tg_user row on first /start", async () => {
    const h = makeHarness();
    await h.feed(makeMessageUpdate({ chat_id: 555, text: "/start" }));
    const u = h.storage.getUser(555);
    expect(u).not.toBeNull();
    expect(u?.user_id).toBeNull();
    expect(lastReply(h.calls)).toContain("VTourn");
  });

  it("does not duplicate the user on a second /start", async () => {
    const h = makeHarness();
    await h.feed(makeMessageUpdate({ chat_id: 555, text: "/start" }));
    await h.feed(makeMessageUpdate({ chat_id: 555, text: "/start" }));
    const all = h.storage.db
      .prepare("SELECT count(*) AS c FROM tg_user WHERE chat_id = 555")
      .get() as { c: number };
    expect(all.c).toBe(1);
  });

  it("routes a syndicate deep-link to a syndicate-flavoured welcome", async () => {
    const h = makeHarness();
    h.storage.createSyndicate({
      id: "syn_1",
      slug: "jasons-office",
      name: "Jason's Office",
      owner_user_id: "u_owner",
      format: "podium",
      privacy: "invite_only",
    });
    await h.feed(
      makeMessageUpdate({ chat_id: 1, text: "/start syn_jasons-office" }),
    );
    expect(lastReply(h.calls)).toContain("Jason's Office");
    expect(lastReply(h.calls)).toContain("top 3 share");
  });

  it("apologises when the syndicate slug is unknown", async () => {
    const h = makeHarness();
    await h.feed(makeMessageUpdate({ chat_id: 1, text: "/start syn_nope" }));
    expect(lastReply(h.calls)).toContain("couldn't find a syndicate");
  });

  it("acknowledges a login deep-link payload", async () => {
    const h = makeHarness();
    await h.feed(
      makeMessageUpdate({ chat_id: 1, text: "/start login_847291" }),
    );
    expect(lastReply(h.calls)).toContain("847291");
  });

  it("acknowledges an invite deep-link payload", async () => {
    const h = makeHarness();
    await h.feed(
      makeMessageUpdate({ chat_id: 1, text: "/start invite_u_42" }),
    );
    expect(lastReply(h.calls)).toContain("u_42");
  });
});

describe("/picks", () => {
  it("nudges the user to pair their account when not linked", async () => {
    const h = makeHarness();
    await h.feed(makeMessageUpdate({ chat_id: 1, text: "/picks" }));
    expect(lastReply(h.calls)).toContain("not paired");
  });

  it("returns a deep link to the bracket once linked", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 1, user_id: "u_42" });
    await h.feed(makeMessageUpdate({ chat_id: 1, text: "/picks" }));
    expect(lastReply(h.calls)).toContain("/u/u_42/bracket");
  });
});

describe("/odds", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("rejects with usage when no team supplied", async () => {
    const h = makeHarness();
    await h.feed(makeMessageUpdate({ chat_id: 1, text: "/odds" }));
    expect(lastReply(h.calls)).toContain("Usage");
  });

  it("rejects malformed team args", async () => {
    const h = makeHarness();
    await h.feed(makeMessageUpdate({ chat_id: 1, text: "/odds *@!" }));
    expect(lastReply(h.calls).toLowerCase()).toMatch(/couldn|usage/);
  });

  it("parseTeamArg accepts both forms", () => {
    expect(parseTeamArg("team:argentina")).toBe("argentina");
    expect(parseTeamArg("argentina")).toBe("argentina");
    expect(parseTeamArg("ARG")).toBe("arg");
    expect(parseTeamArg("!!!")).toBeNull();
    expect(parseTeamArg("")).toBeNull();
  });
});

describe("/leaderboard", () => {
  it("falls back gracefully when the api is unreachable", async () => {
    // Override fetch to throw.
    const h = makeHarness();
    const failing = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    // Replace the fetch dep on the shared bot harness via env shimming —
    // commands import fetch at call time via deps.fetch. We can't swap
    // mid-bot easily; instead we set a global stub.
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      failing as unknown as typeof fetch;
    try {
      await h.feed(makeMessageUpdate({ chat_id: 1, text: "/leaderboard" }));
      expect(lastReply(h.calls).toLowerCase()).toContain("couldn");
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = origFetch;
    }
  });
});

describe("/help", () => {
  it("lists every documented command", async () => {
    const h = makeHarness();
    await h.feed(makeMessageUpdate({ chat_id: 1, text: "/help" }));
    const r = lastReply(h.calls);
    for (const cmd of [
      "/start",
      "/picks",
      "/odds",
      "/leaderboard",
      "/syndicate",
      "/help",
    ]) {
      expect(r).toContain(cmd);
    }
  });
});

describe("/syndicate", () => {
  it("requires account pairing for create", async () => {
    const h = makeHarness();
    await h.feed(
      makeMessageUpdate({ chat_id: 1, text: "/syndicate create office MyOffice" }),
    );
    expect(lastReply(h.calls)).toContain("Pair your account");
  });

  it("creates a syndicate with the user as owner", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 1, user_id: "u_owner" });
    await h.feed(
      makeMessageUpdate({
        chat_id: 1,
        text: "/syndicate create jasons-office Jason's Office",
      }),
    );
    const syn = h.storage.getSyndicateBySlug("jasons-office");
    expect(syn).not.toBeNull();
    expect(syn?.owner_user_id).toBe("u_owner");
    expect(lastReply(h.calls)).toContain("Jason's Office");
    expect(lastReply(h.calls)).toContain(
      "https://t.me/VTournBot?start=syn_jasons-office",
    );
  });

  it("rejects bad slugs", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 1, user_id: "u_owner" });
    await h.feed(
      makeMessageUpdate({
        chat_id: 1,
        text: "/syndicate create UPPERCASE Bad Slug",
      }),
    );
    expect(lastReply(h.calls)).toContain("Slug must be");
  });

  it("rejects duplicate slugs", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 1, user_id: "u_owner" });
    h.storage.createSyndicate({
      id: "x",
      slug: "office",
      name: "X",
      owner_user_id: "u_a",
      format: "points",
      privacy: "public",
    });
    await h.feed(
      makeMessageUpdate({ chat_id: 1, text: "/syndicate create office Office" }),
    );
    expect(lastReply(h.calls)).toContain("taken");
  });

  it("join adds the caller as a member", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 2, user_id: "u_joiner" });
    h.storage.createSyndicate({
      id: "x",
      slug: "office",
      name: "Office",
      owner_user_id: "u_a",
      format: "points",
      privacy: "public",
    });
    await h.feed(makeMessageUpdate({ chat_id: 2, text: "/syndicate join office" }));
    const members = h.storage.listMembers("x").map((m) => m.user_id);
    expect(members).toContain("u_joiner");
    expect(lastReply(h.calls)).toContain("Joined");
  });

  it("leave removes the caller", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 2, user_id: "u_joiner" });
    h.storage.createSyndicate({
      id: "x",
      slug: "office",
      name: "Office",
      owner_user_id: "u_a",
      format: "points",
      privacy: "public",
    });
    h.storage.addMember("x", "u_joiner");
    await h.feed(
      makeMessageUpdate({ chat_id: 2, text: "/syndicate leave office" }),
    );
    const members = h.storage.listMembers("x").map((m) => m.user_id);
    expect(members).not.toContain("u_joiner");
  });

  it("list shows nothing for fresh users", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 3, user_id: "u_lonely" });
    await h.feed(makeMessageUpdate({ chat_id: 3, text: "/syndicate list" }));
    expect(lastReply(h.calls)).toContain("not in any syndicates");
  });

  it("list shows the user's syndicates", async () => {
    const h = makeHarness();
    h.storage.upsertUser({ chat_id: 3, user_id: "u_member" });
    h.storage.createSyndicate({
      id: "x",
      slug: "office",
      name: "Office",
      owner_user_id: "u_member",
      format: "points",
      privacy: "public",
    });
    await h.feed(makeMessageUpdate({ chat_id: 3, text: "/syndicate list" }));
    expect(lastReply(h.calls)).toContain("Office");
    expect(lastReply(h.calls)).toContain("office");
  });

  it("no-args prints sub-command help", async () => {
    const h = makeHarness();
    await h.feed(makeMessageUpdate({ chat_id: 4, text: "/syndicate" }));
    const r = lastReply(h.calls);
    expect(r).toContain("create");
    expect(r).toContain("join");
    expect(r).toContain("leave");
    expect(r).toContain("list");
  });
});

describe("free-form text", () => {
  it("nudges users toward /help", async () => {
    const h = makeHarness();
    await h.feed(
      makeMessageUpdate({ chat_id: 1, text: "hey what is this thing" }),
    );
    expect(lastReply(h.calls)).toContain("/help");
  });
});

describe("syndicate-factory", () => {
  it("parses the documented payload kinds", () => {
    expect(parseStartPayload("syn_office")).toEqual({
      kind: "syndicate",
      value: "office",
    });
    expect(parseStartPayload("login_999")).toEqual({
      kind: "login",
      value: "999",
    });
    expect(parseStartPayload("invite_u_42")).toEqual({
      kind: "invite",
      value: "u_42",
    });
    expect(parseStartPayload(undefined)).toEqual({ kind: "none", value: null });
    expect(parseStartPayload("")).toEqual({ kind: "none", value: null });
    expect(parseStartPayload("garbage")).toEqual({ kind: "none", value: null });
  });

  it("builds a deep link for a valid slug", () => {
    const link = buildSyndicateDeepLink("VTournBot", "jasons-office");
    expect(link.url).toBe("https://t.me/VTournBot?start=syn_jasons-office");
  });

  it("rejects invalid slugs", () => {
    expect(() => buildSyndicateDeepLink("VTournBot", "Bad Slug")).toThrow();
    expect(() => buildSyndicateDeepLink("VTournBot", "x")).toThrow();
    expect(() => buildSyndicateDeepLink("VTournBot", "a".repeat(50))).toThrow();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
