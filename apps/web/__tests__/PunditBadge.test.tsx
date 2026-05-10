/**
 * PunditBadge — verifies the badge is hidden for un-verified users and
 * exposes the right tooltip + level signal for verified ones.
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  PunditBadge,
  type PunditStatus,
} from "../components/shared/PunditBadge";

const VERIFIED: PunditStatus = {
  verified: true,
  levels: 1,
  sinceDate: "2026-04-01T00:00:00Z",
  tournaments: ["fifa-wc-2026"],
};

describe("PunditBadge", () => {
  it("renders nothing when status is null", () => {
    const { container } = render(<PunditBadge status={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when verified=false", () => {
    const { container } = render(
      <PunditBadge status={{ ...VERIFIED, verified: false, levels: 0 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an accessible badge for a level-1 verified pundit", () => {
    render(<PunditBadge status={VERIFIED} />);
    const badge = screen.getByTestId("pundit-badge");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("aria-label")).toContain("Verified Pundit");
    expect(badge.getAttribute("aria-label")).toContain("top 100");
    expect(badge.getAttribute("aria-label")).toContain("1 tournament");
    expect(badge.getAttribute("data-pundit-levels")).toBe("1");
  });

  it("pluralises tournaments and shows the level chip when levels >= 2", () => {
    render(
      <PunditBadge
        status={{ ...VERIFIED, levels: 3, tournaments: ["a", "b", "c"] }}
      />,
    );
    const badge = screen.getByTestId("pundit-badge");
    expect(badge.getAttribute("aria-label")).toContain("3 tournaments");
    expect(badge.getAttribute("data-pundit-levels")).toBe("3");
    // Level chip text is the bare number; assert it appears in the rendered tree.
    expect(badge.textContent).toContain("3");
  });

  it("uses the supplied size for the wrapper", () => {
    render(<PunditBadge status={VERIFIED} size={20} />);
    const badge = screen.getByTestId("pundit-badge");
    expect((badge as HTMLElement).style.width).toBe("20px");
    expect((badge as HTMLElement).style.height).toBe("20px");
  });
});
