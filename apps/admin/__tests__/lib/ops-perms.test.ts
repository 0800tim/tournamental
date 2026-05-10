import { describe, it, expect } from "vitest";
import { can } from "@/lib/perms";

describe("ops dashboard perms", () => {
  it("viewer can read operators and advertisers but not write", () => {
    expect(can("viewer", "operators.read")).toBe(true);
    expect(can("viewer", "advertisers.read")).toBe(true);
    expect(can("viewer", "revenue.read")).toBe(true);
    expect(can("viewer", "operators.write")).toBe(false);
    expect(can("viewer", "advertisers.write")).toBe(false);
  });

  it("mod can read but not write operator/advertiser data", () => {
    expect(can("mod", "operators.read")).toBe(true);
    expect(can("mod", "advertisers.read")).toBe(true);
    expect(can("mod", "operators.write")).toBe(false);
    expect(can("mod", "advertisers.write")).toBe(false);
  });

  it("super-admin can write operators and advertisers", () => {
    expect(can("super-admin", "operators.write")).toBe(true);
    expect(can("super-admin", "advertisers.write")).toBe(true);
  });
});
