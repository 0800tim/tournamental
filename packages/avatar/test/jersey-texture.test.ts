/**
 * Unit tests for the jersey-texture pipeline.
 *
 * We don't have a real DOM in vitest's default Node environment, so we
 * inject a minimal canvas double via the `canvasFactory` /
 * `textureFactory` overrides. The tests assert behaviour, not pixels —
 * the pixel demo is `scripts/render-jersey-demo.mjs`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Kit } from "@tournamental/spec";
import {
  JerseyTextureCache,
  jerseyCacheKey,
  makeJerseyTexture,
} from "../src/jersey-texture.js";

interface RecordedCall {
  type: "fillStyle" | "fillRect" | "fillText" | "font";
  value: unknown;
}

class FakeCtx {
  public calls: RecordedCall[] = [];
  fillStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push({ type: "fillRect", value: { x, y, w, h, fill: this.fillStyle } });
  }
  fillText(text: string, x: number, y: number) {
    this.calls.push({ type: "fillText", value: { text, x, y, fill: this.fillStyle, font: this.font } });
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  ctx = new FakeCtx();
  getContext(_kind: string) {
    return this.ctx;
  }
}

class FakeTexture {
  constructor(public canvas: FakeCanvas) {}
  dispose() {}
}

const kit: Kit = {
  primary: "#75AADB",
  secondary: "#FFFFFF",
  text: "#000000",
  goalkeeper: { primary: "#1B1B1B", secondary: "#FFD700", text: "#FFFFFF" },
};

const fakeFactory = () => new FakeCanvas() as unknown as HTMLCanvasElement;
const fakeTextureFactory = (c: HTMLCanvasElement) =>
  new FakeTexture(c as unknown as FakeCanvas) as unknown as ReturnType<typeof makeJerseyTexture>;

describe("makeJerseyTexture", () => {
  it("paints primary background, secondary stripe, and the number on the back", () => {
    const tex = makeJerseyTexture(kit, 10, false, {
      canvasFactory: fakeFactory,
      textureFactory: fakeTextureFactory,
    });
    const ctx = ((tex as unknown as FakeTexture).canvas).ctx;
    const fills = ctx.calls.filter((c) => c.type === "fillRect");
    expect(fills).toHaveLength(2);
    expect((fills[0]!.value as { fill: string }).fill).toBe(kit.primary);
    expect((fills[1]!.value as { fill: string }).fill).toBe(kit.secondary);

    const text = ctx.calls.find((c) => c.type === "fillText");
    expect(text).toBeTruthy();
    expect((text!.value as { text: string }).text).toBe("10");
    expect((text!.value as { fill: string }).fill).toBe(kit.text);
  });

  it("uses goalkeeper kit colours when isGK=true and kit.goalkeeper is set", () => {
    const tex = makeJerseyTexture(kit, 23, true, {
      canvasFactory: fakeFactory,
      textureFactory: fakeTextureFactory,
    });
    const fills = ((tex as unknown as FakeTexture).canvas).ctx.calls.filter(
      (c) => c.type === "fillRect"
    );
    expect((fills[0]!.value as { fill: string }).fill).toBe(kit.goalkeeper!.primary);
    expect((fills[1]!.value as { fill: string }).fill).toBe(kit.goalkeeper!.secondary);
  });

  it("falls back to outfield kit when isGK=true but kit.goalkeeper is missing", () => {
    const noGkKit: Kit = { primary: "#FF0000", secondary: "#FFFFFF" };
    const tex = makeJerseyTexture(noGkKit, 1, true, {
      canvasFactory: fakeFactory,
      textureFactory: fakeTextureFactory,
    });
    const fills = ((tex as unknown as FakeTexture).canvas).ctx.calls.filter(
      (c) => c.type === "fillRect"
    );
    expect((fills[0]!.value as { fill: string }).fill).toBe(noGkKit.primary);
  });

  it("defaults the number to white when kit.text is omitted", () => {
    const noTextKit: Kit = { primary: "#0F4C81", secondary: "#FFFFFF" };
    const tex = makeJerseyTexture(noTextKit, 7, false, {
      canvasFactory: fakeFactory,
      textureFactory: fakeTextureFactory,
    });
    const text = ((tex as unknown as FakeTexture).canvas).ctx.calls.find(
      (c) => c.type === "fillText"
    );
    expect((text!.value as { fill: string }).fill).toBe("#FFFFFF");
  });
});

describe("JerseyTextureCache", () => {
  let cache: JerseyTextureCache;

  beforeEach(() => {
    cache = new JerseyTextureCache({
      canvasFactory: fakeFactory,
      textureFactory: fakeTextureFactory,
    });
  });

  it("returns the same texture instance for repeated (team, number, isGK)", () => {
    const a = cache.get("AR", kit, 10);
    const b = cache.get("AR", kit, 10);
    expect(a).toBe(b);
    expect(cache.size()).toBe(1);
  });

  it("treats GK and outfield variants as separate cache entries", () => {
    cache.get("AR", kit, 23, false);
    cache.get("AR", kit, 23, true);
    expect(cache.size()).toBe(2);
  });

  it("scopes textures by team id", () => {
    cache.get("AR", kit, 10);
    cache.get("FR", kit, 10);
    expect(cache.size()).toBe(2);
    expect(cache.has("AR", 10)).toBe(true);
    expect(cache.has("FR", 10)).toBe(true);
    expect(cache.has("BR", 10)).toBe(false);
  });

  it("disposes all entries and empties the cache", () => {
    cache.get("AR", kit, 10);
    cache.get("AR", kit, 11);
    expect(cache.size()).toBe(2);
    cache.dispose();
    expect(cache.size()).toBe(0);
  });
});

describe("jerseyCacheKey", () => {
  it("encodes outfield vs GK distinctly", () => {
    expect(jerseyCacheKey("AR", 1, true)).toBe("AR|1|gk");
    expect(jerseyCacheKey("AR", 1, false)).toBe("AR|1|out");
  });
});
