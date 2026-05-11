/**
 * Vitest, AppBar smoke. Right-action fires its onClick; hamburger fires
 * onMenuClick; scroll listener flips data-scrolled.
 *
 * The AppBar now mounts a second-row DesktopNav internally on >=768px;
 * we stub next/navigation + auth modules so the row can render in jsdom
 * without crashing.
 */

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));
vi.mock("@/lib/auth/supabase", () => ({
  browserClient: () => null,
}));
vi.mock("@/lib/auth/config", () => ({
  readPublicConfig: () => null,
}));

import { AppBar } from "@/components/shell/AppBar";

describe("<AppBar>", () => {
  it("renders the title", () => {
    const { getByText } = render(<AppBar title="Tournament" />);
    expect(getByText("Tournament")).toBeTruthy();
  });

  it("invokes onMenuClick when the hamburger is tapped", () => {
    const fn = vi.fn();
    const { getByLabelText } = render(
      <AppBar title="Home" onMenuClick={fn} />,
    );
    fireEvent.click(getByLabelText("Open menu"));
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

  it("renders the desktop nav row by default (data-with-desktop-nav=1)", () => {
    const { container } = render(<AppBar title="Home" />);
    const header = container.querySelector(".vt-appbar") as HTMLElement;
    expect(header.getAttribute("data-with-desktop-nav")).toBe("1");
    expect(container.querySelector(".vt-appbar-nav")).toBeTruthy();
  });

  it("hides the desktop nav row when hideDesktopNav is set", () => {
    const { container } = render(<AppBar title="Home" hideDesktopNav />);
    const header = container.querySelector(".vt-appbar") as HTMLElement;
    expect(header.getAttribute("data-with-desktop-nav")).toBe("0");
    expect(container.querySelector(".vt-appbar-nav")).toBeNull();
  });
});
