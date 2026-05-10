import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Customer360Tabs } from "@/app/(authed)/users/[id]/Customer360Tabs";
import type { Customer360 } from "@/lib/customer360";

function mockData(): Customer360 {
  return {
    userId: "u_42",
    crmContact: {
      userId: "u_42",
      email: "user42@example.test",
      phone: "+64-21-555",
      marketingOptIn: true,
      notes: "VIP punter",
      attributes: { mailchimp_id: "m_42" },
      lastSyncedAt: "2026-05-09T12:00:00Z",
    },
    bracketDraft: {
      bracketId: "b_wc2026",
      matchPredictions: {
        "3": {
          matchId: "3",
          outcome: "home_win",
          homeScore: 2,
          awayScore: 1,
          lockedAt: "2026-06-12T18:00:00Z",
          oddsAtLock: { home: 1.85, draw: 3.4, away: 4.2, source: "polymarket" },
        },
        "1": {
          matchId: "1",
          outcome: "draw",
          lockedAt: "2026-06-10T18:00:00Z",
        },
      },
      knockoutPredictions: {},
      version: 7,
    },
    bracketHistory: [
      {
        id: "h_1",
        matchId: "1",
        ts: "2026-06-09T18:00:00Z",
        prevOutcome: "home_win",
        newOutcome: "draw",
      },
    ],
    syndicates: [
      {
        slug: "office",
        name: "Office Pool",
        role: "owner",
        joinedAt: "2026-05-01T00:00:00Z",
        rank: 1,
      },
    ],
    affiliateRevenue: {
      totalClicks: 18,
      totalConversions: 3,
      totalRevenueUnits: 540,
      recent: [
        {
          id: "aff_1",
          ts: "2026-05-08T00:00:00Z",
          affiliateId: "polymarket",
          partnerLabel: "Polymarket",
          geoCountry: "NZ",
          converted: true,
          revenueUnits: 200,
        },
      ],
    },
    socialPosts: [
      {
        id: "p_1",
        platform: "tiktok",
        url: "https://tiktok.com/@v/p1",
        publishedAt: "2026-05-08T00:00:00Z",
        caption: "Big play in the Cup",
        relation: "appeared_in",
        views: 12000,
        shares: 320,
      },
    ],
    pundit: null,
    fetchedAt: "2026-05-10T00:00:00Z",
  };
}

describe("<Customer360Tabs>", () => {
  beforeEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as unknown as typeof fetch;
  });

  it("renders the profile slot, then switches to predictions and shows the bracket draft", async () => {
    const data = mockData();
    render(
      <Customer360Tabs
        userId="u_42"
        data={data}
        role="super-admin"
        profileSlot={<div data-testid="profile-slot">profile body</div>}
      />,
    );
    expect(screen.getByTestId("profile-slot")).toBeInTheDocument();
    expect(screen.getByText(/CRM contact$/)).toBeInTheDocument();
    expect(screen.getByText("user42@example.test")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Predictions/ }));
    expect(screen.getByText(/Bracket draft/)).toBeInTheDocument();
    // Both predictions appear in the table; "Home win" appears in the
    // predictions row and the history row, so allow multiple matches.
    expect(screen.getAllByText("Home win").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Draw").length).toBeGreaterThanOrEqual(1);
    // Odds at lock string is formatted.
    expect(screen.getByText(/H 1\.85 \/ D 3\.40 \/ A 4\.20/)).toBeInTheDocument();
    // Edit history shows a row.
    expect(screen.getByText(/Edit history/)).toBeInTheDocument();
  });

  it("predictions sort defaults to numeric matchId order", async () => {
    const data = mockData();
    render(
      <Customer360Tabs
        userId="u_42"
        data={data}
        role="super-admin"
        profileSlot={<div />}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: /Predictions/ }));
    const cells = screen.getAllByText(/^[13]$/);
    // first occurrence in the table body should be "1" (the lower match id),
    // before "3".
    const firstIdx = cells.findIndex((el) => el.textContent === "1");
    const thirdIdx = cells.findIndex((el) => el.textContent === "3");
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(thirdIdx).toBeGreaterThan(firstIdx);
  });

  it("hides export and delete buttons for non-super-admin roles", () => {
    const data = mockData();
    const { rerender } = render(
      <Customer360Tabs userId="u_42" data={data} role="viewer" profileSlot={<div />} />,
    );
    expect(screen.queryByTestId("export-json-btn")).toBeNull();
    expect(screen.queryByTestId("delete-data-btn")).toBeNull();

    rerender(
      <Customer360Tabs userId="u_42" data={data} role="mod" profileSlot={<div />} />,
    );
    expect(screen.queryByTestId("export-json-btn")).toBeNull();
    expect(screen.queryByTestId("delete-data-btn")).toBeNull();
  });

  it("shows export and delete buttons for super-admin", () => {
    render(
      <Customer360Tabs
        userId="u_42"
        data={mockData()}
        role="super-admin"
        profileSlot={<div />}
      />,
    );
    expect(screen.getByTestId("export-json-btn")).toBeInTheDocument();
    expect(screen.getByTestId("delete-data-btn")).toBeInTheDocument();
  });

  it("export button has download attribute and points at the JSON endpoint", () => {
    render(
      <Customer360Tabs
        userId="u_42"
        data={mockData()}
        role="super-admin"
        profileSlot={<div />}
      />,
    );
    const a = screen.getByTestId("export-json-btn") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("/api/users/u_42/export");
    expect(a.hasAttribute("download")).toBe(true);
  });

  it("delete confirm requires typing the userId and then DELETEs", async () => {
    const user = userEvent.setup();
    render(
      <Customer360Tabs
        userId="u_42"
        data={mockData()}
        role="super-admin"
        profileSlot={<div />}
      />,
    );
    fireEvent.click(screen.getByTestId("delete-data-btn"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    const within = await import("@testing-library/react").then((m) => m.within(dialog));
    const confirmBtn = within.getByRole("button", { name: /Delete data/i });
    expect(confirmBtn).toBeDisabled();
    await user.type(within.getByLabelText(/confirm phrase/i), "u_42");
    expect(confirmBtn).not.toBeDisabled();
    await user.click(confirmBtn);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/users/u_42/data",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("renders missing-data tiles when sections are null", async () => {
    const data: Customer360 = {
      userId: "u_99",
      crmContact: null,
      bracketDraft: null,
      bracketHistory: null,
      syndicates: null,
      affiliateRevenue: null,
      socialPosts: null,
      pundit: null,
      fetchedAt: "2026-05-10T00:00:00Z",
    };
    render(
      <Customer360Tabs
        userId="u_99"
        data={data}
        role="super-admin"
        profileSlot={<div />}
      />,
    );
    expect(screen.getByText(/CRM contact unavailable/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Predictions/ }));
    expect(screen.getByText(/Bracket draft unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/History ledger unavailable/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Syndicates/ }));
    expect(screen.getByText(/Syndicate memberships unavailable/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Revenue/ }));
    expect(screen.getByText(/Affiliate revenue unavailable/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Clips/ }));
    expect(screen.getByText(/Clips & social posts unavailable/i)).toBeInTheDocument();
  });
});
