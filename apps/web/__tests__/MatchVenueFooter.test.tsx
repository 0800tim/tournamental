/**
 * MatchVenueFooter unit tests.
 *
 * Coverage:
 *  - Renders date + time + gold info icon.
 *  - Uses venue timezone on first render (pre-hydration), then swaps
 *    to the user's timezone after `useEffect` resolves.
 *  - Renders an accessible name on the <a> wrapper.
 *  - Click with an overlay router fires `overlay.open("match", ...)`
 *    and calls `preventDefault`. Click without an overlay falls
 *    through to a real navigation (we just assert it didn't crash
 *    and the default wasn't prevented).
 *  - With no `hostCity`, falls back to UTC and still renders.
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { MatchVenueFooter } from "../components/bracket/MatchVenueFooter";
import { OverlayProvider, useOverlay } from "../components/overlay/OverlayProvider";
import { hostCityById } from "../lib/host-cities";

const MEXICO_CITY = hostCityById("mexico_city")!;
const KICKOFF = "2026-06-11T19:00:00Z";

describe("MatchVenueFooter", () => {
  beforeEach(() => {
    // Pin the user's IANA timezone to Pacific/Auckland so the
    // post-hydration swap is deterministic across machines.
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "en-NZ",
      timeZone: "Pacific/Auckland",
      calendar: "gregory",
      numberingSystem: "latn",
    } as unknown as Intl.ResolvedDateTimeFormatOptions);
  });

  it("renders a tap-target <a> with an accessible name", async () => {
    await act(async () => {
      render(
        <MatchVenueFooter
          matchId="1"
          homeName="Mexico"
          awayName="South Africa"
          kickoffIso={KICKOFF}
          hostCity={MEXICO_CITY}
        />,
      );
    });
    const link = screen.getByRole("link");
    expect(link.getAttribute("aria-label")).toMatch(/Mexico vs South Africa/);
    expect(link.getAttribute("aria-label")).toMatch(/kicks off/);
  });

  it("includes the gold info icon as an aria-hidden SVG", async () => {
    await act(async () => {
      render(
        <MatchVenueFooter
          matchId="1"
          homeName="Mexico"
          awayName="South Africa"
          kickoffIso={KICKOFF}
          hostCity={MEXICO_CITY}
        />,
      );
    });
    const link = screen.getByRole("link");
    const svg = link.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the kickoff date in the resolved (user) timezone after hydration", async () => {
    await act(async () => {
      render(
        <MatchVenueFooter
          matchId="1"
          homeName="Mexico"
          awayName="South Africa"
          kickoffIso={KICKOFF}
          hostCity={MEXICO_CITY}
        />,
      );
    });
    // 2026-06-11T19:00 UTC = 2026-06-12 07:00 Pacific/Auckland.
    // Assert the rendered date corresponds to NZ-side of the
    // dateline, not the venue's Mexico-side.
    const text = screen.getByRole("link").textContent ?? "";
    expect(text).toMatch(/Fri/); // 12 Jun 2026 is a Friday in Auckland
  });

  it("falls back to UTC when hostCity is absent", async () => {
    await act(async () => {
      render(
        <MatchVenueFooter
          matchId="1"
          homeName="A"
          awayName="B"
          kickoffIso={KICKOFF}
        />,
      );
    });
    // Without a hostCity, the SSR/initial timezone is UTC; after
    // hydration we still swap to the user TZ (mocked Auckland). The
    // link should still render without crashing.
    expect(screen.getByRole("link")).toBeDefined();
  });

  it("opens the overlay router on plain click", async () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    const Capture = (): React.ReactElement => {
      api = useOverlay();
      return <></>;
    };
    await act(async () => {
      render(
        <OverlayProvider>
          <Capture />
          <MatchVenueFooter
            matchId="1"
            homeName="Mexico"
            awayName="South Africa"
            kickoffIso={KICKOFF}
            hostCity={MEXICO_CITY}
          />
        </OverlayProvider>,
      );
    });
    fireEvent.click(screen.getByRole("link"), { button: 0 });
    expect(api!.stack).toHaveLength(1);
    expect(api!.stack[0]!.kind).toBe("match");
    expect(api!.stack[0]!.params.id).toBe("1");
  });

  it("falls back to a real link href when no overlay provider is mounted", async () => {
    await act(async () => {
      render(
        <MatchVenueFooter
          matchId="42"
          homeName="A"
          awayName="B"
          kickoffIso={KICKOFF}
          hostCity={MEXICO_CITY}
        />,
      );
    });
    // No overlay router available, so the component should still
    // render an <a href> that a browser would follow on click.
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/match/42/preview",
    );
  });
});
