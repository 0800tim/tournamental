/**
 * The two audited reveal routes. Session, data sources and the audit
 * writer are mocked; no HighLevel or crm-bridge calls, no real
 * customer data.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const writeAudit = vi.fn(async () => {});
let session: { userId: string; email: string; role: string } | null = { userId: "u_op", email: "+64****5832", role: "super-admin" };

vi.mock("@/lib/auth", () => ({ readSession: async () => session }));
vi.mock("@/lib/audit", () => ({ writeAudit }));
vi.mock("@/lib/customer360", () => ({
  fetchCustomer360: async (userId: string) => ({
    crmContact: userId === "u_42" ? { userId, email: "user42@example.test", phone: "+6421535832" } : null,
  }),
}));
vi.mock("@/lib/highlevel", () => ({
  isHighLevelConfigured: () => true,
  fetchContactsSnapshot: async () => ({ recent: [{ id: "hl1", name: "Test", email: "lead@example.test", phone: null, tags: [] }] }),
}));

function post(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://admin.local${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", "user-agent": "UA/1", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  writeAudit.mockClear();
  session = { userId: "u_op", email: "+64****5832", role: "super-admin" };
});

describe("POST /api/users/:id/reveal", () => {
  it("returns 401 without a session and writes nothing", async () => {
    session = null;
    const { POST } = await import("@/app/api/users/[id]/reveal/route");
    const r = await POST(post("/api/users/u_42/reveal", { kind: "email" }), { params: Promise.resolve({ id: "u_42" }) });
    expect(r.status).toBe(401);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects an unknown kind before touching data", async () => {
    const { POST } = await import("@/app/api/users/[id]/reveal/route");
    const r = await POST(post("/api/users/u_42/reveal", { kind: "ssn" }), { params: Promise.resolve({ id: "u_42" }) });
    expect(r.status).toBe(400);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("writes an audit entry with ip and user agent, then returns the value", async () => {
    const { POST } = await import("@/app/api/users/[id]/reveal/route");
    const r = await POST(post("/api/users/u_42/reveal", { kind: "phone" }), { params: Promise.resolve({ id: "u_42" }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, kind: "phone", value: "+6421535832" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u_op" }),
      expect.objectContaining({ action: "pii.reveal", target: "u_42", reason: "phone" }),
      { ip: "203.0.113.9", userAgent: "UA/1" },
    );
  });

  it("still audits an attempt on a user with no CRM contact and returns null", async () => {
    const { POST } = await import("@/app/api/users/[id]/reveal/route");
    const r = await POST(post("/api/users/u_none/reveal", { kind: "email" }), { params: Promise.resolve({ id: "u_none" }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, kind: "email", value: null });
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/highlevel/contacts/:id/reveal", () => {
  it("finds the contact in the snapshot, audits with the hl: target and returns the value", async () => {
    const { POST } = await import("@/app/api/highlevel/contacts/[id]/reveal/route");
    const r = await POST(post("/api/highlevel/contacts/hl1/reveal", { kind: "email" }), { params: Promise.resolve({ id: "hl1" }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, kind: "email", value: "lead@example.test" });
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ target: "hl:hl1", reason: "email" }), expect.objectContaining({ ip: "203.0.113.9" }));
  });

  it("audits and 404s for an unknown contact", async () => {
    const { POST } = await import("@/app/api/highlevel/contacts/[id]/reveal/route");
    const r = await POST(post("/api/highlevel/contacts/nope/reveal", { kind: "email" }), { params: Promise.resolve({ id: "nope" }) });
    expect(r.status).toBe(404);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });
});
