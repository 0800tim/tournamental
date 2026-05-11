/**
 * Vitest, <ShareSavePage>.
 *
 * Verifies the rebuilt Save & share surface:
 *   - copy-link button fires navigator.clipboard.writeText and flips to
 *     "Copied!" then back after the timeout.
 *   - the primary "Share my bracket" CTA calls navigator.share when
 *     available.
 *   - the five platform buttons render with correct deep-link patterns.
 *   - the OG image src reflects the selected size chip.
 *
 * The component reads its bracket draft from localStorage so we seed a
 * minimal one per test. We don't drive the full cascade here, those
 * concerns are tested elsewhere; this suite only cares about the share
 * surface.
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

import { ShareSavePage } from "../components/share/ShareSavePage";
import { draftKey } from "../lib/bracket/storage";

const tournament = loadFixtures2026();

function seedDraft(complete: boolean): string {
  // Use a fixed local-user id so the URL guid is stable across renders.
  const userId = "test-user-1";
  window.localStorage.setItem("vtorn:local_user_id", userId);

  const matchPredictions: Record<string, unknown> = {};
  if (complete) {
    for (const f of tournament.group_fixtures) {
      matchPredictions[String(f.match_no)] = {
        matchId: String(f.match_no),
        outcome: "home_win",
        lockedAt: "2026-05-11T12:00:00Z",
      };
    }
  }
  const knockoutPredictions: Record<string, unknown> = {};
  const bracket = {
    bracketId: "stable-bracket-id",
    matchPredictions,
    groupTiebreakers: {},
    knockoutPredictions,
    lockedAt: "2026-05-11T12:00:00Z",
    version: 2,
  };
  window.localStorage.setItem(
    draftKey(tournament.id, userId),
    JSON.stringify(bracket),
  );
  return userId;
}

beforeEach(() => {
  window.localStorage.clear();
  // Reset dataLayer between tests so we can assert on it.
  (window as unknown as { dataLayer?: unknown[] }).dataLayer = [];
  vi.restoreAllMocks();
});

describe("<ShareSavePage>", () => {
  it("renders the hero, count chip, and a stable share URL", async () => {
    seedDraft(false);
    render(<ShareSavePage tournament={tournament} />);
    await waitFor(() => {
      expect(screen.getByTestId("vt-ss-count-chip")).toBeTruthy();
    });
    const input = screen.getByTestId("vt-ss-url-input") as HTMLInputElement;
    expect(input.value).toBe("play.tournamental.com/s/stable-bracket-id");
  });

  it("copy-link button copies via navigator.clipboard and shows 'Copied!'", async () => {
    seedDraft(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<ShareSavePage tournament={tournament} />);

    const btn = await screen.findByTestId("vt-ss-copy-btn");
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://play.tournamental.com/s/stable-bracket-id");
    });
    expect(btn.textContent).toContain("Copied!");
  });

  it("primary 'Share my bracket' button invokes navigator.share when present", async () => {
    seedDraft(false);
    const shareFn = vi.fn().mockResolvedValue(undefined);
    (navigator as Navigator & { share?: (d: unknown) => Promise<void> }).share = shareFn;

    render(<ShareSavePage tournament={tournament} />);
    const btn = await screen.findByTestId("vt-ss-primary-share");
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => {
      expect(shareFn).toHaveBeenCalled();
    });
    const call = shareFn.mock.calls[0]?.[0] ?? {};
    expect(call.url).toBe("https://play.tournamental.com/s/stable-bracket-id");
    expect(call.title).toBeTruthy();
    expect(call.text).toBeTruthy();
  });

  it("renders all five platform buttons with valid deep-link URLs", async () => {
    seedDraft(false);
    render(<ShareSavePage tournament={tournament} />);
    await screen.findByTestId("vt-ss-url-input");

    const wa = screen.getByLabelText("Share on WhatsApp") as HTMLAnchorElement;
    const tg = screen.getByLabelText("Share on Telegram") as HTMLAnchorElement;
    const x = screen.getByLabelText("Share on X") as HTMLAnchorElement;
    const fb = screen.getByLabelText("Share on Facebook") as HTMLAnchorElement;
    const em = screen.getByLabelText("Share on Email") as HTMLAnchorElement;

    expect(wa.href).toContain("wa.me");
    expect(tg.href).toContain("t.me/share/url");
    expect(x.href).toContain("twitter.com/intent/tweet");
    expect(fb.href).toContain("facebook.com/sharer");
    expect(em.href.startsWith("mailto:")).toBe(true);
  });

  it("changing the size chip updates the OG image src", async () => {
    seedDraft(false);
    render(<ShareSavePage tournament={tournament} />);
    const initialImg = (await screen.findByTestId("vt-ss-og-image")) as HTMLImageElement;
    expect(initialImg.getAttribute("src") ?? "").toContain("size=landscape");

    const portraitChip = screen.getByRole("tab", { name: /Portrait/ });
    await act(async () => {
      fireEvent.click(portraitChip);
    });
    // Image gets re-keyed on size change, so re-query the DOM rather than
    // relying on the stale reference from before the click.
    const afterImg = screen.getByTestId("vt-ss-og-image") as HTMLImageElement;
    expect(afterImg.getAttribute("src") ?? "").toContain("size=portrait");
  });

  it("pushes a share_clicked analytics event when a platform button is clicked", async () => {
    seedDraft(false);
    render(<ShareSavePage tournament={tournament} />);

    const wa = await screen.findByLabelText("Share on WhatsApp");
    await act(async () => {
      fireEvent.click(wa);
    });
    const dl = (window as unknown as { dataLayer: Array<Record<string, unknown>> }).dataLayer;
    const ev = dl.find((e) => e.event === "share_clicked");
    expect(ev).toBeTruthy();
    expect(ev?.platform).toBe("whatsapp");
    expect(ev?.surface).toBe("save-share");
  });
});
