// @vitest-environment jsdom

/**
 * SignupModal, happy-path smoke tests for each of the three tabs.
 *
 * We mock the sign-in helpers at the module boundary so the test
 * doesn't try to spin up a real Supabase client. The component
 * contract is: the user picks a tab, fills in a field, hits the
 * button, the right helper is called with the right argument.
 */

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import * as signIn from "@/lib/auth/signIn";
import { SignupModal } from "@/components/auth/SignupModal";

// Pretend Supabase IS configured for the duration of these tests so the
// tabs are enabled. The actual env var is read inside the component via
// `readPublicConfig()` which inspects `process.env`.
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

describe("<SignupModal>", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <SignupModal open={false} onClose={() => {}} />,
    );
    expect(container.querySelector(".vt-signup-card")).toBeNull();
  });

  it("renders three tabs when open", () => {
    const { getByRole, getAllByRole } = render(
      <SignupModal open onClose={() => {}} />,
    );
    expect(getByRole("dialog")).toBeTruthy();
    const tabs = getAllByRole("tab");
    expect(tabs.length).toBe(3);
    expect(tabs[0].textContent).toMatch(/Email/);
    expect(tabs[1].textContent).toMatch(/Telegram/);
    expect(tabs[2].textContent).toMatch(/WhatsApp/);
  });

  it("email tab: submits magic-link with the typed email", async () => {
    const spy = vi
      .spyOn(signIn, "signInWithMagicLink")
      .mockResolvedValue({ ok: true, hint: "check-inbox" });

    const { getByLabelText, getByRole, getByText } = render(
      <SignupModal open onClose={() => {}} initialTab="email" />,
    );
    const input = getByLabelText(/Email/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "tim@example.com" } });
    fireEvent.click(getByRole("button", { name: /Send magic link/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toBe("tim@example.com");
    await waitFor(() =>
      expect(getByText(/Check your inbox/i)).toBeTruthy(),
    );
  });

  it("whatsapp tab: requests OTP, then verifies on second submit", async () => {
    const reqSpy = vi
      .spyOn(signIn, "signInWithWhatsAppOtp")
      .mockResolvedValue({ ok: true });
    const verSpy = vi
      .spyOn(signIn, "verifyWhatsAppOtp")
      .mockResolvedValue({ ok: true });

    const { getByLabelText, getByRole } = render(
      <SignupModal open onClose={() => {}} initialTab="whatsapp" />,
    );
    const phone = getByLabelText(/WhatsApp phone number/i) as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "+6421999000" } });
    fireEvent.click(getByRole("button", { name: /Send code on WhatsApp/i }));

    await waitFor(() => expect(reqSpy).toHaveBeenCalled());
    expect(reqSpy.mock.calls[0][0]).toBe("+6421999000");

    const code = (await waitFor(() => getByLabelText(/6-digit code/i))) as HTMLInputElement;
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(getByRole("button", { name: /Verify/i }));

    await waitFor(() => expect(verSpy).toHaveBeenCalled());
    expect(verSpy.mock.calls[0][0]).toBe("+6421999000");
    expect(verSpy.mock.calls[0][1]).toBe("123456");
  });

  it("telegram tab: mounts the widget script with the bot username", () => {
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "TournamentalBot";
    const { container } = render(
      <SignupModal open onClose={() => {}} initialTab="telegram" />,
    );
    // The component appends a <script> to the mount div.
    const script = container.querySelector("script");
    expect(script).toBeTruthy();
    expect(script?.getAttribute("data-telegram-login")).toBe("TournamentalBot");
    expect(script?.getAttribute("data-onauth")).toMatch(/__vtornTelegramAuth/);
  });

  it("falls back to disabled state when supabase env is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { getByRole, getAllByRole } = render(
      <SignupModal open onClose={() => {}} />,
    );
    // The "sign-in coming soon" banner is rendered.
    expect(getByRole("status").textContent).toMatch(/coming soon/i);
    // Tabs are all disabled.
    for (const t of getAllByRole("tab")) {
      expect((t as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    const { getByLabelText } = render(
      <SignupModal open onClose={onClose} />,
    );
    fireEvent.click(getByLabelText(/Close sign-in/i));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
