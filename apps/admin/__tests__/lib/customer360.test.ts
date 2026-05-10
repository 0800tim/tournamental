// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCustomer360 } from "@/lib/customer360";

describe("fetchCustomer360", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns nulls for every section when all upstreams are down", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const r = await fetchCustomer360("u_test");
    expect(r.userId).toBe("u_test");
    expect(r.crmContact).toBeNull();
    expect(r.bracketDraft).toBeNull();
    expect(r.bracketHistory).toBeNull();
    expect(r.syndicates).toBeNull();
    expect(r.affiliateRevenue).toBeNull();
    expect(r.socialPosts).toBeNull();
    expect(typeof r.fetchedAt).toBe("string");
  });

  it("aggregates each upstream by URL", async () => {
    const handlers: Record<string, unknown> = {
      "/v1/customer/u_a": { userId: "u_a", email: "a@x.com" },
      "/v1/users/u_a/bracket": {
        bracketId: "b1",
        matchPredictions: {
          "1": { matchId: "1", outcome: "home_win", lockedAt: "2026-06-01T00:00:00Z" },
        },
        knockoutPredictions: {},
        version: 1,
      },
      "/v1/users/u_a/history": [
        {
          id: "h_1",
          matchId: "1",
          ts: "2026-06-01T00:00:00Z",
          newOutcome: "home_win",
        },
      ],
      "/v1/users/u_a/syndicates": [
        { slug: "office", name: "Office", role: "member", joinedAt: "2026-05-01T00:00:00Z" },
      ],
      "/v1/admin/audit/by-user/u_a": {
        totalClicks: 3,
        totalConversions: 1,
        totalRevenueUnits: 12,
        recent: [],
      },
      "/v1/posts": [
        {
          id: "p_1",
          platform: "tiktok",
          publishedAt: "2026-05-01T00:00:00Z",
          relation: "appeared_in",
        },
      ],
    };

    global.fetch = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      const payload = handlers[path];
      if (payload === undefined) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: true, status: 200, json: async () => payload } as Response;
    }) as unknown as typeof fetch;

    const r = await fetchCustomer360("u_a");
    expect(r.crmContact?.email).toBe("a@x.com");
    expect(r.bracketDraft?.bracketId).toBe("b1");
    expect(r.bracketHistory?.[0]?.id).toBe("h_1");
    expect(r.syndicates?.[0]?.slug).toBe("office");
    expect(r.affiliateRevenue?.totalClicks).toBe(3);
    expect(r.socialPosts?.[0]?.id).toBe("p_1");
  });

  it("tolerates history endpoint returning {entries: [...]} OR a bare array", async () => {
    let i = 0;
    const responses = [
      // first call: object form
      { entries: [{ id: "h_a", matchId: "1", ts: "x", newOutcome: "home_win" }] },
      // second call: bare array
      [{ id: "h_b", matchId: "2", ts: "x", newOutcome: "draw" }],
    ];
    global.fetch = vi.fn(async (url: string) => {
      if (!url.includes("/history")) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      const body = responses[i++];
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;

    const r1 = await fetchCustomer360("u_x");
    expect(r1.bracketHistory?.[0]?.id).toBe("h_a");
    const r2 = await fetchCustomer360("u_x");
    expect(r2.bracketHistory?.[0]?.id).toBe("h_b");
  });
});
