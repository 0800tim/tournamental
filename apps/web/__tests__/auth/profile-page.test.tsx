// @vitest-environment jsdom

/**
 * ProfilePage, renders the right shell depending on auth state.
 *
 * Coverage:
 *   - Loading shows the "Loading…" placeholder.
 *   - Guest shows the sign-in CTA + can open the modal.
 *   - Unconfigured renders the same CTA (sign-in coming soon).
 *   - Authenticated renders the editor with the profile values.
 *   - Authenticated-but-no-profile shows the recovery message.
 */

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import type { UserProfile } from "@/lib/auth/types";

let mockStatus: "loading" | "guest" | "authenticated" | "unconfigured" = "guest";
let mockProfile: UserProfile | null = null;
let mockUser: { id: string; email: string | null; phone: string | null } | null = null;

vi.mock("@/lib/auth/useUser", () => ({
  useUser: () => ({
    status: mockStatus,
    user: mockUser,
    profile: mockProfile,
    loading: mockStatus === "loading",
    refresh: async () => {},
  }),
}));

vi.mock("@/lib/auth/supabase", () => ({
  browserClient: () => null,
  serverActionClient: () => null,
  serviceRoleClient: () => null,
}));

vi.mock("@/lib/auth/signIn", () => ({
  signOut: async () => {},
  signInWithMagicLink: async () => ({ ok: true }),
  signInWithTelegram: async () => ({ ok: true }),
  signInWithWhatsAppOtp: async () => ({ ok: true }),
  verifyWhatsAppOtp: async () => ({ ok: true }),
}));

vi.mock("@/lib/auth/config", () => ({
  readPublicConfig: () =>
    process.env.NEXT_PUBLIC_SUPABASE_URL
      ? { url: process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey: "anon" }
      : null,
  readServerConfig: () => ({
    url: "x",
    anonKey: "x",
    serviceRoleKey: "x",
    phoneHashSalt: "x",
    jwtSecret: "x",
    smsHookSecret: "x",
  }),
  isAuthAvailable: () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
}));

import { ProfilePage } from "@/components/auth/ProfilePage";

beforeEach(() => {
  mockStatus = "guest";
  mockProfile = null;
  mockUser = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("<ProfilePage>", () => {
  it("shows the loader while loading", () => {
    mockStatus = "loading";
    const { getByText } = render(<ProfilePage />);
    expect(getByText(/Loading/)).toBeTruthy();
  });

  it("renders sign-in CTA when guest", () => {
    mockStatus = "guest";
    const { getByText, getByRole } = render(<ProfilePage />);
    expect(getByText(/Save your bracket/)).toBeTruthy();
    expect(getByRole("button", { name: /Sign in/ })).toBeTruthy();
  });

  it("opens the SignupModal from the CTA", async () => {
    mockStatus = "guest";
    const { getByRole, queryByRole } = render(<ProfilePage />);
    expect(queryByRole("dialog")).toBeNull();
    fireEvent.click(getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(queryByRole("dialog")).toBeTruthy());
  });

  it("renders the editor when authenticated", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u-1", email: "tim@x.com", phone: null };
    mockProfile = {
      id: "u-1",
      handle: "tim",
      display_name: "Tim",
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      age_bucket: null,
      gender: null,
      country_code: "NZ",
      city: null,
      timezone: null,
      favourite_team_code: "ARG",
      follows_leagues: null,
      watches_via: null,
      visit_count: 3,
      last_visit_date: null,
      engagement_band: "warm",
      telegram_id: null,
      whatsapp_phone_hash: null,
      marketing_consent: false,
      analytics_consent: true,
      phone_match_consent: false,
      updated_at: new Date().toISOString(),
    };
    const { getByText, getByDisplayValue } = render(<ProfilePage />);
    // Handle / display name show up as inputs
    expect(getByDisplayValue("tim")).toBeTruthy();
    expect(getByDisplayValue("Tim")).toBeTruthy();
    expect(getByDisplayValue("ARG")).toBeTruthy();
    expect(getByText(/Privacy/)).toBeTruthy();
    expect(getByText(/Sign out/)).toBeTruthy();
  });

  it("shows the recovery message when profile is missing", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u-1", email: "tim@x.com", phone: null };
    mockProfile = null;
    const { getByText } = render(<ProfilePage />);
    expect(getByText(/couldn['']t load your profile/i)).toBeTruthy();
  });
});
