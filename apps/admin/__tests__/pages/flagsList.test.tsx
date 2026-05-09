import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FlagsList } from "@/app/(authed)/feature-flags/FlagsList";
import type { FeatureFlag } from "@/lib/api";

const ROWS: FeatureFlag[] = [
  { key: "polymarket_odds_chip", description: "Show odds", enabled: true, geo_overrides: { NZ: false } },
  { key: "voice_commentary", description: "Beta", enabled: false, geo_overrides: {} },
];

describe("<FlagsList>", () => {
  beforeEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as unknown as typeof fetch;
  });

  it("renders all flags with their enabled state", () => {
    render(<FlagsList rows={ROWS} role="super-admin" />);
    expect(screen.getByText("polymarket_odds_chip")).toBeInTheDocument();
    expect(screen.getByText("voice_commentary")).toBeInTheDocument();
    expect(screen.getByText("ON")).toBeInTheDocument();
    expect(screen.getByText("off")).toBeInTheDocument();
  });

  it("renders geo overrides", () => {
    render(<FlagsList rows={ROWS} role="super-admin" />);
    expect(screen.getByText(/NZ=off/)).toBeInTheDocument();
  });

  it("disables checkboxes for non-super-admin", () => {
    render(<FlagsList rows={ROWS} role="mod" />);
    const cbs = screen.getAllByRole("checkbox");
    expect(cbs.every((c) => c.hasAttribute("disabled"))).toBe(true);
  });

  it("posts when toggled by super-admin", async () => {
    render(<FlagsList rows={ROWS} role="super-admin" />);
    const cb = screen.getByLabelText("Toggle voice_commentary");
    fireEvent.click(cb);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/feature-flags/voice_commentary",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
