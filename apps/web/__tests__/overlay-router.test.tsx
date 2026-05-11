/**
 * Overlay router unit tests.
 *
 * Coverage:
 *  - URL codec round-trip (parse → encode → parse)
 *  - Provider state machine: open / close / closeAll / replace
 *  - History push on open, replace on replace
 *  - popstate (browser back) re-snaps the stack from the URL
 *  - Sheet UI: Escape closes, backdrop click closes, drag-down closes,
 *    initial focus moves to close button
 *  - OverlayLink: plain click opens overlay, modified click hard-navs,
 *    falls back to plain link when no provider is mounted
 *  - Cold-load hydration: a deep-link URL on mount hydrates the stack
 *
 * jsdom doesn't simulate real touch end-to-end so the drag-down test
 * dispatches `pointerdown` / `pointermove` / `pointerup` synthetically;
 * that's enough to verify the gesture state-machine because the Sheet
 * uses pointer events (not touch events).
 */

// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import {
  OverlayProvider,
  OverlayRoot,
  OverlayLink,
  Sheet,
  encodeOverlayUrl,
  parseOverlayUrl,
  stacksEqual,
  useOverlay,
} from "../components/overlay";

// ---------------- URL codec ----------------

describe("overlay URL codec", () => {
  it("parses a single-overlay URL", () => {
    const stack = parseOverlayUrl("?overlay=team&code=NZL");
    expect(stack).toHaveLength(1);
    expect(stack[0]!.kind).toBe("team");
    expect(stack[0]!.params.code).toBe("NZL");
  });

  it("parses a two-overlay stack", () => {
    const stack = parseOverlayUrl("?overlay=team,match&code=NZL&id=55");
    expect(stack).toHaveLength(2);
    expect(stack[0]!.kind).toBe("team");
    expect(stack[1]!.kind).toBe("match");
    // Both frames see all params (each component reads only its own keys).
    expect(stack[0]!.params.code).toBe("NZL");
    expect(stack[1]!.params.id).toBe("55");
  });

  it("ignores unknown kinds", () => {
    const stack = parseOverlayUrl("?overlay=team,bogus,match&code=NZL&id=55");
    expect(stack).toHaveLength(2);
    expect(stack.map((f) => f.kind)).toEqual(["team", "match"]);
  });

  it("returns empty when no overlay key is present", () => {
    expect(parseOverlayUrl("?foo=bar")).toEqual([]);
    expect(parseOverlayUrl("")).toEqual([]);
  });

  it("encodes a single-overlay URL", () => {
    const out = encodeOverlayUrl([{ kind: "team", params: { code: "NZL" } }]);
    const sp = new URLSearchParams(out);
    expect(sp.get("overlay")).toBe("team");
    expect(sp.get("code")).toBe("NZL");
  });

  it("preserves non-overlay params on the existing search", () => {
    const out = encodeOverlayUrl(
      [{ kind: "team", params: { code: "NZL" } }],
      "?utm_source=newsletter&theme=light",
    );
    const sp = new URLSearchParams(out);
    expect(sp.get("utm_source")).toBe("newsletter");
    expect(sp.get("theme")).toBe("light");
    expect(sp.get("overlay")).toBe("team");
  });

  it("round-trips a stack: kinds + per-frame param keys preserved", () => {
    // Each frame's *own* keys survive the round-trip; the URL flattens
    // params across frames so every frame on the way back sees every
    // key, but readers only consume the keys they know about, the
    // contract we care about.
    const original = [
      { kind: "team" as const, params: { code: "NZL" } as Record<string, string> },
      { kind: "match" as const, params: { id: "55" } as Record<string, string> },
    ];
    const encoded = encodeOverlayUrl(original);
    const parsed = parseOverlayUrl(encoded);
    expect(parsed.map((f) => f.kind)).toEqual(["team", "match"]);
    // Every frame sees both keys (param flattening is intentional).
    expect(parsed[0]!.params.code).toBe("NZL");
    expect(parsed[0]!.params.id).toBe("55");
    expect(parsed[1]!.params.code).toBe("NZL");
    expect(parsed[1]!.params.id).toBe("55");
  });

  it("round-trips a single-frame stack exactly", () => {
    const original = [{ kind: "team" as const, params: { code: "NZL" } }];
    const encoded = encodeOverlayUrl(original);
    const parsed = parseOverlayUrl(encoded);
    expect(stacksEqual(parsed, original)).toBe(true);
  });

  it("emits an empty string for an empty stack with no existing params", () => {
    expect(encodeOverlayUrl([])).toBe("");
  });

  it("strips overlay key when stack becomes empty", () => {
    const out = encodeOverlayUrl([], "?overlay=team&code=NZL&utm=a");
    const sp = new URLSearchParams(out);
    expect(sp.get("overlay")).toBeNull();
    // utm survives.
    expect(sp.get("utm")).toBe("a");
    // code does too (we only strip claimed keys when stack is non-empty;
    // when empty, nothing claims `code`, so it stays. This is a
    // conservative choice, the consumer can pass an empty existing
    // search if they want a hard reset).
  });

  it("stacksEqual catches param differences", () => {
    expect(
      stacksEqual(
        [{ kind: "team", params: { code: "NZL" } }],
        [{ kind: "team", params: { code: "ARG" } }],
      ),
    ).toBe(false);
  });
});

