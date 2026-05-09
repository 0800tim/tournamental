import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SyndicatesTable } from "@/app/(authed)/syndicates/SyndicatesTable";
import type { SyndicateRow } from "@/lib/api";

const ROWS: SyndicateRow[] = [
  {
    slug: "creator-league-nz",
    name: "Creator League NZ",
    members: 312,
    status: "active",
    created_at: new Date().toISOString(),
    total_stake_units: 18430,
  },
  {
    slug: "office-pool",
    name: "Office Pool",
    members: 22,
    status: "pending",
    created_at: new Date().toISOString(),
    total_stake_units: 0,
  },
];

describe("<SyndicatesTable>", () => {
  it("renders rows", () => {
    render(<SyndicatesTable rows={ROWS} />);
    expect(screen.getByText("Creator League NZ")).toBeInTheDocument();
    expect(screen.getByText("Office Pool")).toBeInTheDocument();
  });

  it("renders status with appropriate text", () => {
    render(<SyndicatesTable rows={ROWS} />);
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("links to syndicate detail page", () => {
    render(<SyndicatesTable rows={ROWS} />);
    const link = screen.getByRole("link", { name: "Creator League NZ" });
    expect(link).toHaveAttribute("href", "/syndicates/creator-league-nz");
  });
});
