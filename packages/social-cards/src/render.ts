/**
 * Rasterisation — the only place that touches `satori` and `@resvg/resvg-js`.
 *
 * Builders in `src/cards/` are pure and synchronous. They return a satori
 * element tree, which this module hands to satori (→ SVG) and resvg (→ PNG).
 *
 * Both functions accept an optional `fonts` array for callers that load
 * custom typefaces (e.g. the marketing build script that wants brand fonts).
 * If `fonts` is omitted, `loadDefaultFonts()` is used.
 */

import { buildCard } from "./cards/index.js";
import { sizes } from "./theme.js";
import type { CardInput } from "./types.js";
import type { FontSpec } from "./fonts.js";

export interface RenderRequest {
  input: CardInput;
  size: keyof typeof sizes;
  /** Optional override; defaults to `loadDefaultFonts()`. */
  fonts?: FontSpec[];
}

export interface RenderedCard {
  svg: string;
  /** Raw PNG bytes (Uint8Array). */
  png: Uint8Array;
  width: number;
  height: number;
}

export interface SVGRenderResult {
  svg: string;
  width: number;
  height: number;
}

/**
 * Render a card to SVG (no PNG step). Callers that just need a
 * vector representation skip the resvg cost.
 */
export async function renderToSVG(req: RenderRequest): Promise<SVGRenderResult> {
  const { default: satori } = await import("satori");
  const { input, size } = req;
  const dim = sizes[size];
  const tree = buildCard(input, size);

  const fonts = req.fonts ?? (await (await import("./fonts.js")).loadDefaultFonts());

  // satori expects React-style nodes or a JSON shape.
  // Our `el()` returns the JSON shape, which satori accepts.
  const svg = await satori(tree as unknown as never, {
    width: dim.width,
    height: dim.height,
    fonts: fonts.map((f) => ({
      name: f.name,
      // Satori types want ArrayBuffer | Buffer; Uint8Array is structurally fine.
      data: f.data as unknown as ArrayBuffer,
      weight: f.weight ?? 400,
      style: f.style ?? "normal",
    })),
  });

  return { svg, width: dim.width, height: dim.height };
}

/** Render a card to both SVG and PNG bytes. */
export async function renderToPNG(req: RenderRequest): Promise<RenderedCard> {
  const { svg, width, height } = await renderToSVG(req);
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "rgba(10,14,26,1)",
    font: { loadSystemFonts: false },
  });
  const png = resvg.render().asPng();
  return { svg, png: new Uint8Array(png), width, height };
}

/**
 * Convenience: produce both `og` and `story` variants for a card input
 * in a single call. This is what the marketing build script and the
 * dynamic Fastify route both want.
 */
export async function generateOG(
  input: CardInput,
  fonts?: FontSpec[],
): Promise<{ og: RenderedCard; story: RenderedCard }> {
  const [og, story] = await Promise.all([
    renderToPNG({ input, size: "og", fonts }),
    renderToPNG({ input, size: "story", fonts }),
  ]);
  return { og, story };
}
