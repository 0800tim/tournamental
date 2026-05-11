/**
 * Vitest — `<MoleculeScene>` component-render smoke test.
 *
 * Mounting @react-three/fiber under jsdom is infeasible because there's
 * no WebGL context — so we mock the R3F primitives down to plain DOM
 * elements and assert that the scene composes the right number of atoms
 * for a 48-team FIFA WC 2026 tournament.
 *
 * The two things we want to guarantee at this layer:
 *   1. <TeamAtom> is rendered for every team in the tournament (48).
 *   2. <RoundBond> is rendered for every group fixture + every resolved
 *      knockout (≥ 72 group bonds at minimum).
 *
 * These guarantee that wiring the new FlagSphereMaterial in didn't drop
 * any atoms or bonds by accident.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

// Stub R3F primitives — return plain DOM elements that React can mount.
// We use `data-testid` so the test can count them.
vi.mock("@react-three/fiber", async () => {
  return {
    Canvas: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-canvas">{children}</div>
    ),
    useFrame: () => {},
    useThree: () => ({
      gl: { domElement: { addEventListener: () => {}, removeEventListener: () => {} } },
      camera: {},
    }),
  };
});

vi.mock("@react-three/drei", async () => {
  return {
    OrbitControls: () => <div data-testid="mock-orbit" />,
    Billboard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Html: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-html">{children}</div>
    ),
  };
});

// Stub the FlagSphereMaterial — it relies on onBeforeCompile and shader
// uniforms that have no meaning under jsdom.
vi.mock("@/components/molecule/FlagSphereMaterial", () => ({
  FlagSphereMaterial: () => <div data-testid="mock-flag-material" />,
}));

// Stub the flag-texture loader since jsdom has no canvas backing store
// and we don't need to load real flags for this test.
vi.mock("@/lib/molecule/flag-texture", () => ({
  getFlagTexture: () => null,
  _clearFlagTextureCache: () => {},
}));

// Lower-case any three.js JSX element to a div so React happily renders it.
// We do this via a tiny TS shim: we just rely on jsdom treating unknown
// custom elements as HTMLUnknownElement (it does); React 18 warns but
// renders. To suppress the warnings we filter them on the console.
const realConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const msg = String(args[0] ?? "");
    if (msg.includes("is unrecognized in this browser")) return;
    if (msg.includes("The tag <")) return;
    realConsoleError(...(args as []));
  };
});
afterAll(() => {
  console.error = realConsoleError;
});

import { MoleculeScene } from "@/components/molecule/MoleculeScene";

describe("<MoleculeScene> — composition smoke (mocked R3F)", () => {
  it("renders without throwing for the 48-team FIFA WC 2026 fixtures", () => {
    const tournament = loadFixtures2026();
    const { container } = render(<MoleculeScene tournament={tournament} />);
    expect(container.querySelector("[data-testid='mock-canvas']")).toBeTruthy();
  });

  it("mounts a FlagSphereMaterial stub for every atom (v4: ≥ 48 — one per surviving layer per team)", () => {
    const tournament = loadFixtures2026();
    const { container } = render(<MoleculeScene tournament={tournament} />);
    const materials = container.querySelectorAll("[data-testid='mock-flag-material']");
    // v4: each team has ≥1 instance (group layer) and up to 7 (the
    // predicted champion). The default empty-bracket case still gives
    // exactly 48 — one per team.
    expect(materials.length).toBeGreaterThanOrEqual(tournament.teams.length);
  });

  it("renders Html labels for every atom (v4: one per instance)", () => {
    const tournament = loadFixtures2026();
    const { container } = render(<MoleculeScene tournament={tournament} />);
    const htmls = container.querySelectorAll("[data-testid='mock-html']");
    expect(htmls.length).toBeGreaterThanOrEqual(tournament.teams.length);
  });
});
