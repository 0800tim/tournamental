/**
 * Vitest — AppBar smoke. Brand mark links to "/", hamburger fires
 * onMenuClick, page-level rightAction still works, scroll listener
 * flips data-scrolled.
 */

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

import { AppBar } from "@/components/shell/AppBar";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("<AppBar>", () => {
  it("renders the title and the brand mark linking to /", () => {
    const { getByText, getByLabelText } = render(
      <AppBar title="Tournament" brandInitials="T" />,
    );
    expect(getByText("Tournament")).toBeTruthy();
    const brand = getByLabelText("Tournamental home") as HTMLAnchorElement;
    expect(brand.getAttribute("href")).toBe("/");
    expect(brand.textContent).toBe("T");
  });

  it("invokes onMenuClick when the burger is tapped", () => {
    const fn = vi.fn();
    const { getByLabelText } = render(
      <AppBar title="Home" onMenuClick={fn} />,
    );
    fireEvent.click(getByLabelText("Open menu"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("flips the burger aria-label to 'Close menu' when the drawer is open", () => {
    const { getByLabelText } = render(
      <AppBar title="Home" menuOpen onMenuClick={() => {}} />,
    );
    expect(getByLabelText("Close menu")).toBeTruthy();
  });

  it("renders rightAction next to the burger and fires its onClick", () => {
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
    // Burger still rendered alongside.
    expect(getByLabelText("Open menu")).toBeTruthy();
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
