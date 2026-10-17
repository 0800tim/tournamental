import { describe, expect, it, vi } from "vitest";

import { render, screen } from "./intl";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { BottomNav } from "@/components/shell/BottomNav";

describe("<BottomNav> accessibility", () => {
  it("is the Primary navigation landmark with the current page marked", () => {
    render(<BottomNav onMenuClick={() => {}} />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain("Home");
  });

  it("exposes the menu button as a dialog trigger with its open state", () => {
    const { rerender } = render(<BottomNav onMenuClick={() => {}} menuOpen={false} />);
    const btn = screen.getByRole("button", { name: /Open menu/ });
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    rerender(<BottomNav onMenuClick={() => {}} menuOpen />);
    expect(screen.getByRole("button", { name: /Open menu/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("hides the tab icons from assistive tech", () => {
    const { container } = render(<BottomNav onMenuClick={() => {}} />);
    for (const svg of Array.from(container.querySelectorAll("svg"))) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