// ---------------- Provider ----------------

function setLocation(url: string): void {
  // jsdom permits in-place URL mutation via history.replaceState.
  window.history.replaceState({}, "", url);
}

function ProviderHarness(props: {
  initial?: string;
  onApi?: (api: ReturnType<typeof useOverlay>) => void;
}) {
  const ApiCapture = (): React.ReactElement => {
    const api = useOverlay();
    if (props.onApi) props.onApi(api);
    return <span data-testid="capture-stack-len">{api.stack.length}</span>;
  };
  return (
    <OverlayProvider>
      <ApiCapture />
      <OverlayRoot />
    </OverlayProvider>
  );
}

describe("OverlayProvider", () => {
  beforeEach(() => {
    setLocation("/world-cup-2026");
  });

  it("hydrates the stack from the URL on mount", () => {
    setLocation("/world-cup-2026?overlay=team&code=NZL");
    let api: ReturnType<typeof useOverlay> | null = null;
    render(<ProviderHarness onApi={(a) => (api = a)} />);
    expect(api).not.toBeNull();
    expect(api!.stack).toHaveLength(1);
    expect(api!.stack[0]!.kind).toBe("team");
    expect(api!.stack[0]!.params.code).toBe("NZL");
  });

  it("open() pushes onto stack and updates the URL", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    render(<ProviderHarness onApi={(a) => (api = a)} />);
    act(() => {
      api!.open("team", { code: "ARG" });
    });
    expect(api!.stack).toHaveLength(1);
    expect(window.location.search).toContain("overlay=team");
    expect(window.location.search).toContain("code=ARG");
  });

  it("close() pops the top frame", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    render(<ProviderHarness onApi={(a) => (api = a)} />);
    act(() => {
      api!.open("team", { code: "ARG" });
    });
    act(() => {
      api!.open("match", { id: "55" });
    });
    expect(api!.stack).toHaveLength(2);
    act(() => {
      api!.close();
    });
    expect(api!.stack).toHaveLength(1);
    expect(api!.stack[0]!.kind).toBe("team");
  });

  it("closeAll() empties the stack", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    render(<ProviderHarness onApi={(a) => (api = a)} />);
    act(() => {
      api!.open("team", { code: "ARG" });
      api!.open("match", { id: "55" });
    });
    act(() => {
      api!.closeAll();
    });
    expect(api!.stack).toHaveLength(0);
    expect(window.location.search).not.toContain("overlay=");
  });

  it("replace() swaps the top without pushing a new history entry", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    render(<ProviderHarness onApi={(a) => (api = a)} />);
    act(() => {
      api!.open("team", { code: "ARG" });
    });
    const histLenBefore = window.history.length;
    act(() => {
      api!.replace("team", { code: "FRA" });
    });
    // jsdom's history.length doesn't increment on replaceState, that's
    // the contract we want.
    expect(window.history.length).toBe(histLenBefore);
    expect(api!.stack).toHaveLength(1);
    expect(api!.stack[0]!.params.code).toBe("FRA");
  });

  it("popstate re-snaps the stack to whatever the URL says", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    render(<ProviderHarness onApi={(a) => (api = a)} />);
    act(() => {
      api!.open("team", { code: "ARG" });
    });
    expect(api!.stack).toHaveLength(1);
    // Simulate browser back: change URL, fire popstate.
    act(() => {
      window.history.replaceState({}, "", "/world-cup-2026");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(api!.stack).toHaveLength(0);
  });

  it("opening the same kind+params twice is a no-op", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    render(<ProviderHarness onApi={(a) => (api = a)} />);
    act(() => {
      api!.open("team", { code: "ARG" });
    });
    const before = api!.stack;
    act(() => {
      api!.open("team", { code: "ARG" });
    });
    expect(api!.stack).toBe(before); // identity-equal
  });

  it("opening the same kind with new params replaces the top frame", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    render(<ProviderHarness onApi={(a) => (api = a)} />);
    act(() => {
      api!.open("team", { code: "ARG" });
    });
    act(() => {
      api!.open("team", { code: "FRA" });
    });
    expect(api!.stack).toHaveLength(1);
    expect(api!.stack[0]!.params.code).toBe("FRA");
  });

  it("body class toggles vt-overlay-open while overlays are open", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    render(<ProviderHarness onApi={(a) => (api = a)} />);
    expect(document.body.classList.contains("vt-overlay-open")).toBe(false);
    act(() => {
      api!.open("team", { code: "ARG" });
    });
    expect(document.body.classList.contains("vt-overlay-open")).toBe(true);
    act(() => {
      api!.closeAll();
    });
    expect(document.body.classList.contains("vt-overlay-open")).toBe(false);
  });
});

