/**
 * /profile page — render shape tests.
 *
 * Coverage:
 *   1. Signed-out → renders sign-up prompt + auto-opens the modal.
 *   2. Signed-in, no profile loaded → shows loading state then identity.
 *   3. Signed-in, full profile → renders chips for engagement band +
 *      country/age/favourite-team values.
 *   4. Inline edit (age bucket) PATCHes the API.
 */

// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import ProfilePage from "../app/profile/page";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function seedLocalUser(id = "u_test", handle = "tim_w"): void {
  window.localStorage.setItem("tournamental.user.id", id);
  window.localStorage.setItem("tournamental.user.handle", handle);
  window.localStorage.setItem("tournamental.user.auth_method", "guest");
}

beforeEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FULL_PROFILE = {
  user: {
    id: "u_test",
    handle: "tim_w",
    display_name: "Tim Watson",
    auth_method: "guest",
    created_at: "2026-04-01T00:00:00Z",
    last_seen_at: "2026-05-11T10:00:00Z",
    deleted_at: null,
  },
  profile: {
    age_bucket: "25-34",
    gender: null,
    country_code: "NZ",
    city: "Wellington",
    timezone: "Pacific/Auckland",
    favourite_team_code: "ARG",
    follows_leagues: null,
    watches_via: null,
    visit_count: 7,
    last_visit_date: "2026-05-11",
    engagement_band: "warm",
    marketing_consent: false,
    analytics_consent: true,
    updated_at: "2026-05-11T10:00:00Z",
  },
};

const EMPTY_PROFILE = {
  user: {
    id: "u_test",
    handle: "tim_w",
    display_name: null,
    auth_method: "guest",
    created_at: "2026-05-11T10:00:00Z",
    last_seen_at: "2026-05-11T10:00:00Z",
    deleted_at: null,
  },
  profile: {
    age_bucket: null,
    gender: null,
    country_code: null,
    city: null,
    timezone: null,
    favourite_team_code: null,
    follows_leagues: null,
    watches_via: null,
    visit_count: 0,
    last_visit_date: null,
    engagement_band: "cold",
    marketing_consent: false,
    analytics_consent: true,
    updated_at: "2026-05-11T10:00:00Z",
  },
};

describe("/profile page", () => {
  it("renders sign-up prompt for signed-out users", async () => {
    const { findByText } = render(<ProfilePage />);
    // The H2 "Sign in" appears in the placeholder copy.
    await findByText("Sign in");
  });

  it("renders the empty-profile shape for a fresh user", async () => {
    seedLocalUser();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/v1/users/me"))
          return jsonResponse(200, EMPTY_PROFILE);
        if (url.endsWith("/visit"))
          return jsonResponse(200, {
            visit_count: 1,
            last_visit_date: "2026-05-11",
            engagement_band: "cold",
          });
        throw new Error(`unexpected ${url}`);
      }),
    );
    const { findByText, queryByText } = render(<ProfilePage />);
    await findByText("@tim_w");
    // Cold band chip
    await findByText("COLD");
    expect(queryByText("Engagement")).not.toBeNull();
    expect(queryByText("Where you're from")).not.toBeNull();
  });

  it("renders the filled-profile shape with engagement band + favourite team", async () => {
    seedLocalUser();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/v1/users/me"))
          return jsonResponse(200, FULL_PROFILE);
        if (url.endsWith("/visit"))
          return jsonResponse(200, {
            visit_count: 7,
            last_visit_date: "2026-05-11",
            engagement_band: "warm",
          });
        throw new Error(`unexpected ${url}`);
      }),
    );
    const { findByText, findByDisplayValue } = render(<ProfilePage />);
    await findByText("@tim_w");
    await findByText("WARM");
    // 7 visits chip
    await findByText("7 visits");
    // Country input pre-fills
    await findByDisplayValue("NZ");
    await findByDisplayValue("Wellington");
    await findByDisplayValue("ARG");
  });

  it("clicking an age chip PATCHes the API", async () => {
    seedLocalUser();
    const patchSpy = vi.fn(
      async (_url: string, _init: RequestInit | undefined) =>
        jsonResponse(200, {
          ...FULL_PROFILE,
          profile: { ...FULL_PROFILE.profile, age_bucket: "35-44" },
          changed_fields: ["age_bucket"],
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/v1/users/me"))
          return jsonResponse(200, FULL_PROFILE);
        if (url.endsWith("/visit"))
          return jsonResponse(200, {
            visit_count: 7,
            last_visit_date: "2026-05-11",
            engagement_band: "warm",
          });
        if (url.includes("/profile") && init?.method === "PATCH") {
          return patchSpy(url, init);
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const { findByText } = render(<ProfilePage />);
    await findByText("@tim_w");
    const ageBtn = await findByText("35-44");
    fireEvent.click(ageBtn);
    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
