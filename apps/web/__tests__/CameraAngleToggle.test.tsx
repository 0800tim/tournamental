/**
 * CameraAngleToggle component tests (jsdom).
 *
 * Verifies:
 *   - The four expected camera modes render with stable `data-cam`
 *     attributes (the contract the e2e suite + Playwright screenshots
 *     rely on).
 *   - The active state honours the currently-selected `mode` prop.
 *   - Clicking a button invokes `onChange` with the right mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CameraAngleToggle } from "@/components/CameraAngleToggle";

beforeEach(() => cleanup());
afterEach(() => cleanup());

const EXPECTED_MODES = ["director", "broadcast", "tactical", "follow"] as const;

describe("CameraAngleToggle", () => {
  it("renders all four camera-mode buttons with stable data-cam attributes", () => {
    render(<CameraAngleToggle mode="director" onChange={() => {}} />);
    const row = screen.getByTestId("camera-angle-row");
    const buttons = row.querySelectorAll("button[data-cam]");
    expect(buttons).toHaveLength(4);
    const cams = Array.from(buttons).map((b) =>
      (b as HTMLButtonElement).dataset.cam,
    );
    expect(cams).toEqual([...EXPECTED_MODES]);
  });

  it("marks the active button via data-active on the selected mode", () => {
    render(<CameraAngleToggle mode="broadcast" onChange={() => {}} />);
    const active = screen.getByTestId("cam-broadcast") as HTMLButtonElement;
    expect(active.dataset.active).toBe("1");
    expect(active.getAttribute("aria-checked")).toBe("true");
    // The other buttons must NOT be marked active.
    expect(
      (screen.getByTestId("cam-director") as HTMLButtonElement).dataset.active,
    ).toBe("0");
    expect(
      (screen.getByTestId("cam-tactical") as HTMLButtonElement).dataset.active,
    ).toBe("0");
    expect(
      (screen.getByTestId("cam-follow") as HTMLButtonElement).dataset.active,
    ).toBe("0");
  });

  it("clicking a button invokes onChange with the corresponding mode", () => {
    const onChange = vi.fn();
    render(<CameraAngleToggle mode="director" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("cam-follow"));
    expect(onChange).toHaveBeenCalledWith("follow");
    fireEvent.click(screen.getByTestId("cam-tactical"));
    expect(onChange).toHaveBeenCalledWith("tactical");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
