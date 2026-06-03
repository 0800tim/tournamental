import { describe, expect, it, vi } from "vitest";
import { Storage } from "../src/storage.js";
import {
  chatIdForSource,
  dispatch,
  formatLeaderboard,
  type DispatchDeps,
  type InboundMessage,
} from "../src/lib/dispatch.js";

function freshDeps(over: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    storage: new Storage(":memory:"),
    ...over,
  };
}

describe("dispatch — source agnosticism", () => {
  it("produces the same /help reply for telegram and whatsapp", async () => {
    const deps = freshDeps();
    const tg: InboundMessage = {
      source: "telegram",
      sourceId: 999,
      text: "/help",
    };
    const wa: InboundMessage = {
      source: "whatsapp",
      sourceId: "64211234567@s.whatsapp.net",
      text: "/help",
    };
    const tgReply = await dispatch(tg, deps);
    const waReply = await dispatch(wa, deps);
    expect(tgReply[0].text).toBe(waReply[0].text);
    for (const cmd of [
      "/start",
      "/picks",
      "/odds",
      "/leaderboard",
      "/syndicate",
      "/help",
    ]) {
      expect(tgReply[0].text).toContain(cmd);
    }
  });

  it("creates a user row keyed differently by source for the same numeric id", async () => {
    const deps = freshDeps();
    await dispatch(
      { source: "telegram", sourceId: 555, text: "/start" },
      deps,
    );
    await dispatch(
      {
        source: "whatsapp",
        sourceId: "64211234567@s.whatsapp.net",
        text: "/start",
      },
      deps,
    );
    const all = deps.storage.db
      .prepare("SELECT count(*) AS c FROM tg_user")
      .get() as { c: number };
    expect(all.c).toBe(2);
  });

  it("never collides telegram chat_ids with whatsapp synthetic ids", () => {
    const tgId = chatIdForSource("telegram", 555);
    const waId = chatIdForSource(
      "whatsapp",
      "64211234567@s.whatsapp.net",
    );
    expect(tgId).toBe(555);
    expect(waId).toBeLessThan(-1e15);
    expect(waId).not.toBe(tgId);
  });

  it("non-command text in either source nudges to /help", async () => {
    const deps = freshDeps();
    const tg = await dispatch(
      { source: "telegram", sourceId: 1, text: "hello" },
      deps,
    );
    const wa = await dispatch(
      { source: "whatsapp", sourceId: "x@s.whatsapp.net", text: "hello" },
      deps,
    );
    expect(tg[0].text).toContain("/help");
    expect(wa[0].text).toContain("/help");
  });

  it("invite link in /syndicate create is telegram-flavoured for TG and slug-only for WA", async () => {
    const deps = freshDeps();
    deps.storage.upsertUser({ chat_id: 1, user_id: "u_owner" });
    deps.storage.upsertUser({
      chat_id: chatIdForSource("whatsapp", "wa@s.whatsapp.net"),
      user_id: "u_wa_owner",
    });
    const tgReply = await dispatch(
      {
        source: "telegram",
        sourceId: 1,
        text: "/syndicate create office Office",
        botUsername: "TournamentalBot",
      },
      deps,
    );
    expect(tgReply[0].text).toContain(
      "https://t.me/TournamentalBot?start=syn_office",
    );

    const waReply = await dispatch(
      {
        source: "whatsapp",
        sourceId: "wa@s.whatsapp.net",
        text: "/syndicate create wa-office WA Office",
      },
      deps,
    );
    expect(waReply[0].text).toContain("/start syn_wa-office");
    expect(waReply[0].text).not.toContain("t.me/");
  });

  it("/odds usage text returns when no team supplied (both sources)", async () => {
    const deps = freshDeps();
    const r = await dispatch(
      { source: "whatsapp", sourceId: "x@s.whatsapp.net", text: "/odds" },
      deps,
    );
    expect(r[0].text).toContain("Usage");
  });

  it("/picks nudges unpaired users", async () => {
    const deps = freshDeps();
    const r = await dispatch(
      { source: "whatsapp", sourceId: "x@s.whatsapp.net", text: "/picks" },
      deps,
    );
    expect(r[0].text).toContain("not paired");
  });

  it("/picks links to the bracket for paired users", async () => {
    const deps = freshDeps();
    deps.storage.upsertUser({
      chat_id: chatIdForSource("whatsapp", "x@s.whatsapp.net"),
      user_id: "u_42",
    });
    const r = await dispatch(
      { source: "whatsapp", sourceId: "x@s.whatsapp.net", text: "/picks" },
      deps,
    );
    expect(r[0].text).toContain("/u/u_42/bracket");
  });

  it("/leaderboard hits the api with the user's id and renders formatted reply", async () => {
    const deps = freshDeps({
      env: { apiBase: "https://api-test.local" },
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            scope: "global",
            top: [
              { rank: 1, name: "Alice", points: 1234 },
              { rank: 2, name: "Bob", points: 1100 },
            ],
            me: { rank: 42, points: 700 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as unknown as typeof fetch,
    });
    deps.storage.upsertUser({
      chat_id: chatIdForSource("whatsapp", "wa@s.whatsapp.net"),
      user_id: "u_42",
    });
    const r = await dispatch(
      { source: "whatsapp", sourceId: "wa@s.whatsapp.net", text: "/leaderboard" },
      deps,
    );
    expect(r[0].text).toContain("Alice — 1,234 pts");
    expect(r[0].text).toContain("#42");
  });

  it("/leaderboard falls back gracefully when api errors", async () => {
    const deps = freshDeps({
      fetch: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const r = await dispatch(
      { source: "telegram", sourceId: 1, text: "/leaderboard" },
      deps,
    );
    expect(r[0].text.toLowerCase()).toContain("couldn");
  });

  it("/start surfaces a syndicate welcome when the deep-link slug exists", async () => {
    const deps = freshDeps();
    deps.storage.createSyndicate({
      id: "x",
      slug: "office",
      name: "Jasons Office",
      owner_user_id: "u_owner",
      format: "podium",
      privacy: "invite_only",
    });
    const r = await dispatch(
      { source: "whatsapp", sourceId: "x@s.whatsapp.net", text: "/start syn_office" },
      deps,
    );
    expect(r[0].text).toContain("Jasons Office");
    expect(r[0].text).toContain("top 3 share");
  });

  it("/syndicate join refuses invite-only syndicates and does not add a member", async () => {
    const deps = freshDeps();
    deps.storage.upsertUser({ chat_id: 7, user_id: "u_joiner" });
    deps.storage.createSyndicate({
      id: "x",
      slug: "private-office",
      name: "Private Office",
      owner_user_id: "u_owner",
      format: "points",
      privacy: "invite_only",
    });
    const r = await dispatch(
      {
        source: "telegram",
        sourceId: 7,
        text: "/syndicate join private-office",
      },
      deps,
    );
    expect(r[0].text).toContain("invite-only");
    const members = deps.storage.listMembers("x").map((m) => m.user_id);
    expect(members).not.toContain("u_joiner");
  });

  it("/syndicate join still works for public syndicates", async () => {
    const deps = freshDeps();
    deps.storage.upsertUser({ chat_id: 8, user_id: "u_joiner_2" });
    deps.storage.createSyndicate({
      id: "y",
      slug: "open-office",
      name: "Open Office",
      owner_user_id: "u_owner",
      format: "points",
      privacy: "public",
    });
    const r = await dispatch(
      { source: "telegram", sourceId: 8, text: "/syndicate join open-office" },
      deps,
    );
    expect(r[0].text).toContain("Joined");
    const members = deps.storage.listMembers("y").map((m) => m.user_id);
    expect(members).toContain("u_joiner_2");
  });
});

describe("formatLeaderboard", () => {
  const u0 = (): { user_id: string | null } & Record<string, unknown> => ({
    user_id: null,
  });

  it("renders top-N with comma-separated points and includes scope label", () => {
    const out = formatLeaderboard(
      {
        scope: "country",
        top: [{ rank: 1, name: "Alice", points: 12345 }],
      },
      u0() as never,
      "country",
    );
    expect(out).toContain("Leaderboard — country");
    expect(out).toContain("Alice — 12,345 pts");
  });

  it("nudges anonymous users to pair via /start when no `me` row", () => {
    const out = formatLeaderboard({ scope: "global", top: [] }, u0() as never, "global");
    expect(out).toContain("Pair your account");
  });

  it("shows the user's rank when api returns a `me` row", () => {
    const out = formatLeaderboard(
      {
        scope: "global",
        top: [{ rank: 1, name: "Alice", points: 100 }],
        me: { rank: 17, points: 50 },
      },
      { user_id: "u_42" } as never,
      "global",
    );
    expect(out).toContain("#17");
    expect(out).toContain("50 pts");
  });

  it("handles empty leaderboards", () => {
    const out = formatLeaderboard(
      { scope: "week", top: [] },
      { user_id: "u_x" } as never,
      "week",
    );
    expect(out).toContain("No entries yet");
  });
});
