import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { HumannessChip } from "@/components/HumannessChip";

describe("<HumannessChip>", () => {
  it("renders the score", () => {
    render(<HumannessChip score={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("uses 'low' label below 20", () => {
    render(<HumannessChip score={5} />);
    expect(screen.getByText("low")).toBeInTheDocument();
  });

  it("uses 'uncertain' label between 20 and 49", () => {
    render(<HumannessChip score={30} />);
    expect(screen.getByText("uncertain")).toBeInTheDocument();
  });

  it("uses 'likely' label between 50 and 79", () => {
    render(<HumannessChip score={65} />);
    expect(screen.getByText("likely")).toBeInTheDocument();
  });

  it("uses 'verified' label at 80+", () => {
    render(<HumannessChip score={92} />);
    expect(screen.getByText("verified")).toBeInTheDocument();
  });

  it("shows BOT chip for self-declared bots regardless of score", () => {
    render(<HumannessChip score={95} bot />);
    expect(screen.getByText("BOT")).toBeInTheDocument();
    expect(screen.queryByText("verified")).toBeNull();
  });

  it("exposes an aria-label for screen readers", () => {
    render(<HumannessChip score={50} />);
    expect(screen.getByLabelText(/Humanness score 50/)).toBeInTheDocument();
  });

  it("clamps boundary 0 to 'low'", () => {
    render(<HumannessChip score={0} />);
    expect(screen.getByText("low")).toBeInTheDocument();
  });

  it("treats exactly 80 as 'verified'", () => {
    render(<HumannessChip score={80} />);
    expect(screen.getByText("verified")).toBeInTheDocument();
  });
});
