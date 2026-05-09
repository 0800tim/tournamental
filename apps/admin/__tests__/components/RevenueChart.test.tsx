import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RevenueChart } from "@/components/RevenueChart";

describe("<RevenueChart>", () => {
  it("renders the metric label", () => {
    render(
      <RevenueChart data={[{ day: "2026-05-01", count: 1 }]} metric="signups" />,
    );
    expect(screen.getByText(/signups/)).toBeInTheDocument();
  });

  it("falls back to default metric label", () => {
    render(<RevenueChart data={[]} />);
    expect(screen.getByText(/signups/)).toBeInTheDocument();
  });
});
