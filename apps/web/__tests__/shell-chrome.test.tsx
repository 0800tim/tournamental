/**
 * The AppBar, the drawer and the nav link lists read the tournament
 * they are about from ShellModeProvider and the registry, never from a
 * hard-coded name (2026-10-20). Each mode is rendered with an explicit
 * provider value so the labels can be checked against the registry.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "./helpers/render";
import { ShellModeProvider, defaultShellMode, type ShellModeState } from "@/lib/archive/context";
import { summarise, tournamentBySlug, upcomingTournament } from "@/lib/tournaments/registry";
import { wordmarkSub } from "@/components/shell/AppBar";
import {
  DEFAULT_ROUTE_BASE,
  DRAWER_PRIMARY,
  drawerPrimaryFor,
  forArchive,
  primaryDesktopFor,
  rebaseLinks,
} from "@/components/shell/nav-links";

vi.mock("@/lib/auth/useUser", () => ({
  useUser: () => ({ status: "guest", user: null, profile: null, loading: false }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { AppMenuDrawer } from "@/components/shell/AppMenuDrawer";

const fwc = summarise(tournamentBySlug("fwc2026"))!;
const rwc = summarise(upcomingTournament())!;

function state(partial: Partial<ShellModeState>): ShellModeState {
  return { ...defaultShellMode(), ...partial };
}

describe("wordmarkSub", () => {
  it("names the tournament from the registry in every mode", () => {
    expect(wordmarkSub(state({ mode: "archive", current: fwc }))).toBe("FWC 2026 archive");
    expect(wordmarkSub(state({ mode: "hub", current: null, upcoming: rwc }))).toBe("RWC 2027 next");
    expect(wordmarkSub(state({ mode: "live", current: fwc }))).toBe("FWC2026");
  });

  it("degrades to an empty or generic label rather than a stale tournament", () => {
    expect(wordmarkSub(state({ mode: "live", current: null }))).toBe("");
    expect(wordmarkSub(state({ mode: "hub", current: null, upcoming: null }))).toBe("");
    expect(wordmarkSub(state({ mode: "archive", current: null }))).toBe("archive");
  });
});

describe("nav link lists follow the route base", () => {
  it("leaves the written lists untouched for the FWC 2026 base", () => {
    expect(DEFAULT_ROUTE_BASE).toBe("/world-cup-2026");
    expect(drawerPrimaryFor("/world-cup-2026")).toBe(DRAWER_PRIMARY);
  });

  it("swaps href and matchPrefix for another tournament's base, nothing else", () => {
    const links = primaryDesktopFor("/rwc-2027");
    const play = links.find((l) => l.label === "Play (Predict)")!;
    expect(play.href).toBe("/rwc-2027");
    expect(play.matchPrefix).toBe("/rwc-2027");
    const molecule = links.find((l) => l.label === "Molecule")!;
    expect(molecule.href).toBe("/rwc-2027/molecule");
    const leaderboard = rebaseLinks(DRAWER_PRIMARY, "/rwc-2027").find((l) => l.label === "Leaderboard")!;
    expect(leaderboard.href).toBe("/leaderboard");
  });

  it("relabels the bracket row on the archive for the given base", () => {
    const archived = forArchive(drawerPrimaryFor("/rwc-2027"), true, "/rwc-2027");
    expect(archived.find((l) => l.href === "/rwc-2027")!.label).toBe("Bracket");
  });
});

describe("<AppMenuDrawer> labels and archive links come from the registry", () => {
  it("archive mode: the current tournament's name and an Archive suffix", () => {
    render(
      <ShellModeProvider value={state({ mode: "archive", slug: "fwc2026", current: fwc })}>
        <AppMenuDrawer open onClose={() => {}} />
      </ShellModeProvider>,
    );
    expect(screen.getByText(/FIFA World Cup 2026™ · Archive/)).toBeTruthy();
  });

  it("hub mode: the upcoming tournament's name and one row per archived tournament", () => {
    render(
      <ShellModeProvider value={state({ mode: "hub", current: null, upcoming: rwc })}>
        <AppMenuDrawer open onClose={() => {}} />
      </ShellModeProvider>,
    );
    expect(screen.getByText("Rugby World Cup 2027™")).toBeTruthy();
    const archiveLink = screen.getByRole("link", { name: /FWC 2026 archive/ });
    expect(archiveLink.getAttribute("href")).toBe("https://fwc2026.tournamental.com/");
  });

  it("live mode with another tournament current: links move to its route base", () => {
    const next = { ...rwc, routeBase: "/rwc-2027" };
    render(
      <ShellModeProvider value={state({ mode: "live", current: next })}>
        <AppMenuDrawer open onClose={() => {}} />
      </ShellModeProvider>,
    );
    expect(screen.getByText("Rugby World Cup 2027™")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Play \(Predict\)/ }).getAttribute("href")).toBe("/rwc-2027");
    expect(screen.getByRole("link", { name: /Match calendar/ }).getAttribute("href")).toBe("/rwc-2027/calendar");
  });
});
