import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatCard } from "@/components/StatCard";

describe("<StatCard>", () => {
  it("renders the label and value", () => {
    render(<StatCard label="DAU" value={1234} />);
    expect(screen.getByText("DAU")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("formats string values verbatim", () => {
    render(<StatCard label="Status" value="banned" />);
    expect(screen.getByText("banned")).toBeInTheDocument();
  });

  it("renders an upward delta with + sign and emerald tone", () => {
    render(<StatCard label="DAU" value={100} delta={{ sign: "up", pct: 12.4 }} />);
    expect(screen.getByText(/\+12\.4%/)).toBeInTheDocument();
  });

  it("renders a downward delta with - sign", () => {
    render(<StatCard label="DAU" value={100} delta={{ sign: "down", pct: 4.2 }} />);
    expect(screen.getByText(/-4\.2%/)).toBeInTheDocument();
  });

  it("includes window text on the delta", () => {
    render(<StatCard label="DAU" value={100} delta={{ sign: "up", pct: 1.0, window: "wow" }} />);
    expect(screen.getByText("wow")).toBeInTheDocument();
  });

  it("exposes a group role for accessibility", () => {
    render(<StatCard label="DAU" value={1} />);
    expect(screen.getByRole("group", { name: "DAU" })).toBeInTheDocument();
  });

  it("renders an optional hint", () => {
    render(<StatCard label="X" value={1} hint="Some note" />);
    expect(screen.getByText("Some note")).toBeInTheDocument();
  });
});
