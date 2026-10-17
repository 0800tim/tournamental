/**
 * POST /api/v1/register-interest, called directly with synthesised
 * NextRequests against a throwaway SQLite file. HighLevel is mocked at
 * the module boundary and global fetch is stubbed to throw, so no
 * network call can happen.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const state = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnm-ri-route-"));
  const dbPath = path.join(dir, "game.db");
  fs.writeFileSync(dbPath, "");
  process.env.VTORN_GAME_DB_PATH = dbPath;
  process.env.TOURNAMENTAL_INTERNAL_SECRET = "test-salt";
  process.env.NEXT_PUBLIC_INVITE_BASE_URL = "https://play.example.test/";
  return { dir, dbPath, upcoming: true };
});

vi.mock("@/lib/register-interest/ghl", () => ({
  pushRegisterInterestToGhl: vi.fn(async () => ({ status: "synced", contactId: "c_1" })),
}));

vi.mock("@/lib/tournaments/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tournaments/registry")>();
  return {
    ...real,
    upcomingTournament: () => (state.upcoming ? real.upcomingTournament() : null),
  };
});

import { POST, GET } from "@/app/api/v1/register-interest/route";
import { pushRegisterInterestToGhl } from "@/lib/register-interest/ghl";
import { registerInterestDb } from "@/lib/register-interest/store";

const pushMock = vi.mocked(pushRegisterInterestToGhl);

global.fetch = vi.fn(async () => {
  throw new Error("network call attempted during register-interest tests");
}) as unknown as typeof fetch;

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

interface ReqOptions {
  ip?: string;
  headers?: Record<string, string>;
  rawBody?: string;
}

function makeRequest(body: unknown, opts: ReqOptions = {}): NextRequest {
  const raw = opts.rawBody ?? JSON.stringify(body);
  return new Request("https://play.tournamental.com/api/v1/register-interest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "play.tournamental.com",
      "cf-connecting-ip": opts.ip ?? nextIp(),
      "user-agent": "vitest",
      ...(opts.headers ?? {}),
    },
    body: raw,
  }) as unknown as NextRequest;
}

const GOOD = {
  email: "Alice@Example.com",
  first_name: "Alice",
  country: "nz",
  phone: "021 123 4567",
  consent: true,
  website: "",
  ref: "",
  source_path: "/",
};

function rows() {
  return registerInterestDb()!
    .prepare("SELECT * FROM register_interest ORDER BY created_at")
    .all() as Array<Record<string, unknown>>;
}

beforeEach(() => {
  registerInterestDb()!.exec("DELETE FROM register_interest");
  pushMock.mockClear();
});

afterAll(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  fs.rmSync(state.dir, { recursive: true, force: true });
});

describe("happy path", () => {
  it("stores a row, returns the invite code and link, and mirrors to HighLevel once", async () => {
    const res = await POST(makeRequest(GOOD));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.invite_code).toMatch(/^[a-hj-kmnp-z2-9]{7}$/);
    expect(body.invite_url).toBe(`https://play.example.test/i/${body.invite_code}`);
    expect(body.referrals).toBe(0);
    expect(body).not.toHaveProperty("created");

    const [row] = rows();
    expect(row).toMatchObject({
      tournament_id: "rwc-2027",
      email: "alice@example.com",
      first_name: "Alice",
      country: "NZ",
      phone: "+0211234567",
      consent: 1,
      source_host: "play.tournamental.com",
      source_path: "/",
      ghl_status: "synced",
      ghl_contact_id: "c_1",
    });
    expect(row!.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(row!.ip_hash).not.toContain("203.0.113");
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0]![1]).toMatchObject({ tagSlug: "rwc2027" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts consent as the string yes and a phone with a country code", async () => {
    const res = await POST(makeRequest({ ...GOOD, consent: "yes", phone: "+64 21 123 4567" }));
    expect(res.status).toBe(200);
    expect(rows()[0]!.phone).toBe("+64211234567");
  });

  it("stores no phone when none is given", async () => {
    const res = await POST(makeRequest({ ...GOOD, phone: "" }));
    expect(res.status).toBe(200);
    expect(rows()[0]!.phone).toBeNull();
  });

  it("answers GET with 405 and an Allow header", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

describe("validation", () => {
  it.each([
    ["missing email", { ...GOOD, email: "" }, "email_invalid"],
    ["malformed email", { ...GOOD, email: "not-an-email" }, "email_invalid"],
    ["email with spaces", { ...GOOD, email: "a b@example.com" }, "email_invalid"],
    ["consent missing", { ...GOOD, consent: false }, "consent_required"],
    ["consent as other string", { ...GOOD, consent: "true" }, "consent_required"],
    ["phone too short", { ...GOOD, phone: "1234" }, "phone_invalid"],
    ["phone with letters", { ...GOOD, phone: "021abc4567" }, "phone_invalid"],
  ])("rejects %s with 400", async (_label, body, error) => {
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error });
    expect(rows()).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body with 400", async () => {
    const res = await POST(makeRequest(null, { rawBody: "email=alice" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_json" });
  });

  it("rejects an oversized body with 413 before parsing it", async () => {
    const big = JSON.stringify({ ...GOOD, first_name: "x".repeat(20_000) });
    const res = await POST(makeRequest(null, { rawBody: big }));
    expect(res.status).toBe(413);
    expect(rows()).toHaveLength(0);
  });

  it("rejects a declared oversized Content-Length with 413", async () => {
    const res = await POST(makeRequest(GOOD, { headers: { "content-length": "999999" } }));
    expect(res.status).toBe(413);
  });

  it("truncates long names and drops a bad country code", async () => {
    const res = await POST(makeRequest({ ...GOOD, first_name: "A".repeat(500), country: "NZL" }));
    expect(res.status).toBe(200);
    const [row] = rows();
    expect((row!.first_name as string).length).toBe(80);
    expect(row!.country).toBeNull();
  });

  it("keeps source_path only when it is a plain path", async () => {
    await POST(makeRequest({ ...GOOD, email: "p1@example.com", source_path: "/hub?ref=x" }));
    await POST(makeRequest({ ...GOOD, email: "p2@example.com", source_path: "javascript:alert(1)" }));
    await POST(makeRequest({ ...GOOD, email: "p3@example.com", source_path: "/rwc2027/hero" }));
    const paths = rows().map((r) => r.source_path);
    expect(paths).toEqual([null, null, "/rwc2027/hero"]);
  });

  it("returns 409 when no tournament is upcoming", async () => {
    state.upcoming = false;
    try {
      const res = await POST(makeRequest(GOOD));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, error: "no_upcoming_tournament" });
    } finally {
      state.upcoming = true;
    }
  });
});

describe("honeypot", () => {
  it("pretends success for a filled website field and stores nothing", async () => {
    const res = await POST(makeRequest({ ...GOOD, website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, invite_code: "", invite_url: "", referrals: 0 });
    expect(rows()).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("rate limit", () => {
  it("allows 8 submits per IP in the window and 429s the ninth with Retry-After", async () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < 8; i++) {
      const res = await POST(makeRequest({ ...GOOD, email: `rl${i}@example.com` }, { ip }));
      expect(res.status, `submit ${i + 1}`).toBe(200);
    }
    const res = await POST(makeRequest({ ...GOOD, email: "rl9@example.com" }, { ip }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
    const retry = Number(res.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(600);
    expect(rows()).toHaveLength(8);
  });

  it("counts invalid submits against the limit too", async () => {
    const ip = "198.51.100.10";
    for (let i = 0; i < 8; i++) {
      await POST(makeRequest({ ...GOOD, email: "bad" }, { ip }));
    }
    const res = await POST(makeRequest(GOOD, { ip }));
    expect(res.status).toBe(429);
  });
});

describe("repeat submits", () => {
  it("returns the same invite code for the same email, case-insensitively", async () => {
    const first = (await (await POST(makeRequest(GOOD))).json()) as { invite_code: string };
    const second = (await (
      await POST(makeRequest({ ...GOOD, email: "ALICE@example.com" }))
    ).json()) as { invite_code: string };
    expect(second.invite_code).toBe(first.invite_code);
    expect(rows()).toHaveLength(1);
  });

  it("does not let a repeat submit overwrite name, country or phone", async () => {
    await POST(makeRequest(GOOD));
    await POST(makeRequest({ ...GOOD, first_name: "Mallory", country: "ru", phone: "+15550001111" }));
    const [row] = rows();
    expect(row).toMatchObject({ first_name: "Alice", country: "NZ", phone: "+0211234567" });
  });

  it("can raise consent but never lower it", async () => {
    await POST(makeRequest(GOOD));
    // consent is required by the route, so a repeat without consent is a 400 and leaves the row alone
    const res = await POST(makeRequest({ ...GOOD, consent: false }));
    expect(res.status).toBe(400);
    expect(rows()[0]!.consent).toBe(1);
  });

  it("does not push to HighLevel again once synced", async () => {
    await POST(makeRequest(GOOD));
    await POST(makeRequest(GOOD));
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it("retries the HighLevel push on a repeat submit when the first one failed", async () => {
    pushMock.mockResolvedValueOnce({ status: "failed", error: "ghl 500: boom" });
    await POST(makeRequest(GOOD));
    expect(rows()[0]).toMatchObject({ ghl_status: "failed", ghl_error: "ghl 500: boom", ghl_attempts: 1 });
    await POST(makeRequest(GOOD));
    expect(pushMock).toHaveBeenCalledTimes(2);
    expect(rows()[0]).toMatchObject({ ghl_status: "synced", ghl_error: null, ghl_attempts: 2 });
  });
});

describe("referrals", () => {
  async function signup(email: string, ref = ""): Promise<{ invite_code: string; referrals: number }> {
    const res = await POST(makeRequest({ ...GOOD, email, ref }));
    expect(res.status).toBe(200);
    return (await res.json()) as { invite_code: string; referrals: number };
  }

  it("attributes a new signup to a valid referral code and counts it for the referrer", async () => {
    const alice = await signup("alice@example.com");
    await signup("bob@example.com", alice.invite_code);
    const again = await signup("alice@example.com");
    expect(again.referrals).toBe(1);
    expect(rows()[1]!.referred_by_code).toBe(alice.invite_code);
  });

  it("ignores unknown, malformed and upper-case referral codes", async () => {
    await signup("a@example.com", "zzzzzzz");
    await signup("b@example.com", "ab");
    await signup("c@example.com", "ABCDEFG");
    await signup("d@example.com", "abc-defg");
    expect(rows().map((r) => r.referred_by_code)).toEqual([null, null, null, null]);
  });

  it("keeps first-touch attribution: a repeat submit cannot change who referred someone", async () => {
    const alice = await signup("alice@example.com");
    const carol = await signup("carol@example.com");
    await signup("bob@example.com", alice.invite_code);
    await signup("bob@example.com", carol.invite_code);
    expect(rows()[2]!.referred_by_code).toBe(alice.invite_code);
  });

  it("cannot attach a referral to an existing unreferred signup", async () => {
    await signup("bob@example.com");
    const mallory = await signup("mallory@example.com");
    const res = await signup("bob@example.com", mallory.invite_code);
    expect(res.referrals).toBe(0);
    expect(rows()[0]!.referred_by_code).toBeNull();
    expect((await signup("mallory@example.com")).referrals).toBe(0);
  });

  it("cannot self-refer by resubmitting with your own code", async () => {
    const alice = await signup("alice@example.com");
    const again = await signup("alice@example.com", alice.invite_code);
    expect(again.referrals).toBe(0);
    expect(rows()[0]!.referred_by_code).toBeNull();
  });
});

describe("storage failure", () => {
  it("answers 500 without leaking the error when the store throws", async () => {
    const store = await import("@/lib/register-interest/store");
    const spy = vi.spyOn(store, "upsertRegisterInterest").mockImplementationOnce(() => {
      throw new Error("disk full at /srv/secret/path");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(makeRequest(GOOD));
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toBe(JSON.stringify({ ok: false, error: "store_failed" }));
      expect(text).not.toContain("/srv");
    } finally {
      spy.mockRestore();
      err.mockRestore();
    }
  });
});
