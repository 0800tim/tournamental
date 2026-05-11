/**
 * Vitest, PillTabs active-state and click-handler smoke.
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { PillTabs } from "@/components/shell/PillTabs";

describe("<PillTabs>", () => {
  const tabs = [
    { id: "a", label: "Group stage" },
    { id: "b", label: "Knockouts" },
    { id: "c", label: "Save and share" },
  ];

  it("renders every tab label", () => {
    const { getByText } = render(<PillTabs tabs={tabs} active="a" />);
    expect(getByText("Group stage")).toBeTruthy();
    expect(getByText("Knockouts")).toBeTruthy();
    expect(getByText("Save and share")).toBeTruthy();
  });

  it("marks the active tab with aria-selected", () => {
    const { getByText } = render(<PillTabs tabs={tabs} active="b" />);
    const active = getByText("Knockouts");
    expect(active.getAttribute("aria-selected")).toBe("true");
    const inactive = getByText("Group stage");
    expect(inactive.getAttribute("aria-selected")).toBe("false");
  });

  it("fires onChange with the clicked tab id", () => {
    const fn = vi.fn();
    const { getByText } = render(
      <PillTabs tabs={tabs} active="a" onChange={fn} />,
    );
    fireEvent.click(getByText("Knockouts"));
    expect(fn).toHaveBeenCalledWith("b");
  });
});