// ---------------- Sheet ----------------

describe("Sheet", () => {
  it("renders title + close button + body", () => {
    const onClose = vi.fn();
    render(
      <Sheet title="My Sheet" onClose={onClose}>
        <p>hello</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("My Sheet")).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByLabelText("Close")).toBeTruthy();
  });

  it("focus moves to the close button on mount", () => {
    const onClose = vi.fn();
    render(
      <Sheet title="My Sheet" onClose={onClose}>
        <p>hello</p>
      </Sheet>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Close"));
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    render(
      <Sheet title="My Sheet" onClose={onClose}>
        <p>hello</p>
      </Sheet>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet title="My Sheet" onClose={onClose}>
        <p>hello</p>
      </Sheet>,
    );
    const backdrop = container.querySelector("[data-overlay-backdrop]");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <Sheet title="My Sheet" onClose={onClose}>
        <p>hello</p>
      </Sheet>,
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // jsdom's PointerEvent constructor swallows clientY / pointerType /
  // pointerId, they don't propagate to the React synthetic event when
  // dispatched via fireEvent. Workaround: dispatch a real
  // PointerEvent we build ourselves, mimicking React's expected shape.
  function dispatchPointer(
    el: HTMLElement,
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    init: { clientY: number; pointerId?: number; pointerType?: string; timeStamp?: number },
  ): void {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
      clientY: number;
      clientX: number;
      pointerId: number;
      pointerType: string;
      button: number;
      buttons: number;
    };
    Object.defineProperty(ev, "clientY", { value: init.clientY });
    Object.defineProperty(ev, "clientX", { value: 0 });
    Object.defineProperty(ev, "pointerId", { value: init.pointerId ?? 1 });
    Object.defineProperty(ev, "pointerType", { value: init.pointerType ?? "touch" });
    Object.defineProperty(ev, "button", { value: 0 });
    Object.defineProperty(ev, "buttons", { value: type === "pointerup" ? 0 : 1 });
    if (init.timeStamp != null) {
      Object.defineProperty(ev, "timeStamp", { value: init.timeStamp });
    }
    el.dispatchEvent(ev);
  }

  it("drag-down past the threshold calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet title="My Sheet" onClose={onClose}>
        <p>hello</p>
      </Sheet>,
    );
    const handle = container.querySelector(".vt-overlay-handle") as HTMLElement;
    expect(handle).toBeTruthy();
    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 1000 });
    dispatchPointer(handle, "pointermove", { clientY: 250, timeStamp: 1050 });
    dispatchPointer(handle, "pointerup", { clientY: 250, timeStamp: 1100 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a small drag below the threshold does NOT close", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet title="My Sheet" onClose={onClose}>
        <p>hello</p>
      </Sheet>,
    );
    const handle = container.querySelector(".vt-overlay-handle") as HTMLElement;
    // Slow drag: spread the move across many ticks so velocity stays
    // well under the 0.6 px/ms dismissal threshold.
    let t = 1000;
    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: t });
    for (let dy = 5; dy <= 30; dy += 5) {
      t += 300; // 300 ms per move ≈ 0.017 px/ms
      dispatchPointer(handle, "pointermove", { clientY: 100 + dy, timeStamp: t });
    }
    t += 300;
    dispatchPointer(handle, "pointerup", { clientY: 130, timeStamp: t });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------- OverlayLink ----------------

