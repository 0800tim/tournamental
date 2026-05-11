/**
 * Vitest, <ConsentBanner/>.
 *
 *  - Renders on first visit (no localStorage decision).
 *  - Hides itself once the user clicks Accept; persists the choice.
 *  - On a return visit with a prior decision, doesn't render at all
 *    AND re-applies the decision to the dataLayer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

import { ConsentBanner } from "@/components/analytics/ConsentBanner";

const ORIGINAL_GTM = process.env.NEXT_PUBLIC_GTM_ID;

beforeEach(() => {
  process.env.NEXT_PUBLIC_GTM_ID = "GTM-TESTING";
  window.localStorage.clear();
  (window as unknown as { dataLayer?: unknown[] }).dataLayer = [];
});

afterEach(() => {
  if (ORIGINAL_GTM === undefined) {
    delete process.env.NEXT_PUBLIC_GTM_ID;
  } else {
    process.env.NEXT_PUBLIC_GTM_ID = ORIGINAL_GTM;
  }
});

describe("<ConsentBanner/>", () => {
  it("renders on first visit when no decision is persisted", async () => {
    const { findByTestId } = render(<ConsentBanner />);
    expect(await findByTestId("vt-consent-banner")).toBeTruthy();
  });

  it("hides itself and persists the decision after Accept", async () => {
    const { findByTestId, queryByTestId } = render(<ConsentBanner />);
    const accept = await findByTestId("vt-consent-accept");
    await act(async () => {
      fireEvent.click(accept);
    });
    await waitFor(() => {
      expect(queryByTestId("vt-consent-banner")).toBeNull();
    });
    const stored = window.localStorage.getItem("tournamental.consent.v1");
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!).decision).toBe("accept-all");
  });

  it("hides itself with essential-only and pushes denied ads", async () => {
    const { findByTestId, queryByTestId } = render(<ConsentBanner />);
    const essential = await findByTestId("vt-consent-essential");
    await act(async () => {
      fireEvent.click(essential);
    });
    await waitFor(() => {
      expect(queryByTestId("vt-consent-banner")).toBeNull();
    });
    const stored = window.localStorage.getItem("tournamental.consent.v1");
    expect(JSON.parse(stored!).decision).toBe("essential-only");
    const layer = (window as unknown as { dataLayer: Array<Record<string, unknown>> }).dataLayer;
    const consent = layer.find((e) => e.event === "consent_update");
    expect(consent?.ad_storage).toBe("denied");
    expect(consent?.analytics_storage).toBe("granted");
  });

  it("does not render when a prior decision exists", async () => {
    window.localStorage.setItem(
      "tournamental.consent.v1",
      JSON.stringify({ decision: "accept-all", at: new Date().toISOString() }),
    );
    const { queryByTestId } = render(<ConsentBanner />);
    // After effect runs the banner stays null.
    await waitFor(() => {
      expect(queryByTestId("vt-consent-banner")).toBeNull();
    });
    // And the prior decision is re-applied to the dataLayer.
    const layer = (window as unknown as { dataLayer: Array<Record<string, unknown>> }).dataLayer;
    expect(layer.some((e) => e.event === "consent_update")).toBe(true);
  });
});
