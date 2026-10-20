import { describe, expect, it } from "vitest";

import { render, screen } from "./intl";
import { CountdownBanner, summaryFor } from "@/components/ui/CountdownBanner";

describe("<CountdownBanner> accessibility", () => {
  it("is a labelled timer, not a live region that would announce every second", () => {
    const { container } = render(
      <CountdownBanner targetUtc="2027-10-01T09:00:00Z" title="Opening match" eyebrow="Kickoff" compact />,
    );
    const timer = screen.getByRole("timer");
    expect(timer.getAttribute("aria-live")).toBeNull();
    expect(timer.getAttribute("aria-label")).toMatch(/to Opening match$/);
    expect(container.querySelector(".vt-countdown-grid")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("reads the elapsed label once the target has passed", () => {
    render(<CountdownBanner targetUtc="2020-01-01T00:00:00Z" title="Opening match" pastLabel="Kicked off" compact />);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("Kicked off");
  });

  it("spells the units out in the spoken summary", () => {
    expect(summaryFor({ days: 1, hours: 2, minutes: 1, seconds: 30, elapsed: false }, "Days", "Hrs", "Min")).toBe(
      "1 day, 2 hours and 1 minute",
    );
    expect(summaryFor({ days: 12, hours: 0, minutes: 7, seconds: 0, elapsed: false }, "Days", "Hrs", "Min")).toBe(
      "12 days, 0 hours and 7 minutes",
    );
  });
});
