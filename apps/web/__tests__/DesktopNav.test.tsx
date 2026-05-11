/**
 * DesktopNav + nav-links tests (jsdom).
 *
 * Verifies:
 *   - pickActiveLink returns the longest-prefix match, so visiting
 *     /world-cup-2026/molecule highlights "3D Molecule" rather than
 *     "Predict" (which shares the /world-cup-2026 prefix).
 *   - isLinkActive treats "__never__" matchPrefix as never-active
 *     (used for Save & share which is a hash-only target).
 *   - The DesktopNav renders the five PRIMARY pills, a "More" button,
 *     and an auth chip.
 *   - The active route emits the data-active="1" attribute on exactly
 *     one pill at a time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  DRAWER_PRIMARY,
  isLinkActive,
  MORE_DESKTOP,
  pickActiveLink,
  PRIMARY_DESKTOP,
} from "@/components/shell/nav-links";

let mockPath = "/";
const setMockPath = (p: string) => {
  mockPath = p;
};

vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
}));

// Stub Supabase to keep useUser in the "unconfigured" branch.
vi.mock("@/lib/auth/supabase", () => ({
  browserClient: () => null,
}));
vi.mock("@/lib/auth/config", () => ({
  readPublicConfig: () => null,
}));

import { DesktopNav } from "@/components/shell/DesktopNav";

beforeEach(() => {
  cleanup();
  setMockPath("/");
});
afterEach(() => cleanup());

describe("nav-links / isLinkActive", () => {
  it("returns false for links with matchPrefix __never__", () => {
    const link = PRIMARY_DESKTOP.find((l) => l.label === "Save & share")!;
    expect(isLinkActive(link, "/world-cup-2026")).toBe(false);
    expect(isLinkActive(link, "/world-cup-2026#final")).toBe(false);
  });

  it("matches /world-cup-2026 for Predict", () => {
    const predict = PRIMARY_DESKTOP.find((l) => l.label === "Predict")!;
    expect(isLinkActive(predict, "/world-cup-2026")).toBe(true);
    expect(isLinkActive(predict, "/world-cup-2026/groups")).toBe(true);
  });

  it("matches /world-cup-2026/molecule for 3D Molecule", () => {
    const mol = PRIMARY_DESKTOP.find((l) => l.label === "3D Molecule")!;
    expect(isLinkActive(mol, "/world-cup-2026/molecule")).toBe(true);
  });

  it("does NOT highlight Home (/) on non-root paths", () => {
    const home = DRAWER_PRIMARY.find((l) => l.label === "Home")!;
    expect(isLinkActive(home, "/world-cup-2026")).toBe(false);
  });
});

describe("pickActiveLink", () => {
  it("prefers the longest prefix when two links share a route family", () => {
    // /world-cup-2026/molecule should pick "3D Molecule" over "Predict".
    const active = pickActiveLink(PRIMARY_DESKTOP, "/world-cup-2026/molecule");
    expect(active?.label).toBe("3D Molecule");
  });

  it("falls back to Predict on /world-cup-2026 root", () => {
    const active = pickActiveLink(PRIMARY_DESKTOP, "/world-cup-2026");
    expect(active?.label).toBe("Predict");
  });

  it("returns null when nothing matches", () => {
    const active = pickActiveLink(PRIMARY_DESKTOP, "/about");
    expect(active).toBeNull();
  });

  it("returns Leaderboard for /leaderboard/global", () => {
    const active = pickActiveLink(PRIMARY_DESKTOP, "/leaderboard/global");
    expect(active?.label).toBe("Leaderboard");
  });

  it("returns Syndicates from MORE_DESKTOP when matched there", () => {
    const active = pickActiveLink(MORE_DESKTOP, "/syndicates/123");
    expect(active?.label).toBe("Syndicates");
  });
});

describe("<DesktopNav />", () => {
  it("renders one nav landmark labelled Primary", () => {
    render(<DesktopNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toBeTruthy();
  });

  it("renders all five PRIMARY pills as links and a More button", () => {
    render(<DesktopNav />);
    for (const link of PRIMARY_DESKTOP) {
      const a = screen.getByText(link.label).closest("a");
      expect(a).toBeTruthy();
    }
    const moreBtn = screen.getByRole("button", { name: /more/i });
    expect(moreBtn).toBeTruthy();
    expect(moreBtn.getAttribute("aria-haspopup")).toBe("menu");
    expect(moreBtn.getAttribute("aria-expanded")).toBe("false");
  });

  it("emits data-active=1 on 3D Molecule when pathname is /world-cup-2026/molecule", () => {
    setMockPath("/world-cup-2026/molecule");
    render(<DesktopNav />);
    const mol = screen.getByText("3D Molecule").closest("a");
    const predict = screen.getByText("Predict").closest("a");
    expect(mol?.getAttribute("data-active")).toBe("1");
    expect(predict?.getAttribute("data-active")).toBe("0");
  });

  it("emits data-active=1 on Predict when pathname is /world-cup-2026 (root)", () => {
    setMockPath("/world-cup-2026");
    render(<DesktopNav />);
    const predict = screen.getByText("Predict").closest("a");
    expect(predict?.getAttribute("data-active")).toBe("1");
  });

  it("renders the Sign in chip by default when Supabase is unconfigured", () => {
    render(<DesktopNav />);
    // useUser short-circuits to "unconfigured" -> "Sign in" pill.
    const signin = screen.getByRole("link", { name: /^sign in$/i });
    expect(signin).toBeTruthy();
    expect(signin.getAttribute("href")).toBe("/profile");
  });
});
