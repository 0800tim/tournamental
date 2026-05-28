import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SyndicatesTable } from "@/app/(authed)/syndicates/SyndicatesTable";
import type { SyndicateRow } from "@/lib/api";

interface ExtendedRow extends SyndicateRow {
  is_public?: boolean;
  prize_text?: string | null;
  tier?: string;
  owner_handle?: string | null;
}

const ROWS: ExtendedRow[] = [
  {
    slug: "creator-league-nz",
    name: "Creator League NZ",
    members: 312,
    status: "active",
    created_at: new Date().toISOString(),
    total_stake_units: 18430,
    is_public: true,
    prize_text: "Winner takes 70% of pool",
    tier: "premium",
    owner_handle: "creatorleague",
  },
  {
    slug: "office-pool",
    name: "Office Pool",
    members: 22,
    status: "pending",
    created_at: new Date().toISOString(),
    total_stake_units: 0,
    is_public: false,
    prize_text: null,
    tier: "free",
    owner_handle: "tim",
  },
];

describe("<SyndicatesTable>", () => {
  it("renders rows", () => {
    render(<SyndicatesTable rows={ROWS} />);
    expect(screen.getByText("Creator League NZ")).toBeInTheDocument();
    expect(screen.getByText("Office Pool")).toBeInTheDocument();
  });

  it("renders visibility as public / private", () => {
    render(<SyndicatesTable rows={ROWS} />);
    expect(screen.getByText("public")).toBeInTheDocument();
    expect(screen.getByText("private")).toBeInTheDocument();
  });

  it("renders the prize text when set, dash when empty", () => {
    render(<SyndicatesTable rows={ROWS} />);
    expect(screen.getByText("Winner takes 70% of pool")).toBeInTheDocument();
    // The empty-prize cell renders an em-dash-free placeholder — text "—" is a single char.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("links to syndicate detail page", () => {
    render(<SyndicatesTable rows={ROWS} />);
    const link = screen.getByRole("link", { name: "Creator League NZ" });
    expect(link).toHaveAttribute("href", "/syndicates/creator-league-nz");
  });
});
