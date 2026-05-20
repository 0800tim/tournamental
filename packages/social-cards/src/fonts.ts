/**
 * Font registration for satori.
 *
 * satori needs every weight / style we render with as a Buffer. We load
 * fonts lazily so unit tests don't pay the price of reading binary files
 * unless the test actually rasterises a card.
 *
 * Default fonts (loaded via fs.readFile from the package's `fonts/`
 * directory; see fonts/README.md for licensing):
 *  - Inter Regular (400)
 *  - Inter Bold (700)
 *  - Inter Black (900)
 *  - Noto Naskh Arabic Regular (400) — fallback for ar / fa / ur
 *  - Noto Sans JP Bold (700)        — fallback for ja
 *
 * Callers may override by passing a custom FontSpec[] into renderToSVG /
 * renderToPNG. This is what the marketing build script does.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface FontSpec {
  /** Family name as referenced from CSS `font-family`. */
  name: string;
  /** Raw font bytes. */
  data: Uint8Array;
  /** Optional weight (default 400). */
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  /** Optional style. */
  style?: "normal" | "italic";
}

/** Resolve a font path relative to this package, regardless of consumer cwd. */
export function fontPath(filename: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/fonts.ts -> ../fonts/<filename>
  return resolve(here, "..", "fonts", filename);
}

/**
 * Load the shipped default font set.
 *
 * If a font file is missing, we throw a helpful error rather than
 * fall back silently — silent fallback would render Tofu boxes for
 * end users which is far worse than failing the build.
 */
export async function loadDefaultFonts(): Promise<FontSpec[]> {
  const files: Array<{
    file: string;
    name: string;
    weight: FontSpec["weight"];
  }> = [
    { file: "Inter-Regular.ttf", name: "Inter", weight: 400 },
    { file: "Inter-Bold.ttf", name: "Inter", weight: 700 },
    { file: "Inter-Black.ttf", name: "Inter", weight: 900 },
    {
      file: "NotoNaskhArabic-Regular.ttf",
      name: "NotoNaskhArabic",
      weight: 400,
    },
    { file: "NotoSansJP-Bold.ttf", name: "NotoSansJP", weight: 700 },
  ];

  const out: FontSpec[] = [];
  for (const f of files) {
    const data = await readFile(fontPath(f.file)).catch((err) => {
      throw new Error(
        `[social-cards] missing font ${f.file} (looked in ${fontPath(f.file)}). ` +
          `Run \`pnpm --filter @tournamental/social-cards run fetch:fonts\` ` +
          `or pass a custom FontSpec[] into renderToSVG. (${err.message})`,
      );
    });
    out.push({
      name: f.name,
      data: new Uint8Array(data),
      weight: f.weight,
      style: "normal",
    });
  }
  return out;
}

/** Convenience: pick the right font family for a locale. */
export function familyForLocale(
  locale: string | undefined,
): "Inter" | "NotoNaskhArabic" | "NotoSansJP" {
  if (!locale) return "Inter";
  const lc = locale.toLowerCase();
  if (lc.startsWith("ar") || lc.startsWith("fa") || lc.startsWith("ur")) {
    return "NotoNaskhArabic";
  }
  if (lc.startsWith("ja")) {
    return "NotoSansJP";
  }
  return "Inter";
}

/** Whether a locale is right-to-left. */
export function isRtl(locale: string | undefined): boolean {
  if (!locale) return false;
  const lc = locale.toLowerCase();
  return (
    lc.startsWith("ar") ||
    lc.startsWith("fa") ||
    lc.startsWith("he") ||
    lc.startsWith("ur")
  );
}

/**
 * Editorial font bundle: Fraunces (display) + a system mono.
 *
 * Used by the new gold + charcoal preset family in `src/presets/`. The
 * bundle is loaded lazily and cached at module scope so repeated
 * `render(...)` calls in the same process pay the I/O cost once.
 *
 * Satori (current release) supports TTF / OTF / WOFF only, NOT WOFF2,
 * so we ship static cuts (500, 500-italic, 700) under `fonts/` rather
 * than the variable-axis Fraunces-Variable.woff2 the browser uses.
 */
export interface EditorialFontBundle {
  readonly fraunces500: Uint8Array;
  readonly fraunces500Italic: Uint8Array;
  readonly fraunces700: Uint8Array;
  /** Mono fallback used for datelines + stat labels + footer URLs. */
  readonly mono: Uint8Array;
}

let editorialCache: EditorialFontBundle | null = null;

/**
 * Load the Fraunces (500, 500-italic, 700) cuts vendored in `fonts/`,
 * plus a system mono fallback. Throws a helpful error if any cut is
 * missing — silent fallback would Tofu the gold dateline and ruin
 * every share image until the parent runtime notices.
 */
export async function loadEditorialFonts(): Promise<EditorialFontBundle> {
  if (editorialCache) return editorialCache;

  const monoCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
  ];

  const [fraunces500, fraunces500Italic, fraunces700, mono] = await Promise.all([
    readPackagedFont("Fraunces-500.ttf"),
    readPackagedFont("Fraunces-500-Italic.ttf"),
    readPackagedFont("Fraunces-700.ttf"),
    readFirstAvailable(monoCandidates),
  ]);

  editorialCache = { fraunces500, fraunces500Italic, fraunces700, mono };
  return editorialCache;
}

/** Convert the editorial bundle to a satori-ready FontSpec[] list. */
export function editorialFontSpecs(b: EditorialFontBundle): FontSpec[] {
  return [
    { name: "Fraunces", data: b.fraunces500, weight: 500, style: "normal" },
    { name: "Fraunces", data: b.fraunces500Italic, weight: 500, style: "italic" },
    { name: "Fraunces", data: b.fraunces700, weight: 700, style: "normal" },
    { name: "EditorialMono", data: b.mono, weight: 400, style: "normal" },
    { name: "EditorialMono", data: b.mono, weight: 600, style: "normal" },
  ];
}

async function readPackagedFont(filename: string): Promise<Uint8Array> {
  const p = fontPath(filename);
  try {
    const buf = await readFile(p);
    return new Uint8Array(buf);
  } catch (err) {
    throw new Error(
      `[social-cards] missing editorial font ${filename} (looked in ${p}). ` +
        `Vendored cuts are checked into packages/social-cards/fonts/; ` +
        `if you stripped them, run \`pnpm --filter @tournamental/social-cards run fetch:fonts\`. ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

async function readFirstAvailable(paths: readonly string[]): Promise<Uint8Array> {
  for (const p of paths) {
    try {
      const buf = await readFile(p);
      return new Uint8Array(buf);
    } catch {
      // try next
    }
  }
  throw new Error(
    "[social-cards] no system mono font available for editorial presets. " +
      "Install fonts-dejavu (`apt-get install fonts-dejavu-core`) or " +
      "extend monoCandidates in src/fonts.ts.",
  );
}
