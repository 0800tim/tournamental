/**
 * Vitest — `/world-cup-2026/molecule` page render-smoke test.
 *
 * We mock `MoleculePageClient` to a tiny stub so we don't have to mount
 * @react-three/fiber under jsdom (no WebGL context). The thing we care
 * about at this layer is "the server component composes correctly: it
 * loads the tournament, enriches it, and passes it to the client
 * scene without throwing".
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import type { Tournament } from "@vtorn/bracket-engine";

// Stub the client component so the test runner doesn't try to spin up
// @react-three/fiber + drei inside jsdom.
vi.mock("../app/world-cup-2026/molecule/_components/MoleculePageClient", () => ({
  MoleculePageClient: ({ tournament }: { tournament: Tournament }) => (
    <div data-testid="molecule-client-stub">
      <p>{tournament.name}</p>
      <p data-testid="team-count">{tournament.teams.length}</p>
    </div>
  ),
}));

// AppShell pulls in client subcomponents (RegisterSW, etc) that touch
// `window`; jsdom handles that but for speed we shrink AppShell to a
// passthrough.
vi.mock("@/components/shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

import WorldCup2026MoleculePage from "../app/world-cup-2026/molecule/page";

describe("/world-cup-2026/molecule page (server component)", () => {
  it("renders without throwing", () => {
    const { container } = render(<WorldCup2026MoleculePage />);
    expect(container.textContent).toBeTruthy();
  });

  it("passes the FIFA World Cup tournament to the client scene", () => {
    const { getByTestId } = render(<WorldCup2026MoleculePage />);
    const stub = getByTestId("molecule-client-stub");
    expect(stub.textContent).toMatch(/World Cup 2026/i);
  });

  it("passes the full 48-team roster through", () => {
    const { getByTestId } = render(<WorldCup2026MoleculePage />);
    const count = Number(getByTestId("team-count").textContent ?? "0");
    expect(count).toBe(48);
  });
});
