import { describe, it, expect } from "vitest";
import { familyForLocale, isRtl } from "../src/fonts.js";

describe("fonts: familyForLocale", () => {
  it("returns Inter for en/es/pt/fr/und", () => {
    expect(familyForLocale("en")).toBe("Inter");
    expect(familyForLocale("es")).toBe("Inter");
    expect(familyForLocale("pt-BR")).toBe("Inter");
    expect(familyForLocale("fr")).toBe("Inter");
    expect(familyForLocale(undefined)).toBe("Inter");
    expect(familyForLocale("")).toBe("Inter");
  });

  it("returns NotoNaskhArabic for ar/fa/ur (any case)", () => {
    expect(familyForLocale("ar")).toBe("NotoNaskhArabic");
    expect(familyForLocale("AR-EG")).toBe("NotoNaskhArabic");
    expect(familyForLocale("fa-IR")).toBe("NotoNaskhArabic");
    expect(familyForLocale("ur")).toBe("NotoNaskhArabic");
  });

  it("returns NotoSansJP for ja", () => {
    expect(familyForLocale("ja")).toBe("NotoSansJP");
    expect(familyForLocale("ja-JP")).toBe("NotoSansJP");
  });
});

describe("fonts: isRtl", () => {
  it("flags ar/fa/he/ur as RTL", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("fa-IR")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("ur")).toBe(true);
  });

  it("returns false for LTR or missing locale", () => {
    expect(isRtl("en")).toBe(false);
    expect(isRtl(undefined)).toBe(false);
    expect(isRtl("")).toBe(false);
    expect(isRtl("ja")).toBe(false);
  });
});
