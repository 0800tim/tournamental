/**
 * SignupModal — happy path and skippable Step 2.
 *
 * Coverage:
 *   1. Step 1 validates handle pattern; Continue disabled until valid.
 *   2. Step 1 happy path POSTs /v1/users/register, advances to Step 2.
 *   3. Step 2 "Skip for now" closes the modal and fires onComplete.
 *   4. Step 2 "Finish" PATCHes the chosen fields.
 */

// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import { SignupModal } from "../components/auth/SignupModal";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<SignupModal>", () => {
  it("Continue is disabled until the handle matches the pattern", () => {
    const onClose = vi.fn();
    const fetchImpl = vi.fn();
    const { getByPlaceholderText, getByText } = render(
      <SignupModal
        open
        onClose={onClose}
        baseUrl="http://test"
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );
    const input = getByPlaceholderText("your_handle") as HTMLInputElement;
    const continueBtn = getByText("Continue") as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "ab" } });
    expect(continueBtn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "tim_w" } });
    expect(continueBtn.disabled).toBe(false);
  });

  it("Step 1 → Step 2: registers the user and advances", async () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/users/register")) {
        return jsonResponse(201, {
          id: "u_abc",
          handle: "tim_w",
          created_at: "2026-05-11T10:00:00Z",
          existing: false,
          cf_country: null,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { getByPlaceholderText, getByText, queryByText } = render(
      <SignupModal
        open
        onClose={onClose}
        onComplete={onComplete}
        baseUrl="http://test"
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );
    fireEvent.change(getByPlaceholderText("your_handle"), {
      target: { value: "tim_w" },
    });
    fireEvent.click(getByText("Continue"));
    await waitFor(() => {
      expect(queryByText("Tell us a bit about you")).not.toBeNull();
    });
    // Now we should see Step 2 controls.
    expect(queryByText("Country")).not.toBeNull();
    expect(queryByText("Age range")).not.toBeNull();
    // The local user should be persisted.
    expect(
      window.localStorage.getItem("tournamental.user.id"),
    ).toBe("u_abc");
  });

  it("Step 2 'Skip for now' closes without a PATCH", async () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/users/register")) {
        return jsonResponse(201, {
          id: "u_skip",
          handle: "skipper",
          created_at: "2026-05-11T10:00:00Z",
          existing: false,
          cf_country: null,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { getByPlaceholderText, getByText } = render(
      <SignupModal
        open
        onClose={onClose}
        onComplete={onComplete}
        baseUrl="http://test"
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );
    fireEvent.change(getByPlaceholderText("your_handle"), {
      target: { value: "skipper" },
    });
    fireEvent.click(getByText("Continue"));
    await waitFor(() => getByText("Skip for now"));
    fireEvent.click(getByText("Skip for now"));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // The only fetch should have been the register call — no PATCH.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("Step 2 'Finish' PATCHes the chosen fields", async () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/users/register")) {
        return jsonResponse(201, {
          id: "u_finish",
          handle: "finisher",
          created_at: "2026-05-11T10:00:00Z",
          existing: false,
          cf_country: null,
        });
      }
      if (url.includes("/profile")) {
        // Sanity-check the PATCH body
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body.age_bucket).toBe("25-34");
        expect(body.favourite_team_code).toBe("ARG");
        return jsonResponse(200, {
          user: {
            id: "u_finish",
            handle: "finisher",
            display_name: null,
            auth_method: "guest",
            created_at: "2026-05-11T10:00:00Z",
            last_seen_at: "2026-05-11T10:00:00Z",
            deleted_at: null,
          },
          profile: {
            age_bucket: "25-34",
            gender: null,
            country_code: "NZ",
            city: null,
            timezone: "Pacific/Auckland",
            favourite_team_code: "ARG",
            follows_leagues: null,
            watches_via: null,
            visit_count: 0,
            last_visit_date: null,
            engagement_band: "cold",
            marketing_consent: false,
            analytics_consent: true,
            updated_at: "2026-05-11T10:00:00Z",
          },
          changed_fields: ["age_bucket", "favourite_team_code"],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { getByPlaceholderText, getByText, getAllByText } = render(
      <SignupModal
        open
        onClose={onClose}
        onComplete={onComplete}
        defaultCountry="NZ"
        baseUrl="http://test"
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );
    fireEvent.change(getByPlaceholderText("your_handle"), {
      target: { value: "finisher" },
    });
    fireEvent.click(getByText("Continue"));
    await waitFor(() => getByText("Finish"));
    // Pick 25-34 age bucket and Argentina team
    fireEvent.click(getByText("25-34"));
    // "ARG" button has emoji prefix, so search via getAllByText then click first
    const argButtons = getAllByText("ARG");
    fireEvent.click(argButtons[0]);
    fireEvent.click(getByText("Finish"));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // register + patch
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("handle collision shows a friendly error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { error: "handle_taken", handle: "duplicate" }),
    );
    const { getByPlaceholderText, getByText, findByText } = render(
      <SignupModal
        open
        onClose={() => {}}
        baseUrl="http://test"
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );
    fireEvent.change(getByPlaceholderText("your_handle"), {
      target: { value: "duplicate" },
    });
    fireEvent.click(getByText("Continue"));
    await findByText("That handle's already taken. Try another.");
  });
});
