/**
 * Vitest — AppShell renders bar + bottom nav by default; canvas variant
 * hides bottom nav; the drawer-trigger burger is always present in the
 * top app-bar; the desktop side rail no longer exists.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import { AppShell } from "@/components/shell/AppShell";

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

describe("<AppShell>", () => {
  it("renders title in the app-bar by default", () => {
    const { container } = render(
      <AppShell title="Home">
        <p>hello</p>
      </AppShell>,
    );
    expect(container.querySelector(".vt-appbar-title")?.textContent).toBe(
      "Home",
    );
    expect(container.querySelector(".vt-bottomnav")).toBeTruthy();
    // The desktop side rail has been removed in favour of the drawer.
    expect(container.querySelector(".vt-siderail")).toBeNull();
  });

  it("always renders the hamburger burger in the app-bar", () => {
    const { container } = render(
      <AppShell title="Home">
        <p>hello</p>
      </AppShell>,
    );
    const burger = container.querySelector(".vt-appbar-burger");
    expect(burger).toBeTruthy();
    // Closed by default — aria-label reads "Open menu".
    expect(burger?.getAttribute("aria-label")).toBe("Open menu");
  });

  it("hides bottom nav on canvas variant", () => {
    const { container } = render(
      <AppShell title="Match" variant="canvas" showBottomNav={false}>
        <p>canvas</p>
      </AppShell>,
    );
    expect(container.querySelector(".vt-bottomnav")).toBeNull();
    const shell = container.querySelector(".vt-shell");
    expect(shell?.getAttribute("data-variant")).toBe("canvas");
  });

  it("renders subHeader between app-bar and main", () => {
    const { container } = render(
      <AppShell title="Bracket" subHeader={<div data-testid="sub">tabs</div>}>
        <p>body</p>
      </AppShell>,
    );
    const sub = container.querySelector('[data-testid="sub"]');
    expect(sub?.textContent).toBe("tabs");
    // The subHeader sits inside .vt-page-header which precedes the main pane.
    const header = container.querySelector(".vt-page-header");
    expect(header?.contains(sub!)).toBe(true);
  });
});
