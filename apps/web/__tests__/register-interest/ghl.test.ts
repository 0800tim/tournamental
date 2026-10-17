/**
 * lib/register-interest/ghl.ts with an injected fetch. The real
 * HighLevel API is never reached: global fetch is stubbed to throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRegisterInterestPayload,
  pushRegisterInterestToGhl,
} from "@/lib/register-interest/ghl";
import type { RegisterInterestRow } from "@/lib/register-interest/store";

const ROW: RegisterInterestRow = {
  id: "ri_abc",
  tournament_id: "rwc-2027",
  email: "alice@example.com",
  first_name: "Alice",
  country: "NZ",
  phone: "+64211234567",
  consent: 1,
  source_host: "play.tournamental.com",
  source_path: "/",
  referred_by_code: "zzzzzzz",
  invite_code: "abcdefg",
  ghl_status: "queued",
  ghl_contact_id: null,
  created_at: Date.UTC(2026, 9, 16, 1, 2, 3),
  updated_at: Date.UTC(2026, 9, 16, 1, 2, 3),
};

const OPTS = { tagSlug: "rwc2027", inviteBase: "https://play.tournamental.com" };

function okFetch(body: unknown = { contact: { id: "c_42" } }) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

beforeEach(() => {
  vi.stubEnv("GHL_API_KEY", "test-key");
  vi.stubEnv("GHL_LOCATION_ID", "loc_1");
  global.fetch = vi.fn(async () => {
    throw new Error("real fetch called");
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("buildRegisterInterestPayload", () => {
  it("carries the three tags, the custom fields and the contact details", () => {
    const p = buildRegisterInterestPayload(ROW, "rwc2027", "https://play.tournamental.com/");
    expect(p.tags).toEqual(["register_interest", "rwc2027_interest", "tournament:rwc-2027"]);
    expect(p.source).toBe("rwc2027_register_interest");
    expect(p.locationId).toBe("loc_1");
    expect(p).toMatchObject({ email: "alice@example.com", firstName: "Alice", phone: "+64211234567", country: "NZ" });
    const fields = Object.fromEntries(
      (p.customFields as Array<{ key: string; field_value: string }>).map((f) => [f.key, f.field_value]),
    );
    expect(fields).toEqual({
      interest_tournament: "rwc-2027",
      interest_invite_code: "abcdefg",
      interest_invite_url: "https://play.tournamental.com//i/abcdefg",
      interest_referred_by: "zzzzzzz",
      interest_registered_at: "2026-10-16T01:02:03.000Z",
      interest_consent: "yes",
    });
  });

  it("omits optional contact fields that are empty", () => {
    const p = buildRegisterInterestPayload(
      { ...ROW, first_name: null, phone: null, country: null, referred_by_code: null, consent: 0 },
      "rwc2027",
      "https://x",
    );
    expect(p).not.toHaveProperty("firstName");
    expect(p).not.toHaveProperty("phone");
    expect(p).not.toHaveProperty("country");
    const fields = p.customFields as Array<{ key: string; field_value: string }>;
    expect(fields.find((f) => f.key === "interest_referred_by")?.field_value).toBe("");
    expect(fields.find((f) => f.key === "interest_consent")?.field_value).toBe("no");
  });

  it("never includes the IP hash, user agent or internal id", () => {
    const text = JSON.stringify(buildRegisterInterestPayload(ROW, "rwc2027", "https://x"));
    expect(text).not.toContain("ri_abc");
    expect(text).not.toContain("ip_hash");
    expect(text).not.toContain("user_agent");
  });
});

describe("pushRegisterInterestToGhl", () => {
  it("skips without calling anything when no API key is configured", async () => {
    vi.stubEnv("GHL_API_KEY", "");
    const fetchImpl = okFetch();
    const r = await pushRegisterInterestToGhl(ROW, { ...OPTS, fetchImpl });
    expect(r).toEqual({ status: "skipped" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts the upsert with the bearer key and version header and returns the contact id", async () => {
    const fetchImpl = okFetch();
    const r = await pushRegisterInterestToGhl(ROW, { ...OPTS, fetchImpl });
    expect(r).toEqual({ status: "synced", contactId: "c_42" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://services.leadconnectorhq.com/contacts/upsert");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers.Version).toBe("2021-07-28");
    expect(JSON.parse(String(init.body)).email).toBe("alice@example.com");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("marks synced without a contact id when the response body is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const r = await pushRegisterInterestToGhl(ROW, { ...OPTS, fetchImpl });
    expect(r).toEqual({ status: "synced", contactId: undefined });
  });

  it("returns failed with the status and a truncated body on a non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(1000), { status: 422 }));
    const r = await pushRegisterInterestToGhl(ROW, { ...OPTS, fetchImpl });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/^ghl 422: x+$/);
    expect(r.error!.length).toBeLessThanOrEqual(220);
  });

  it("returns failed and never throws when fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await pushRegisterInterestToGhl(ROW, { ...OPTS, fetchImpl });
    expect(r).toEqual({ status: "failed", error: "ECONNRESET" });
  });

  it("aborts after 3 seconds and reports the timeout as failed", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = pushRegisterInterestToGhl(ROW, {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    const r = await pending;
    expect(r).toEqual({ status: "failed", error: "aborted" });
  });
});
