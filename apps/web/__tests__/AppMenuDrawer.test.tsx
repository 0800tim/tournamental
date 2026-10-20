/**
 * Vitest, AppMenuDrawer rendering + link routing rules.
 *
 * 1. Internal links go through next/link (no target/rel attributes).
 * 2. External links carry target="_blank" + rel="noopener noreferrer"
 *    and render the ↗ glyph after the label.
 * 3. The "Create a syndicate" sub-item is marked data-subitem.
 * 4. The drawer renders nothing when `open` is false.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "./helpers/render";

import { AppMenuDrawer } from "@/components/shell/AppMenuDrawer";

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

describe("<AppMenuDrawer>", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <AppMenuDrawer open={false} onClose={() => {}} />,
    );
    expect(container.querySelector(".vt-drawer")).toBeNull();
  });

  it("renders every section when open", () => {
    const { getByText, getAllByText } = render(
      <AppMenuDrawer open onClose={() => {}} />,
    );
    // Live mode (the default shell mode): one tournament section and
    // the brand section. Hub and archive modes swap the first section.
    expect(getByText(/FIFA World Cup 2026/)).toBeTruthy();
    expect(getAllByText("Tournamental").length).toBeGreaterThan(0);
    // Spot-check a row in each section.
    expect(getByText("Home")).toBeTruthy();
    expect(getByText("Leaderboard")).toBeTruthy();
    expect(getByText("Engineering log")).toBeTruthy();
  });

  it("routes About Tournamental, Engineering log, and Open source as external new-window links", () => {
    const { container } = render(
      <AppMenuDrawer open onClose={() => {}} />,
    );
    const externals = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a.vt-drawer-link[target="_blank"]',
      ),
    );
    const hrefs = externals.map((a) => a.getAttribute("href"));
    // Syndicates moved in-app (apps/web/app/syndicates/page.tsx); only the
    // long-tail marketing/engineering/source links are external now.
    expect(hrefs).toContain("https://tournamental.com");
    expect(hrefs).toContain("https://tournamental.com/engineering");
    expect(hrefs).toContain("https://github.com/0800tim/tournamental");
    for (const a of externals) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      // Each external row must include the ↗ external glyph.
      const glyph = a.querySelector(".vt-drawer-external-icon");
      expect(glyph).toBeTruthy();
      expect(glyph?.textContent).toBe("↗");
    }
  });

  it("keeps internal destinations in the SPA (no target/rel)", () => {
    const { container } = render(
      <AppMenuDrawer open onClose={() => {}} />,
    );
    const internals = Array.from(
      container.querySelectorAll<HTMLAnchorElement>("a.vt-drawer-link"),
    ).filter((a) => a.getAttribute("target") !== "_blank");
    // Home, Predict, Watch, Profile, Bracket Prophet, 3D Molecule,
    // Save & share, 2022 final, Leaderboard, Create a syndicate, Settings.
    expect(internals.length).toBeGreaterThanOrEqual(10);
    for (const a of internals) {
      expect(a.getAttribute("rel")).toBeNull();
      // Must NOT render the external glyph on internal rows.
      expect(a.querySelector(".vt-drawer-external-icon")).toBeNull();
    }
  });

  it("renders the Share & Save row pointing at the dedicated save-share page", () => {
    const { container } = render(
      <AppMenuDrawer open onClose={() => {}} />,
    );
    const saveShare = Array.from(
      container.querySelectorAll<HTMLAnchorElement>("a.vt-drawer-link"),
    ).find((a) => a.textContent?.includes("Share & Save"));
    expect(saveShare?.getAttribute("href")).toBe(
      "/world-cup-2026/save-share",
    );
  });

  // "Create a syndicate" left the drawer when Syndicates became Pools
  // (/syndicates is now the single "Pools" row), so the sub-item case
  // that lived here was removed on 2026-10-17.
});
