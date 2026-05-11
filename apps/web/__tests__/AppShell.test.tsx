/**
 * Vitest, AppShell renders bar + bottom nav by default; canvas variant
 * hides bottom nav and suppresses the desktop nav row.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));
vi.mock("@/lib/auth/supabase", () => ({
  browserClient: () => null,
}));
vi.mock("@/lib/auth/config", () => ({
  readPublicConfig: () => null,
}));

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
  it("renders title in the app-bar by default and includes the desktop nav row", () => {
    const { container } = render(
      <AppShell title="Home">
        <p>hello</p>
      </AppShell>,
    );
    expect(container.querySelector(".vt-appbar-title")?.textContent).toBe(
      "Home",
    );
    expect(container.querySelector(".vt-bottomnav")).toBeTruthy();
    expect(container.querySelector(".vt-appbar-nav")).toBeTruthy();
  });

  it("hides bottom nav and desktop nav row on canvas variant", () => {
    const { container } = render(
      <AppShell title="Match" variant="canvas" showBottomNav={false}>
        <p>canvas</p>
      </AppShell>,
    );
    expect(container.querySelector(".vt-bottomnav")).toBeNull();
    expect(container.querySelector(".vt-appbar-nav")).toBeNull();
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
