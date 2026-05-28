import { describe, it, expect } from "vitest";
import {
  buildWarmInviteUrl,
  normalisePhone,
  parseCsvLine,
  parseInviteCsv,
  renderInviteMessage,
} from "@/lib/invite/parse-csv";

describe("parseCsvLine", () => {
  it("splits on commas", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("respects quoted commas", () => {
    expect(parseCsvLine('"a, comma",b,c')).toEqual(["a, comma", "b", "c"]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsvLine('"she said ""hi""",b')).toEqual(['she said "hi"', "b"]);
  });
});

describe("normalisePhone", () => {
  it("accepts E.164", () => {
    expect(normalisePhone("+6421535832")).toBe("+6421535832");
  });

  it("strips formatting", () => {
    expect(normalisePhone("+64 21 535 832")).toBe("+6421535832");
    expect(normalisePhone("(021) 535-832", "NZ")).toBe("+6421535832");
  });

  it("converts NZ local form", () => {
    expect(normalisePhone("0212345678", "NZ")).toBe("+64212345678");
  });

  it("converts AU local form", () => {
    expect(normalisePhone("0412345678", "AU")).toBe("+61412345678");
  });

  it("strips 00 international prefix", () => {
    expect(normalisePhone("006421535832")).toBe("+6421535832");
  });

  it("returns null for garbage", () => {
    expect(normalisePhone("hello")).toBeNull();
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("123")).toBeNull();
  });
});

describe("parseInviteCsv", () => {
  it("parses standard header + rows", () => {
    const csv = `first_name,email,phone
Alice,alice@example.com,+6421000001
Bob,bob@example.com,
Eve,,+6421000003`;
    const r = parseInviteCsv(csv);
    expect(r.contacts).toHaveLength(3);
    expect(r.contacts[0]).toMatchObject({
      firstName: "Alice",
      email: "alice@example.com",
      phoneE164: "+6421000001",
    });
    expect(r.contacts[2]).toMatchObject({ firstName: "Eve", email: null });
  });

  it("auto-detects loose header names", () => {
    const csv = `Given Name,Mobile,Mail
Charlie,02112345678,charlie@example.com`;
    const r = parseInviteCsv(csv);
    expect(r.contacts[0]).toMatchObject({
      firstName: "Charlie",
      phoneE164: "+642112345678",
      email: "charlie@example.com",
    });
  });

  it("skips rows with no email or phone", () => {
    const csv = `first_name,email,phone
Alice,,
Bob,bob@example.com,`;
    const r = parseInviteCsv(csv);
    expect(r.contacts).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({ reason: "no_contact" });
  });

  it("skips bad-email + bad-phone rows", () => {
    const csv = `first_name,email,phone
Alice,not-an-email,
Bob,bob@example.com,notaphone`;
    const r = parseInviteCsv(csv);
    expect(r.contacts).toHaveLength(0);
    expect(r.skipped.map((s) => s.reason)).toEqual(["bad_email", "bad_phone"]);
  });

  it("falls back to positional columns when header is missing", () => {
    const csv = `Alice,alice@example.com,+6421000001
Bob,bob@example.com,`;
    const r = parseInviteCsv(csv);
    expect(r.contacts).toHaveLength(2);
    expect(r.contacts[0].firstName).toBe("Alice");
  });

  it("respects maxRows cap", () => {
    const lines = ["first_name,email,phone"];
    for (let i = 0; i < 10; i += 1) {
      lines.push(`User${i},user${i}@example.com,`);
    }
    const r = parseInviteCsv(lines.join("\n"), { maxRows: 5 });
    expect(r.contacts).toHaveLength(5);
  });
});

describe("buildWarmInviteUrl", () => {
  it("renders firstname / mobile / email as warm-invite params", () => {
    const url = buildWarmInviteUrl({
      slug: "the-crate",
      contact: {
        firstName: "Tim",
        phoneE164: "+6421535832",
        email: "tim@tournamental.com",
      },
      origin: "https://play.tournamental.com",
    });
    expect(url).toContain("/s/the-crate/join?");
    expect(url).toContain("firstname=Tim");
    expect(url).toContain("mobile=%2B6421535832");
    expect(url).toContain("email=tim%40tournamental.com");
  });

  it("omits unset params", () => {
    const url = buildWarmInviteUrl({
      slug: "p1",
      contact: { firstName: null, phoneE164: "+6421000001", email: null },
    });
    expect(url).toMatch(/^https:\/\/play\.tournamental\.com\/s\/p1\/join\?mobile=%2B6421000001$/);
  });

  it("appends ref when provided", () => {
    const url = buildWarmInviteUrl({
      slug: "p1",
      contact: { firstName: null, phoneE164: "+1", email: null },
      ref: "csv-2026-05-29",
    });
    expect(url).toContain("ref=csv-2026-05-29");
  });
});

describe("renderInviteMessage", () => {
  it("substitutes all variables", () => {
    const out = renderInviteMessage({
      template: "Hi {{first_name}}, join {{pool_name}} ({{owner_name}}): {{join_url}}",
      firstName: "Tim",
      poolName: "The Crate",
      ownerName: "0800tim",
      joinUrl: "https://example.com/x",
    });
    expect(out).toBe("Hi Tim, join The Crate (0800tim): https://example.com/x");
  });

  it("appends the URL when the template forgets it", () => {
    const out = renderInviteMessage({
      template: "Hey {{first_name}}, come join!",
      firstName: "Tim",
      poolName: "The Crate",
      ownerName: "0800tim",
      joinUrl: "https://example.com/x",
    });
    expect(out).toContain("https://example.com/x");
  });

  it("falls back when first_name is null", () => {
    const out = renderInviteMessage({
      template: "Hey {{first_name}}, click {{join_url}}",
      firstName: null,
      poolName: "p",
      ownerName: "o",
      joinUrl: "u",
    });
    expect(out).toContain("Hey there,");
  });

  it("truncates to maxChars", () => {
    const out = renderInviteMessage({
      template: "x".repeat(2000) + "{{join_url}}",
      firstName: null,
      poolName: "p",
      ownerName: "o",
      joinUrl: "u",
      maxChars: 100,
    });
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("…")).toBe(true);
  });
});
