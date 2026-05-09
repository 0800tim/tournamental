import "@testing-library/jest-dom/vitest";
import { TextEncoder as NodeTE, TextDecoder as NodeTD } from "node:util";

// jsdom ships a TextEncoder whose output's prototype isn't Node's
// Uint8Array. Libraries like `jose` do `payload instanceof Uint8Array`
// which then fails. Force Node's TextEncoder/Decoder in the test
// environment so that check passes.
const g = globalThis as unknown as {
  TextEncoder: typeof TextEncoder;
  TextDecoder: typeof TextDecoder;
  ResizeObserver?: typeof ResizeObserver;
};
g.TextEncoder = NodeTE as unknown as typeof TextEncoder;
g.TextDecoder = NodeTD as unknown as typeof TextDecoder;

// Recharts uses ResizeObserver; jsdom doesn't ship one.
class RO implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (!g.ResizeObserver) {
  g.ResizeObserver = RO as unknown as typeof ResizeObserver;
}

// Recharts-internal Element.getBoundingClientRect returns 0 in jsdom;
// give it a deterministic non-zero size so charts render their layers.
if (typeof Element !== "undefined") {
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const r = orig.call(this);
    if (r.width === 0 && r.height === 0) {
      return { ...r, width: 800, height: 300, x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 300, toJSON() {} };
    }
    return r;
  };
}
