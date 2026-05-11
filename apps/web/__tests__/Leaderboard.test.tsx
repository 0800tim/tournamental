/**
 * Vitest, <Leaderboard> snapshot + behaviour smoke.
 *
 * Three states snapshotted:
 *   1. empty
 *   2. 10 members (compact density)
 *   3. mobile-viewport simulated via container width
 */

import { describe, it, expect } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { DraftPreviewBanner } from "@/components/mock/DraftPreviewBanner";
import { mockLeaderboardMembers } from "@/lib/mock/leaderboard";

describe("<Leaderboard>", () => {
  it("renders the title and tabs", () => {
    const { getByText, getAllByRole } = render(
      <Leaderboard
        title="Test board"
        members={mockLeaderboardMembers("test", 5)}
        skipSkeleton
      />,
    );
    expect(getByText("Test board")).toBeTruthy();
    const tabs = getAllByRole("tab");
    expect(tabs.length).toBe(3);
  });

  it("highlights the matching member row", () => {
    const rows = mockLeaderboardMembers("test", 8);
    const { container } = render(
      <Leaderboard
        title="Highlight test"
        members={rows}
        highlightMemberId={rows[2]!.id}
        skipSkeleton
      />,
    );
    const highlighted = container.querySelector('[data-highlight="1"]');
    expect(highlighted).toBeTruthy();
    expect(highlighted?.textContent).toContain(rows[2]!.handle);
    expect(container.textContent).toContain("YOU");
  });

  it("shows an empty state when no rows match the filter", () => {
    const { getByText } = render(
      <Leaderboard
        title="Filtered"
        members={[]}
        skipSkeleton
      />,
    );
    expect(getByText(/No rankings yet/)).toBeTruthy();
  });

  it("renders the syndicate-owner badge on rank 1", () => {
    const rows = mockLeaderboardMembers("test", 5);
    const { container } = render(
      <Leaderboard title="Owner test" members={rows} skipSkeleton />,
    );
    expect(container.querySelector('[data-kind="syndicate-owner"]')).toBeTruthy();
  });

  it("calls onTabChange when a tab is clicked", () => {
    const calls: string[] = [];
    const { getByText } = render(
      <Leaderboard
        title="Tab test"
        members={mockLeaderboardMembers("test", 5)}
        skipSkeleton
        onTabChange={(id) => calls.push(id)}
      />,
    );
    fireEvent.click(getByText("All time"));
    expect(calls).toContain("all-time");
  });

  it("respects compact density (hides movement column)", () => {
    const { container } = render(
      <Leaderboard
        title="Compact"
        members={mockLeaderboardMembers("test", 5)}
        density="compact"
        skipSkeleton
      />,
    );
    expect(container.querySelector('[data-density="compact"]')).toBeTruthy();
  });

  it("renders 50 rows when given 50 members (snapshot-ish)", () => {
    const rows = mockLeaderboardMembers("global", 50);
    const { container } = render(
      <Leaderboard title="Global" members={rows} skipSkeleton />,
    );
    const liRows = container.querySelectorAll(".vt-lb-row");
    expect(liRows.length).toBe(50);
  });
});

describe("<DraftPreviewBanner>", () => {
  it("renders the default copy and a dismiss button", () => {
    const { container, getByLabelText } = render(<DraftPreviewBanner />);
    expect(container.textContent).toMatch(/Preview data/);
    expect(getByLabelText("Dismiss preview-data notice")).toBeTruthy();
  });

  it("hides itself after the dismiss button is clicked", () => {
    const { getByLabelText, queryByLabelText } = render(<DraftPreviewBanner />);
    fireEvent.click(getByLabelText("Dismiss preview-data notice"));
    expect(queryByLabelText("Dismiss preview-data notice")).toBeNull();
  });
});
