/**
 * CollapsibleHUDCard component tests (jsdom).
 *
 * Verifies the collapse/expand toggle works AND that the open/collapsed
 * preference persists in localStorage under
 * `tournamental.match.hud.<id>`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleHUDCard } from "@/components/CollapsibleHUDCard";

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("CollapsibleHUDCard", () => {
  it("renders collapsed by default and toggles open on click", () => {
    render(
      <CollapsibleHUDCard id="t1" title="Scorers">
        <p data-testid="t1-content">child</p>
      </CollapsibleHUDCard>,
    );
    const shell = screen.getByTestId("hud-card-t1");
    const toggle = screen.getByTestId("hud-card-toggle-t1");
    expect(shell.dataset.collapsed).toBe("1");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    act(() => fireEvent.click(toggle));
    expect(shell.dataset.collapsed).toBe("0");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    act(() => fireEvent.click(toggle));
    expect(shell.dataset.collapsed).toBe("1");
  });

  it("persists the open state to localStorage under the namespaced key", () => {
    render(
      <CollapsibleHUDCard id="t2" title="Stats">
        <p>x</p>
      </CollapsibleHUDCard>,
    );
    act(() => fireEvent.click(screen.getByTestId("hud-card-toggle-t2")));
    expect(window.localStorage.getItem("tournamental.match.hud.t2")).toBe("open");

    act(() => fireEvent.click(screen.getByTestId("hud-card-toggle-t2")));
    expect(window.localStorage.getItem("tournamental.match.hud.t2")).toBe(
      "collapsed",
    );
  });

  it("restores the persisted state on mount, ignoring the default", () => {
    window.localStorage.setItem("tournamental.match.hud.t3", "open");
    render(
      <CollapsibleHUDCard id="t3" title="Subs" defaultCollapsed>
        <p>x</p>
      </CollapsibleHUDCard>,
    );
    // The effect runs synchronously in jsdom after mount.
    const shell = screen.getByTestId("hud-card-t3");
    expect(shell.dataset.collapsed).toBe("0");
  });

  it("renders the title + body testids for downstream tests to query", () => {
    render(
      <CollapsibleHUDCard id="t4" title="Match stats">
        <div data-testid="t4-inner">inner</div>
      </CollapsibleHUDCard>,
    );
    expect(screen.getByTestId("hud-card-t4")).toBeTruthy();
    expect(screen.getByTestId("hud-card-toggle-t4").textContent).toContain(
      "Match stats",
    );
    expect(screen.getByTestId("hud-card-body-t4")).toBeTruthy();
  });
});
