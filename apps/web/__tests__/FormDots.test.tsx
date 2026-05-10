/**
 * FormDots — shared form-strip used in MatchPredictionRow + team page.
 *
 * Asserts:
 *  - five W/D/L results render five dots
 *  - W gets the green spec colour, D neutral, L red
 *  - aria-label summarises the sequence for screen readers
 *  - sm variant produces colour-only dots; md surfaces the W/D/L letter
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { FormDots } from "../components/shared/FormDots";

describe("FormDots", () => {
  it("renders 5 dots for a 5-result sequence", () => {
    const { container } = render(
      <FormDots results={["W", "W", "D", "L", "W"]} />,
    );
    expect(container.querySelectorAll(".fd-dot")).toHaveLength(5);
  });

  it("applies W/D/L colours from the spec palette", () => {
    const { container } = render(
      <FormDots results={["W", "D", "L"]} size="sm" />,
    );
    const dots = container.querySelectorAll<HTMLElement>(".fd-dot");
    // ordered oldest -> newest -> reversed input -> [L, D, W]
    expect(dots).toHaveLength(3);
    expect(dots[0]!.style.backgroundColor).toBe("rgb(239, 68, 68)"); // L
    expect(dots[1]!.style.backgroundColor).toBe("rgb(148, 163, 184)"); // D
    expect(dots[2]!.style.backgroundColor).toBe("rgb(34, 197, 94)"); // W
  });

  it("surfaces an aria-label summary", () => {
    const { container } = render(<FormDots results={["W", "L"]} />);
    const group = container.querySelector(".fd-row");
    expect(group?.getAttribute("aria-label")).toContain("Win");
    expect(group?.getAttribute("aria-label")).toContain("Loss");
  });

  it("md variant shows the W/D/L letter inside each dot", () => {
    const { container } = render(
      <FormDots results={["W", "D", "L"]} size="md" />,
    );
    const dots = container.querySelectorAll(".fd-dot");
    expect(dots[0]!.textContent).toBe("L");
    expect(dots[1]!.textContent).toBe("D");
    expect(dots[2]!.textContent).toBe("W");
  });

  it("sm variant renders colour-only (no letters)", () => {
    const { container } = render(
      <FormDots results={["W", "D", "L"]} size="sm" />,
    );
    const dots = container.querySelectorAll(".fd-dot");
    for (const d of Array.from(dots)) {
      expect(d.textContent).toBe("");
    }
  });

  it("trims to the most recent 5 entries when given more", () => {
    const { container } = render(
      <FormDots results={["W", "W", "D", "L", "W", "L", "L"]} />,
    );
    expect(container.querySelectorAll(".fd-dot")).toHaveLength(5);
  });

  it("renders nothing when given an empty results array", () => {
    const { container } = render(<FormDots results={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
