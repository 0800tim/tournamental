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
          `Run \`pnpm --filter @vtorn/social-cards run fetch:fonts\` ` +
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
