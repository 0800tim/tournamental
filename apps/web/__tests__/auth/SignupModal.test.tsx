// @vitest-environment jsdom

/**
 * SignupModal, happy-path smoke tests for the single-screen sign-in
 * sheet (email code, WhatsApp deep-link, Telegram widget, code paste).
 *
 * The modal was rebuilt from the original three-tab Supabase layout to
 * a single screen backed by auth-sms (see the component header). These
 * tests follow that contract: every option is on screen at once, the
 * email and code-paste flows call the inbound-login helpers with what
 * the user typed, and the WhatsApp button follows the channel state.
 *
 * We mock the network-touching helpers at the module boundary so no
 * request leaves jsdom. The modal portals into <body>, so queries go
 * through `screen` / `document.body` rather than the render container.
 */

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DEFAULT_CHANNELS, type ChannelsState } from "@/lib/auth/channels";

const channelsState: { current: ChannelsState } = { current: DEFAULT_CHANNELS };

vi.mock("@/lib/auth/channels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/channels")>();
  return {
    ...actual,
    fetchChannelsState: async () => channelsState.current,
  };
});

const requestEmailOtp = vi.fn();
const verifyEmailOtp = vi.fn();
const verifyInboundCode = vi.fn();

vi.mock("@/lib/auth/inbound-login", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/inbound-login")>();
  return {
    ...actual,
    requestEmailOtp: (...args: unknown[]) => requestEmailOtp(...args),
    verifyEmailOtp: (...args: unknown[]) => verifyEmailOtp(...args),
    verifyInboundCode: (...args: unknown[]) => verifyInboundCode(...args),
  };
});

import { SignupModal } from "@/components/auth/SignupModal";

beforeEach(() => {
  channelsState.current = DEFAULT_CHANNELS;
  requestEmailOtp.mockReset().mockResolvedValue({ ok: true });
  verifyEmailOtp.mockReset().mockResolvedValue({ ok: false, error: "bad_code" });
  verifyInboundCode
    .mockReset()
    .mockResolvedValue({ ok: false, error: "bad_code" });
});

describe("<SignupModal>", () => {
  it("renders nothing when closed", () => {
    render(<SignupModal open={false} onClose={() => {}} />);
    expect(document.body.querySelector(".vt-signup-card")).toBeNull();
  });

  it("renders the dialog with email, WhatsApp, Telegram and code options", async () => {
    render(<SignupModal open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog", { name: /Save your bracket/i });
    expect(dialog).toBeTruthy();
    expect(screen.getByLabelText(/Email address/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Sign in\/up with WhatsApp/i }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/Sign in with Telegram/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sign in with code/i })).toBeTruthy();
  });

  it("email: requests a code for the typed address, then verifies it", async () => {
    render(<SignupModal open onClose={() => {}} />);
    const input = (await screen.findByLabelText(/Email address/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "tim@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Email me a code/i }));

    await waitFor(() => expect(requestEmailOtp).toHaveBeenCalled());
    expect(requestEmailOtp.mock.calls[0]?.[0]).toBe("tim@example.com");

    // Second step: the code field for this email appears.
    await screen.findByText(/Code sent to/i);
    const codeInputs = screen.getAllByLabelText(/6-digit code/i);
    // The email block's code field is the first one; the code-paste
    // form at the foot of the modal has its own.
    fireEvent.change(codeInputs[0]!, { target: { value: "123456" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Sign in with email code/i }),
    );

    await waitFor(() => expect(verifyEmailOtp).toHaveBeenCalled());
    expect(verifyEmailOtp.mock.calls[0]?.[0]).toBe("tim@example.com");
    expect(verifyEmailOtp.mock.calls[0]?.[1]).toBe("123456");
    await screen.findByRole("alert");
  });

  it("code paste: verifies a pasted 6-digit inbound code", async () => {
    render(<SignupModal open onClose={() => {}} />);
    await screen.findByRole("dialog");
    const codeInputs = screen.getAllByLabelText(/6-digit code/i);
    const paste = codeInputs[codeInputs.length - 1]!;
    fireEvent.change(paste, { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign in with code$/i }));

    await waitFor(() => expect(verifyInboundCode).toHaveBeenCalled());
    expect(verifyInboundCode.mock.calls[0]?.[0]).toBe("654321");
  });

  it("telegram: mounts the widget script with the bot username", async () => {
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "TournamentalBot";
    render(<SignupModal open onClose={() => {}} />);
    await screen.findByRole("dialog");
    // The component appends a <script> to the Telegram mount div.
    const script = document.body.querySelector("script[data-telegram-login]");
    expect(script).toBeTruthy();
    expect(script?.getAttribute("data-telegram-login")).toBe("TournamentalBot");
    expect(script?.getAttribute("data-onauth")).toMatch(/__vtornTelegramAuth/);
  });

  it("hides the WhatsApp button when the channel is unavailable", async () => {
    channelsState.current = {
      ...DEFAULT_CHANNELS,
      whatsapp: { available: false, reason: "suspended" },
    };
    render(<SignupModal open onClose={() => {}} />);
    await screen.findByRole("dialog");
    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /Sign in\/up with WhatsApp/i }),
      ).toBeNull();
    });
    // Email still leads regardless of channel state.
    expect(screen.getByLabelText(/Email address/i)).toBeTruthy();
  });

  it("close button fires onClose", async () => {
    const onClose = vi.fn();
    render(<SignupModal open onClose={onClose} />);
    fireEvent.click(await screen.findByLabelText(/Close sign-in/i));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
