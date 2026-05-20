/*
 * Copyright 2026 Tournamental contributors.
 * Licensed under the Apache Licence, Version 2.0 (the "Licence").
 * You may not use this file except in compliance with the Licence.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ---
 *
 * Internal helper: rasterise an editorial-preset satori tree to PNG.
 *
 * The four presets under this directory all share the same render path
 * (satori -> SVG -> resvg -> PNG) with the editorial font bundle. The
 * only thing that varies is the satori element tree itself, so we
 * centralise the rasterisation here so future preset additions are a
 * single function call.
 *
 * No public re-exports — consumers reach for the named `render(...)`
 * function on each preset instead.
 */

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { SIZE_DIMENSIONS, type Size } from "../editorial.js";
import { editorialFontSpecs, loadEditorialFonts } from "../fonts.js";
import type { SatoriElement } from "../jsdl.js";

export async function rasterisePreset(args: {
  tree: SatoriElement;
  size: Size;
}): Promise<Buffer> {
  const { width, height } = SIZE_DIMENSIONS[args.size];
  const bundle = await loadEditorialFonts();

  const svg = await satori(args.tree as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: editorialFontSpecs(bundle).map((f) => ({
      name: f.name,
      data: f.data as unknown as ArrayBuffer,
      weight: f.weight ?? 400,
      style: f.style ?? "normal",
    })),
  });

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}

/**
 * Common options every editorial preset accepts.
 *
 * The four presets in this directory follow the same call shape:
 *   - `size` chooses landscape (1200x630) or story (1080x1920).
 *   - All other fields are preset-specific and typed on each function.
 *
 * Default size is "og" (landscape) — the most common share target.
 */
export interface BasePresetArgs {
  /** "og" (1200x630) or "story" (1080x1920). Defaults to "og". */
  size?: Size;
}
