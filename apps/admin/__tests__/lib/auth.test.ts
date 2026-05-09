// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock next/headers BEFORE importing auth (which calls cookies()/headers()).
const cookieStore = new Map<string, { name: string; value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (k: string) => cookieStore.get(k),
    set: (c: { name: string; value: string }) => cookieStore.set(c.name, c),
  }),
  headers: () => ({ get: (_k: string) => null }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const e: any = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  },
}));

import {
  createMagicLink,
  isLoginEnabled,
  readSession,
  verifyMagicLink,
  issueSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";

describe("auth", () => {
  beforeEach(() => {
    cookieStore.clear();
    process.env.ADMIN_JWT_SECRET = "test-secret-test-secret-test-secret-12345";
    process.env.ADMIN_EMAILS = "tim@vtourn.com,ops@vtourn.com";
    process.env.ADMIN_ROLES = "tim@vtourn.com:super-admin,ops@vtourn.com:mod";
    process.env.ADMIN_BASE_URL = "http://localhost:3340";
  });

  it("isLoginEnabled is false when ADMIN_EMAILS is empty", () => {
    process.env.ADMIN_EMAILS = "";
    expect(isLoginEnabled()).toBe(false);
  });

  it("isLoginEnabled is true with at least one allowlisted email", () => {
    expect(isLoginEnabled()).toBe(true);
  });

  it("createMagicLink returns null for non-allowlisted email", async () => {
    const r = await createMagicLink("hacker@evil.com");
    expect(r).toBeNull();
  });

  it("createMagicLink + verifyMagicLink round-trip yields a session", async () => {
    const link = await createMagicLink("Tim@vtourn.com");
    expect(link).not.toBeNull();
    const url = new URL(link!.url);
    const token = url.searchParams.get("token")!;
    const session = await verifyMagicLink(token);
    expect(session).not.toBeNull();
    expect(session!.email).toBe("tim@vtourn.com");
    expect(session!.role).toBe("super-admin");
  });

  it("verifyMagicLink rejects garbage", async () => {
    expect(await verifyMagicLink("not-a-jwt")).toBeNull();
  });

  it("verifyMagicLink rejects a token whose email is no longer allowlisted", async () => {
    const link = await createMagicLink("ops@vtourn.com");
    const token = new URL(link!.url).searchParams.get("token")!;
    process.env.ADMIN_EMAILS = "tim@vtourn.com";
    const r = await verifyMagicLink(token);
    expect(r).toBeNull();
  });

  it("issueSessionCookie + readSession round-trip", async () => {
    const session = await verifyMagicLink(
      new URL((await createMagicLink("tim@vtourn.com"))!.url).searchParams.get("token")!,
    );
    const jwt = await issueSessionCookie(session!);
    cookieStore.set(SESSION_COOKIE_NAME, { name: SESSION_COOKIE_NAME, value: jwt });
    const read = await readSession();
    expect(read).not.toBeNull();
    expect(read!.email).toBe("tim@vtourn.com");
    expect(read!.role).toBe("super-admin");
  });

  it("readSession returns null when no cookie", async () => {
    expect(await readSession()).toBeNull();
  });

  it("readSession returns null on tampered cookie", async () => {
    cookieStore.set(SESSION_COOKIE_NAME, { name: SESSION_COOKIE_NAME, value: "a.b.c" });
    expect(await readSession()).toBeNull();
  });
});
