/**
 * Phase-4 ReplayHUD component tests (jsdom).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ReplayHUD } from "@/components/ReplayHUD";
import { replayHudBus } from "@/lib/director/replay-hud-bus";

beforeEach(() => {
  replayHudBus.reset();
  cleanup();
});

describe("ReplayHUD", () => {
  it("hides the REPLAY badge during normal broadcast", () => {
    render(<ReplayHUD />);
    expect(screen.queryByTestId("replay-hud-badge")).toBeNull();
  });

  it("shows the REPLAY badge during goal-replay", () => {
    render(<ReplayHUD />);
    act(() => {
      replayHudBus.publish({ cam: "goal-replay", slowMoRate: 0.25 });
    });
    expect(screen.getByTestId("replay-hud-badge")).toBeTruthy();
    expect(screen.getByTestId("replay-hud-rate").textContent).toBe("0.25×");
  });

  it("keeps the badge during the player-track celebration cut", () => {
    render(<ReplayHUD />);
    act(() => {
      replayHudBus.publish({ cam: "player-track", slowMoRate: 1 });
    });
    expect(screen.getByTestId("replay-hud-badge")).toBeTruthy();
    expect(screen.queryByTestId("replay-hud-rate")).toBeNull();
  });

  it("renders the score widget continuously", () => {
    render(<ReplayHUD />);
    act(() => {
      replayHudBus.publish({ scoreHome: 2, scoreAway: 1, scorerTeam: "ARG" });
    });
    const score = screen.getByTestId("replay-hud-score");
    expect(score.textContent).toContain("ARG");
    expect(score.textContent).toContain("2");
    expect(score.textContent).toContain("1");
  });

  it("renders the scorer nameplate with the goal minute", () => {
    render(<ReplayHUD />);
    act(() => {
      replayHudBus.publish({
        cam: "goal-replay",
        scorerName: "L. Messi",
        goalAtMatchSec: 23 * 60,
        secsSinceCut: 0.4,
      });
    });
    const sc = screen.getByTestId("replay-hud-scorer");
    expect(sc.textContent).toContain("L. Messi");
    expect(sc.textContent).toContain("23'");
  });

  it("scorer plate fades in over 0.4 s after the cut", () => {
    render(<ReplayHUD />);
    act(() => {
      replayHudBus.publish({
        cam: "goal-replay",
        scorerName: "L. Messi",
        secsSinceCut: 0,
      });
    });
    const plate = screen.getByTestId("replay-hud-scorer") as HTMLElement;
    expect(plate.style.opacity).toBe("0");

    act(() => {
      replayHudBus.publish({ secsSinceCut: 0.2 });
    });
    expect(Number(plate.style.opacity)).toBeCloseTo(0.5, 1);

    act(() => {
      replayHudBus.publish({ secsSinceCut: 1 });
    });
    expect(plate.style.opacity).toBe("1");
  });

  it("data-visible attribute reflects badge visibility", () => {
    render(<ReplayHUD />);
    const root = screen.getByTestId("replay-hud") as HTMLElement;
    expect(root.dataset.visible).toBe("0");
    act(() => {
      replayHudBus.publish({ cam: "goal-replay" });
    });
    expect(root.dataset.visible).toBe("1");
    act(() => {
      replayHudBus.publish({ cam: "broadcast" });
    });
    expect(root.dataset.visible).toBe("0");
  });
});
