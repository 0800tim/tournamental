/**
 * Vitest, /terms/house-prize includes the Bot Arena clause.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §11
 * The clause sits between section 4 (Eligibility) and section 5 (The
 * Bracket) under id="bots" and asserts the cash-prize ineligibility +
 * the non-cash recognition package for a bot perfect bracket.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/components/shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import HousePrizeTermsPage from "@/app/terms/house-prize/page";

describe("/terms/house-prize", () => {
  it("includes a bots section anchored at #bots", () => {
    const { container } = render(<HousePrizeTermsPage />);
    expect(container.querySelector("#bots")).toBeTruthy();
  });

  it("states bots are ineligible for the cash prize", () => {
    const { container } = render(<HousePrizeTermsPage />);
    expect(container.textContent).toMatch(/ineligible for the cash/i);
  });

  it("references the 50-point Humanness Score floor", () => {
    const { container } = render(<HousePrizeTermsPage />);
    expect(container.textContent).toMatch(/50 or higher/);
  });

  it("describes the bot perfect-bracket non-cash recognition", () => {
    const { container } = render(<HousePrizeTermsPage />);
    expect(container.textContent).toMatch(/badge/i);
    expect(container.textContent).toMatch(/research note/i);
    expect(container.textContent).toMatch(/trophy/i);
  });

  it("links to the Bot SDK at /bots/sdk", () => {
    const { container } = render(<HousePrizeTermsPage />);
    const link = container.querySelector("a[href='/bots/sdk']");
    expect(link).toBeTruthy();
  });
});
