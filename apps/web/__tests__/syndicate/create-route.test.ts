/**
 * POST /api/v1/syndicates — route handler tests.
 *
 * We mount a fresh in-memory SQLite persistence per test via
 * `__setPersistenceForTests`, mock `fetch` to control the GHL
 * response, and call the route handler directly with a synthesised
 * NextRequest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { POST } from "@/app/api/v1/syndicates/route";
import {
  __setPersistenceForTests,
  SyndicatePersistence,
} from "@/lib/syndicate/persistence";

const VALID_BODY = {
  name: "Dave's Mates",
  slug: "daves-mates",
  tournament_id: "fifa-wc-2026",
  size_band: "2-10",
  owner_email: "dave@example.com",
  owner_phone: "+64211234567",
  topic: "The mates pool",
  marketing_consent: false,
  terms_accepted: true,
} as const;

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/v1/syndicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

let originalFetch: typeof fetch;
let persistence: SyndicatePersistence;

beforeEach(() => {
  originalFetch = global.fetch;
  persistence = new SyndicatePersistence({ dbPath: ":memory:" });
  persistence.ensureSchema();
  __setPersistenceForTests(persistence);
  // Default: GHL key unset, no fetch should be called.
  delete process.env.GHL_API_KEY;
});

afterEach(() => {
  __setPersistenceForTests(null);
  persistence.close();
  global.fetch = originalFetch;
});

describe("POST /api/v1/syndicates", () => {
  it("creates a syndicate on a valid payload", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      syndicate_id: string;
      slug: string;
      share_url: string;
      ghl_status: string;
    };
    expect(body.slug).toBe("daves-mates");
    expect(body.syndicate_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.share_url).toMatch(/\/s\/daves-mates$/);
    // GHL was skipped (no key) — that's a reportable status.
    expect(body.ghl_status).toBe("skipped");
  });

  it("returns 409 reserved for a reserved slug", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, slug: "admin", name: "Admins Pool" }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("reserved");
  });

  it("returns 409 taken on a duplicate slug", async () => {
    const first = await POST(makeRequest(VALID_BODY));
    expect(first.status).toBe(200);
    const second = await POST(makeRequest(VALID_BODY));
    expect(second.status).toBe(409);
    const body = (await second.json()) as { reason: string };
    expect(body.reason).toBe("taken");
  });

  it("returns 400 on a malformed slug", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, slug: "-bad-" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on a malformed phone", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, owner_phone: "021123" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on a malformed email", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, owner_email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when terms aren't accepted", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, terms_accepted: false }));
    expect(res.status).toBe(400);
  });

  it("still returns 200 when GHL is configured but down", async () => {
    process.env.GHL_API_KEY = "test-key-123";
    process.env.GHL_LOCATION_ID = "loc-123";
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ghl_status: string };
    expect(body.ghl_status).toBe("failed");

    // And the dead-letter queue has a row.
    const pending = persistence.listPendingGhl(Date.now() + 24 * 60 * 60 * 1000);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.attempts).toBe(0);
  });

  it("marks ghl_status synced when GHL returns 2xx", async () => {
    process.env.GHL_API_KEY = "test-key-123";
    process.env.GHL_LOCATION_ID = "loc-123";
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ contact: { id: "ghl-contact-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ghl_status: string };
    expect(body.ghl_status).toBe("synced");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toContain("/contacts/");
    // Bearer header carries the key.
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key-123",
    );
    expect((init.headers as Record<string, string>).Version).toBe("2021-07-28");
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new Request("http://localhost/api/v1/syndicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
