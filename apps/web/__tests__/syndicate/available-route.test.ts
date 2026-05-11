/**
 * GET /api/v1/syndicates/:slug/available — route handler tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/syndicates/[slug]/available/route";
import {
  __setPersistenceForTests,
  SyndicatePersistence,
} from "@/lib/syndicate/persistence";

let persistence: SyndicatePersistence;

function call(slug: string): Promise<Response> {
  const fakeReq = new Request(
    `http://localhost/api/v1/syndicates/${slug}/available`,
  ) as unknown as Parameters<typeof GET>[0];
  return GET(fakeReq, { params: { slug } });
}

beforeEach(() => {
  persistence = new SyndicatePersistence({ dbPath: ":memory:" });
  persistence.ensureSchema();
  __setPersistenceForTests(persistence);
});

afterEach(() => {
  __setPersistenceForTests(null);
  persistence.close();
});

describe("GET /api/v1/syndicates/:slug/available", () => {
  it("returns ok for a free slug", async () => {
    const res = await call("daves-mates");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; reason: string };
    expect(body.available).toBe(true);
    expect(body.reason).toBe("ok");
  });

  it("returns reserved for a reserved slug", async () => {
    const res = await call("admin");
    const body = (await res.json()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toBe("reserved");
  });

  it("returns invalid for malformed slug", async () => {
    const res = await call("X");
    const body = (await res.json()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toBe("invalid");
  });

  it("returns taken when the slug is already used", async () => {
    persistence.createSyndicate({
      id: "syn-1",
      slug: "daves-mates",
      name: "Dave's Mates",
      tournament_id: "fifa-wc-2026",
      owner_email: "dave@example.com",
      owner_phone: "+64211234567",
      owner_user_id: null,
      owner_handle: null,
      size_band: "2-10",
      topic: null,
      marketing_consent: false,
      share_guid: "abc123def456ghij",
    });
    const res = await call("daves-mates");
    const body = (await res.json()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toBe("taken");
  });

  it("sends no-store cache header", async () => {
    const res = await call("daves-mates");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
