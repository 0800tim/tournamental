import { describe, expect, it } from "vitest";

import { loadAuthConfig } from "../src/auth.js";

describe("loadAuthConfig", () => {
  it("reads the key and default base URL from env", () => {
    const cfg = loadAuthConfig({
      TOURNAMENTAL_API_KEY: "tnm_abcdefgh12345678",
    });
    expect(cfg.apiKey).toBe("tnm_abcdefgh12345678");
    expect(cfg.baseUrl).toBe("https://api.tournamental.com");
  });

  it("honours an override base URL and strips trailing slashes", () => {
    const cfg = loadAuthConfig({
      TOURNAMENTAL_API_KEY: "tnm_abcdefgh12345678",
      TOURNAMENTAL_BASE_URL: "https://api.tournamental.test/",
    });
    expect(cfg.baseUrl).toBe("https://api.tournamental.test");
  });

  it("throws a helpful error if the key is missing", () => {
    expect(() => loadAuthConfig({})).toThrow(/TOURNAMENTAL_API_KEY/);
  });

  it("throws if the key looks malformed", () => {
    expect(() =>
      loadAuthConfig({ TOURNAMENTAL_API_KEY: "short" }),
    ).toThrow(/malformed/);
  });
});
