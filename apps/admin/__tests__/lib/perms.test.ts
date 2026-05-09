import { describe, it, expect } from "vitest";
import { can, parseAllowlist, parseRoleMap, roleFor } from "@/lib/perms";

describe("perms", () => {
  it("super-admin can do everything", () => {
    expect(can("super-admin", "users.ban")).toBe(true);
    expect(can("super-admin", "feature-flags.write")).toBe(true);
    expect(can("super-admin", "api-keys.revoke")).toBe(true);
    expect(can("super-admin", "settings.write")).toBe(true);
  });

  it("mod can ban but not toggle flags", () => {
    expect(can("mod", "users.ban")).toBe(true);
    expect(can("mod", "feature-flags.write")).toBe(false);
    expect(can("mod", "api-keys.revoke")).toBe(false);
  });

  it("viewer can only read", () => {
    expect(can("viewer", "users.read")).toBe(true);
    expect(can("viewer", "users.ban")).toBe(false);
    expect(can("viewer", "content.moderate")).toBe(false);
  });

  it("undefined role denies everything", () => {
    expect(can(undefined, "users.read")).toBe(false);
  });

  it("parseAllowlist normalises and ignores empties", () => {
    const set = parseAllowlist(" Tim@VTOURN.com, ,ops@vtourn.com ");
    expect(set.has("tim@vtourn.com")).toBe(true);
    expect(set.has("ops@vtourn.com")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("parseRoleMap accepts only valid roles", () => {
    const m = parseRoleMap("a@x.com:mod,b@x.com:super-admin,c@x.com:bogus");
    expect(m.get("a@x.com")).toBe("mod");
    expect(m.get("b@x.com")).toBe("super-admin");
    expect(m.has("c@x.com")).toBe(false);
  });

  it("roleFor returns undefined when not allowlisted", () => {
    const allow = parseAllowlist("a@x.com");
    const map = parseRoleMap("a@x.com:super-admin");
    expect(roleFor("b@x.com", allow, map)).toBeUndefined();
  });

  it("roleFor defaults to viewer when allowlisted but unmapped", () => {
    const allow = parseAllowlist("a@x.com");
    const map = parseRoleMap("");
    expect(roleFor("a@x.com", allow, map)).toBe("viewer");
  });
});
