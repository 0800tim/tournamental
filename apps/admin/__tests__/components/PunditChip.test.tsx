import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PunditChip } from "@/components/PunditChip";

describe("<PunditChip>", () => {
  it("renders nothing for null status", () => {
    const { container } = render(<PunditChip status={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when verified=false", () => {
    const { container } = render(
      <PunditChip
        status={{ verified: false, levels: 0, sinceDate: null, tournaments: [] }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the chip with level count when verified", () => {
    render(
      <PunditChip
        status={{
          verified: true,
          levels: 2,
          sinceDate: "2026-04-01T00:00:00Z",
          tournaments: ["a", "b"],
        }}
      />,
    );
    const chip = screen.getByTestId("pundit-chip");
    expect(chip).toBeInTheDocument();
    expect(chip.getAttribute("aria-label")).toContain("Verified Pundit");
    expect(chip.getAttribute("aria-label")).toContain("2 tournaments");
    expect(chip.getAttribute("data-pundit-levels")).toBe("2");
    expect(chip.textContent).toContain("×2");
  });
});
