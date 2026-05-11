import { describe, expect, it } from "vitest";
import {
  ALLOWED_LICENSES,
  ManifestError,
  validateManifest,
  type PluginManifest,
} from "../src/manifest.js";

const baseManifest: PluginManifest = {
  name: "@tournamental-plugin/example",
  version: "0.1.0",
  description: "An example plugin used for tests.",
  sdkRange: "^0.1.0",
  provides: ["renderer"],
  license: "Apache-2.0",
};

describe("validateManifest", () => {
  it("accepts a minimal Apache-2.0 manifest", () => {
    const parsed = validateManifest({ ...baseManifest });
    expect(parsed.name).toBe("@tournamental-plugin/example");
    expect(parsed.license).toBe("Apache-2.0");
  });

  it("accepts each of the four allowed licences", () => {
    for (const license of ALLOWED_LICENSES) {
      const parsed = validateManifest({ ...baseManifest, license });
      expect(parsed.license).toBe(license);
    }
  });

  it("rejects AGPL with a clear error", () => {
    expect(() =>
      validateManifest({ ...baseManifest, license: "AGPL-3.0" }),
    ).toThrowError(ManifestError);
  });

  it("rejects proprietary licences", () => {
    expect(() => validateManifest({ ...baseManifest, license: "UNLICENSED" })).toThrowError(
      ManifestError,
    );
  });

  it("requires at least one capability", () => {
    expect(() => validateManifest({ ...baseManifest, provides: [] })).toThrowError(
      ManifestError,
    );
  });

  it("rejects an unknown capability", () => {
    expect(() =>
      validateManifest({ ...baseManifest, provides: ["something-made-up"] }),
    ).toThrowError(ManifestError);
  });

  it("rejects malformed semver", () => {
    expect(() => validateManifest({ ...baseManifest, version: "not-semver" })).toThrowError(
      ManifestError,
    );
  });

  it("accepts a manifest with a Drips reference", () => {
    const parsed = validateManifest({
      ...baseManifest,
      dripsListRef: "drips:base:0x1234abcd",
    });
    expect(parsed.dripsListRef).toBe("drips:base:0x1234abcd");
  });

  it("rejects a malformed Drips reference", () => {
    expect(() =>
      validateManifest({ ...baseManifest, dripsListRef: "drips-only" }),
    ).toThrowError(ManifestError);
  });

  it("rejects unknown top-level fields (strict mode)", () => {
    expect(() =>
      validateManifest({ ...baseManifest, randomExtraField: "nope" }),
    ).toThrowError(ManifestError);
  });

  it("validates author wallet shape", () => {
    expect(() =>
      validateManifest({
        ...baseManifest,
        author: { name: "Test", wallet: "not-an-address" },
      }),
    ).toThrowError(ManifestError);
  });
});