describe("OverlayLink", () => {
  beforeEach(() => {
    setLocation("/world-cup-2026");
  });

  it("plain click opens the overlay", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    const Capture = (): React.ReactElement => {
      api = useOverlay();
      return <></>;
    };
    render(
      <OverlayProvider>
        <Capture />
        <OverlayLink href="/team/NZL" overlayKind="team" overlayParams={{ code: "NZL" }}>
          NZL
        </OverlayLink>
      </OverlayProvider>,
    );
    fireEvent.click(screen.getByText("NZL"), { button: 0 });
    expect(api!.stack).toHaveLength(1);
    expect(api!.stack[0]!.kind).toBe("team");
  });

  it("Cmd+click does NOT open the overlay (escape hatch to hard nav)", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    const Capture = (): React.ReactElement => {
      api = useOverlay();
      return <></>;
    };
    render(
      <OverlayProvider>
        <Capture />
        <OverlayLink href="/team/NZL" overlayKind="team" overlayParams={{ code: "NZL" }}>
          NZL
        </OverlayLink>
      </OverlayProvider>,
    );
    fireEvent.click(screen.getByText("NZL"), { metaKey: true });
    expect(api!.stack).toHaveLength(0);
  });

  it("middle-click does NOT open the overlay", () => {
    let api: ReturnType<typeof useOverlay> | null = null;
    const Capture = (): React.ReactElement => {
      api = useOverlay();
      return <></>;
    };
    render(
      <OverlayProvider>
        <Capture />
        <OverlayLink href="/team/NZL" overlayKind="team" overlayParams={{ code: "NZL" }}>
          NZL
        </OverlayLink>
      </OverlayProvider>,
    );
    fireEvent.click(screen.getByText("NZL"), { button: 1 });
    expect(api!.stack).toHaveLength(0);
  });

  it("falls back to plain navigation when no provider is mounted", () => {
    // No <OverlayProvider>, the link should render a normal anchor and
    // not throw.
    expect(() =>
      render(
        <OverlayLink href="/team/NZL" overlayKind="team" overlayParams={{ code: "NZL" }}>
          NZL
        </OverlayLink>,
      ),
    ).not.toThrow();
    const a = screen.getByText("NZL").closest("a");
    expect(a).toBeTruthy();
    expect(a!.getAttribute("href")).toBe("/team/NZL");
  });
});
