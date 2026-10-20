/**
 * Keyboard and screen-reader contract for the menu drawer: a real
 * dialog, focus moved in on open, trapped while open, returned on
 * close, Escape closes, and external links say they open a new tab.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, screen } from "./intl";

vi.mock("@/lib/auth/useUser", () => ({
  useUser: () => ({ status: "guest", user: null, profile: null, loading: false }),
}));

import { AppMenuDrawer } from "@/components/shell/AppMenuDrawer";

afterEach(() => cleanup());

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <button type="button" data-testid="opener">Open menu</button>
      <AppMenuDrawer open={open} onClose={onClose} />
    </>
  );
}

describe("<AppMenuDrawer> accessibility", () => {
  it("is a modal dialog named Menu on the panel itself, not the backdrop", () => {
    const { container } = render(<Harness open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(dialog.classList.contains("vt-drawer")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector(".vt-drawer-backdrop")!.getAttribute("role")).toBeNull();
  });

  it("moves focus to the close button on open and back to the opener on close", () => {
    const { rerender } = render(<Harness open={false} onClose={() => {}} />);
    const opener = screen.getByTestId("opener");
    opener.focus();
    rerender(<Harness open onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close menu" }));
    rerender(<Harness open={false} onClose={() => {}} />);
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab inside the panel", () => {
    render(<Harness open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    const focusables = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("brings focus back into the panel when it has drifted out", () => {
    render(<Harness open onClose={() => {}} />);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: "Tab" });
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("tells screen readers which links open a new tab", () => {
    render(<Harness open onClose={() => {}} />);
    const externals = screen.getAllByRole("link", { name: /\(opens in a new tab\)/ });
    expect(externals.length).toBeGreaterThan(0);
    for (const a of externals) expect(a.getAttribute("target")).toBe("_blank");
    const internal = screen.getByRole("link", { name: "Home" });
    expect(internal.getAttribute("target")).toBeNull();
  });
});
