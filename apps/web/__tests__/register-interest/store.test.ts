/**
 * lib/register-interest/store.ts against a throwaway SQLite file.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { vi } from "vitest";

const tmp = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnm-ri-store-"));
  const dbPath = path.join(dir, "game.db");
  fs.writeFileSync(dbPath, "");
  process.env.VTORN_GAME_DB_PATH = dbPath;
  process.env.TOURNAMENTAL_INTERNAL_SECRET = "store-test-salt";
  return { dir };
});

import {
  deleteRegisterInterest,
  __resetHashIpWarning,
  hashIp,
  inviteCodeExists,
  newInviteCode,
  markGhl,
  referralCount,
  registerInterestDb,
  upsertRegisterInterest,
  type RegisterInterestInput,
} from "@/lib/register-interest/store";

const BASE: RegisterInterestInput = {
  tournament_id: "rwc-2027",
  email: "alice@example.com",
  first_name: "Alice",
  country: "NZ",
  phone: "+64211234567",
  consent: true,
  source_host: "play.tournamental.com",
  source_path: "/",
  referred_by_code: null,
  ip: "203.0.113.5",
  user_agent: "vitest",
};

beforeEach(() => {
  registerInterestDb()!.exec("DELETE FROM register_interest");
});

afterAll(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  fs.rmSync(tmp.dir, { recursive: true, force: true });
});

describe("newInviteCode", () => {
  it("is 7 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(newInviteCode()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{7}$/);
    }
    expect(newInviteCode(12)).toHaveLength(12);
  });

  it("does not repeat across a few thousand draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(newInviteCode());
    expect(seen.size).toBe(5000);
  });

  it("uses every alphabet character, so rejection sampling does not starve any", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) for (const ch of newInviteCode()) seen.add(ch);
    expect(seen.size).toBe(31);
  });
});

describe("hashIp without a configured salt", () => {
  it("still hashes, and warns once per process", () => {
    const saved = process.env.TOURNAMENTAL_INTERNAL_SECRET;
    delete process.env.TOURNAMENTAL_INTERNAL_SECRET;
    __resetHashIpWarning();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const a = hashIp("203.0.113.5");
      const b = hashIp("203.0.113.6");
      expect(a).toMatch(/^[0-9a-f]{32}$/);
      expect(b).not.toBe(a);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      process.env.TOURNAMENTAL_INTERNAL_SECRET = saved;
      __resetHashIpWarning();
    }
  });
});

describe("hashIp", () => {
  it("salts with the internal secret and never stores the raw address", () => {
    const h = hashIp("203.0.113.5");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203");
    expect(hashIp("203.0.113.5")).toBe(h);
    expect(hashIp("203.0.113.6")).not.toBe(h);
    expect(hashIp(null)).toBeNull();
  });
});

describe("upsertRegisterInterest", () => {
  it("creates a row with a hashed IP and a queued CRM status", () => {
    const r = upsertRegisterInterest(BASE)!;
    expect(r.created).toBe(true);
    expect(r.row.id).toMatch(/^ri_[0-9a-f]{18}$/);
    expect(r.row.ghl_status).toBe("queued");
    expect(r.row.invite_code).toHaveLength(7);
    const raw = registerInterestDb()!
      .prepare("SELECT ip_hash, user_agent FROM register_interest WHERE id = ?")
      .get(r.row.id) as { ip_hash: string; user_agent: string };
    expect(raw.ip_hash).toBe(hashIp("203.0.113.5"));
    expect(raw.user_agent).toBe("vitest");
  });

  it("truncates the user agent to 300 characters", () => {
    const r = upsertRegisterInterest({ ...BASE, user_agent: "u".repeat(1000) })!;
    const raw = registerInterestDb()!
      .prepare("SELECT user_agent FROM register_interest WHERE id = ?")
      .get(r.row.id) as { user_agent: string };
    expect(raw.user_agent).toHaveLength(300);
  });

  it("is idempotent per tournament and email", () => {
    const a = upsertRegisterInterest(BASE)!;
    const b = upsertRegisterInterest(BASE)!;
    expect(b.created).toBe(false);
    expect(b.row.id).toBe(a.row.id);
    expect(b.row.invite_code).toBe(a.row.invite_code);
  });

  it("keeps the same email separate per tournament", () => {
    const a = upsertRegisterInterest(BASE)!;
    const b = upsertRegisterInterest({ ...BASE, tournament_id: "fwc-2030" })!;
    expect(b.created).toBe(true);
    expect(b.row.invite_code).not.toBe(a.row.invite_code);
  });

  it("never changes stored PII or attribution on a repeat, and only raises consent", () => {
    const first = upsertRegisterInterest({ ...BASE, consent: false })!;
    const referrer = upsertRegisterInterest({ ...BASE, email: "ref@example.com" })!;
    const again = upsertRegisterInterest({
      ...BASE,
      first_name: "Mallory",
      country: "RU",
      phone: "+15550001111",
      consent: true,
      referred_by_code: referrer.row.invite_code,
    })!;
    expect(again.created).toBe(false);
    expect(again.row).toMatchObject({
      first_name: "Alice",
      country: "NZ",
      phone: "+64211234567",
      consent: 1,
      referred_by_code: null,
    });
    expect(again.row.updated_at).toBeGreaterThanOrEqual(first.row.updated_at);
    const lowered = upsertRegisterInterest({ ...BASE, consent: false })!;
    expect(lowered.row.consent).toBe(1);
  });

  it("stores first-touch attribution on creation", () => {
    const referrer = upsertRegisterInterest({ ...BASE, email: "ref@example.com" })!;
    const r = upsertRegisterInterest({
      ...BASE,
      email: "new@example.com",
      referred_by_code: referrer.row.invite_code,
    })!;
    expect(r.row.referred_by_code).toBe(referrer.row.invite_code);
    expect(referralCount(referrer.row.invite_code)).toBe(1);
    expect(referralCount("nope")).toBe(0);
  });
});

describe("inviteCodeExists and markGhl", () => {
  it("knows real codes from guesses", () => {
    const r = upsertRegisterInterest(BASE)!;
    expect(inviteCodeExists(r.row.invite_code)).toBe(true);
    expect(inviteCodeExists("abcdefg")).toBe(false);
  });

  it("records CRM outcomes, keeps the contact id and truncates errors", () => {
    const r = upsertRegisterInterest(BASE)!;
    markGhl(r.row.id, "failed", null, "x".repeat(1000));
    let row = registerInterestDb()!
      .prepare("SELECT * FROM register_interest WHERE id = ?")
      .get(r.row.id) as Record<string, unknown>;
    expect(row.ghl_status).toBe("failed");
    expect((row.ghl_error as string).length).toBe(300);
    expect(row.ghl_attempts).toBe(1);
    markGhl(r.row.id, "synced", "c_9", null);
    markGhl(r.row.id, "synced", null, null);
    row = registerInterestDb()!
      .prepare("SELECT * FROM register_interest WHERE id = ?")
      .get(r.row.id) as Record<string, unknown>;
    expect(row).toMatchObject({ ghl_status: "synced", ghl_contact_id: "c_9", ghl_error: null, ghl_attempts: 3 });
  });
});

describe("deleteRegisterInterest", () => {
  it("removes exactly the person's row for that tournament", () => {
    upsertRegisterInterest(BASE);
    upsertRegisterInterest({ ...BASE, tournament_id: "fwc-2030" });
    upsertRegisterInterest({ ...BASE, email: "other@example.com" });
    expect(deleteRegisterInterest("rwc-2027", " ALICE@example.com ")).toBe(1);
    expect(deleteRegisterInterest("rwc-2027", "alice@example.com")).toBe(0);
    const left = registerInterestDb()!
      .prepare("SELECT tournament_id, email FROM register_interest ORDER BY email")
      .all();
    expect(left).toEqual([
      { tournament_id: "fwc-2030", email: "alice@example.com" },
      { tournament_id: "rwc-2027", email: "other@example.com" },
    ]);
  });
});
