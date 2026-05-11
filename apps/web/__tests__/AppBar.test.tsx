/**
 * Vitest, AppBar smoke. Avatar fires onAvatarClick; right-action fires
 * its onClick; scroll listener flips data-scrolled.
 */

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

import { AppBar } from "@/components/shell/AppBar";

describe("<AppBar>", () => {
  it("renders the title and avatar initials", () => {
    const { getByText, getByLabelText } = render(
      <AppBar title="Tournament" avatarInitials="T" />,
    );
    expect(getByText("Tournament")).toBeTruthy();
    expect(getByLabelText("Open profile menu").textContent).toBe("T");
  });

  it("invokes onAvatarClick when the avatar is tapped", () => {
    const fn = vi.fn();
    const { getByLabelText } = render(
      <AppBar title="Home" avatarInitials="T" onAvatarClick={fn} />,
    );
    fireEvent.click(getByLabelText("Open profile menu"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("renders rightAction and fires its onClick", () => {
    const fn = vi.fn();
    const { getByLabelText } = render(
      <AppBar
        title="Home"
        rightAction={{
          label: "Share",
          icon: <span>S</span>,
          onClick: fn,
        }}
      />,
    );
    fireEvent.click(getByLabelText("Share"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("toggles data-scrolled on scroll", async () => {
    const { container } = render(<AppBar title="Home" />);
    const header = container.querySelector(".vt-appbar") as HTMLElement;
    expect(header.getAttribute("data-scrolled")).toBe("0");

    Object.defineProperty(window, "scrollY", { value: 80, writable: true });
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => {
      expect(header.getAttribute("data-scrolled")).toBe("1");
    });
  });
});
