/**
 * Vitest, analytics SDK contract.
 *
 *  - No-op when NEXT_PUBLIC_GTM_ID is unset (Tim's container is
 *    still pending; module must stay silent).
 *  - With a configured GTM_ID, every call pushes the right envelope
 *    shape to window.dataLayer.
 *  - setUserProperties wraps the payload in the GA4 user_properties
 *    field.
 *  - identifyUser pre-hashes the uuid to a stable 16-char prefix.
 *  - setConsent uses GTM's canonical envelope name `consent_update`.
 *  - track() with invalid window.dataLayer.push throws are swallowed.
 *
 * The module reads NEXT_PUBLIC_GTM_ID lazily via `getGtmId()`, so we
 * mutate `process.env` between cases without `vi.resetModules()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  identifyUser,
  pseudoHash,
  setConsent,
  setUserProperties,
  track,
} from "@/lib/analytics";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

function getPushes(): unknown[] {
  return (window.dataLayer ?? []) as unknown[];
}

const ORIGINAL_GTM = process.env.NEXT_PUBLIC_GTM_ID;

beforeEach(() => {
  // Fresh dataLayer per test.
  (window as Window).dataLayer = [];
  // Tests opt-in to "GTM configured" mode by setting this in-case;
  // default is "unset".
  delete process.env.NEXT_PUBLIC_GTM_ID;
});

afterEach(() => {
  if (ORIGINAL_GTM === undefined) {
    delete process.env.NEXT_PUBLIC_GTM_ID;
  } else {
    process.env.NEXT_PUBLIC_GTM_ID = ORIGINAL_GTM;
  }
});

describe("analytics.track (no GTM)", () => {
  it("is a no-op when NEXT_PUBLIC_GTM_ID is unset", () => {
    track("page.view", { path: "/foo" });
    expect(getPushes()).toEqual([]);
  });

  it("is a no-op when NEXT_PUBLIC_GTM_ID is an empty string", () => {
    process.env.NEXT_PUBLIC_GTM_ID = "";
    track("page.view", { path: "/foo" });
    expect(getPushes()).toEqual([]);
  });

  it("is a no-op when NEXT_PUBLIC_GTM_ID is whitespace-laden", () => {
    process.env.NEXT_PUBLIC_GTM_ID = "GTM with spaces";
    track("page.view", { path: "/foo" });
    expect(getPushes()).toEqual([]);
  });
});

describe("analytics.track (GTM configured)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_GTM_ID = "GTM-TESTING";
  });

  it("pushes a tournamental-prefixed envelope with the payload merged in", () => {
    track("bracket.pick.saved", { match_id: "m_42", count: 7 });
    expect(getPushes()).toEqual([
      {
        event: "tournamental.bracket.pick.saved",
        match_id: "m_42",
        count: 7,
      },
    ]);
  });

  it("accepts an empty payload", () => {
    track("nav.menu.opened");
    expect(getPushes()).toEqual([{ event: "tournamental.nav.menu.opened" }]);
  });

  it("setUserProperties wraps fields in the user_properties envelope", () => {
    setUserProperties({
      country_code: "NZ",
      engagement_band: "warm",
      is_pundit: false,
    });
    expect(getPushes()).toEqual([
      {
        event: "tournamental.user.properties",
        user_properties: {
          country_code: "NZ",
          engagement_band: "warm",
          is_pundit: false,
        },
      },
    ]);
  });

  it("identifyUser pushes a stable 16-char hash, never the raw uuid", () => {
    const uuid = "f81d4fae-7dec-11d0-a765-00a0c91e6bf6";
    identifyUser(uuid);
    const pushes = getPushes() as Array<Record<string, unknown>>;
    expect(pushes).toHaveLength(1);
    expect(pushes[0].event).toBe("tournamental.user.identified");
    expect(typeof pushes[0].user_id).toBe("string");
    expect((pushes[0].user_id as string).length).toBe(16);
    expect(pushes[0].user_id).not.toContain(uuid.slice(0, 8));
    // Stable across calls.
    expect(pseudoHash(uuid)).toBe(pushes[0].user_id);
  });

  it("identifyUser(null) pushes a cleared envelope", () => {
    identifyUser(null);
    expect(getPushes()).toEqual([
      { event: "tournamental.user.cleared", user_id: null },
    ]);
  });

  it("setConsent pushes the GA4 consent envelope plus a tournamental event", () => {
    setConsent({
      analytics_storage: "granted",
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    });
    const pushes = getPushes() as Array<Record<string, unknown>>;
    expect(pushes).toHaveLength(2);
    expect(pushes[0]).toEqual({
      event: "consent_update",
      analytics_storage: "granted",
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    });
    expect(pushes[1].event).toBe("tournamental.consent.changed");
  });

  it("setConsent defaults to analytics-on / ads-off when fields omitted", () => {
    setConsent({});
    const first = (getPushes()[0] ?? {}) as Record<string, unknown>;
    expect(first.event).toBe("consent_update");
    expect(first.analytics_storage).toBe("granted");
    expect(first.ad_storage).toBe("denied");
    expect(first.ad_user_data).toBe("denied");
    expect(first.ad_personalization).toBe("denied");
  });

  it("swallows errors from a broken dataLayer.push", () => {
    // Build an array whose `.push` throws, `Array.isArray()` still
    // returns true so isPushable() proceeds to .push(), which throws.
    const broken = [] as unknown as unknown[];
    Object.defineProperty(broken, "push", {
      value: () => {
        throw new Error("explode");
      },
    });
    (window as Window).dataLayer = broken;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => track("page.view")).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("pseudoHash", () => {
  it("is stable across calls", () => {
    expect(pseudoHash("hello")).toBe(pseudoHash("hello"));
  });

  it("produces 16 hex chars regardless of input length", () => {
    expect(pseudoHash("")).toHaveLength(16);
    expect(pseudoHash("a")).toHaveLength(16);
    expect(pseudoHash("a-very-long-uuid-here-1234567890")).toHaveLength(16);
  });

  it("returns different values for different inputs", () => {
    expect(pseudoHash("alice")).not.toBe(pseudoHash("bob"));
  });
});
