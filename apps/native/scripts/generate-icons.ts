#!/usr/bin/env tsx
/**
 * Generate placeholder app icons + splash for the Capacitor shell.
 *
 * Real icon design lands later — this script writes a simple V mark on
 * the brand background so we can ship to TestFlight / Play internal
 * testing without art. SVG → PNG via @resvg/resvg-js (already a transitive
 * dep in apps/web, but we also list it as a workspace-friendly dynamic
 * import so the script stays tolerant of being invoked before its parent
 * package's deps are installed).
 *
 * Outputs:
 *   resources/icon/icon-1024.png   — App Store / Play Store master icon
 *   resources/icon/icon-512.png
 *   resources/icon/icon-192.png
 *   resources/splash/splash-2732.png — square, used by `cap` to derive
 *                                       all device sizes via @capacitor/assets
 *
 * Once @capacitor/assets is installed (`pnpm add -D @capacitor/assets`)
 * the next step is `pnpm cap-assets generate` which fans these masters
 * out into every iOS + Android density bucket.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Brand background — same dark navy as apps/web/app/globals.css. */
const BG = '#0c1722';
/** Brand accent — Tournamental blue. */
const ACCENT = '#1f6feb';
/** Foreground V — high-contrast yellow used in the bracket UI. */
const V_COLOUR = '#facc15';

function svgIcon(size: number): string {
  // Centred V mark on a rounded-square background. The V is built from two
  // strokes meeting at the bottom-centre. Stroke widths scale with the
  // icon size so the stroke stays optically consistent.
  const r = Math.round(size * 0.225); // iOS-ish corner radius
  const stroke = Math.round(size * 0.135);
  const inset = Math.round(size * 0.22);
  const cx = size / 2;
  const top = inset;
  const bottom = size - inset;
  const leftX = inset;
  const rightX = size - inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/>
  <rect x="${size * 0.06}" y="${size * 0.06}" width="${size * 0.88}" height="${size * 0.88}" rx="${r * 0.85}" ry="${r * 0.85}" fill="${ACCENT}" opacity="0.9"/>
  <path d="M ${leftX} ${top} L ${cx} ${bottom} L ${rightX} ${top}"
        fill="none" stroke="${V_COLOUR}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function svgSplash(size: number): string {
  // Splash uses the same V but smaller, on a flat brand-navy bg so the
  // launch screen flicker is minimal.
  const v = Math.round(size * 0.28);
  const stroke = Math.round(size * 0.025);
  const cx = size / 2;
  const cy = size / 2;
  const top = cy - v / 2;
  const bottom = cy + v / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" fill="${BG}"/>
  <path d="M ${cx - v / 2} ${top} L ${cx} ${bottom} L ${cx + v / 2} ${top}"
        fill="none" stroke="${V_COLOUR}" stroke-width="${stroke * 4}"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

async function svgToPng(svg: string, outPath: string, size: number): Promise<void> {
  // @resvg/resvg-js is already a workspace dep via apps/web. Resolve it
  // dynamically so this script doesn't *require* the @vtorn/native package
  // to depend on it directly — keeps install lean.
  type ResvgModule = {
    Resvg: new (
      svg: string,
      opts?: { fitTo?: { mode: 'width' | 'height'; value: number } },
    ) => { render(): { asPng(): Buffer } };
  };
  let resvg: ResvgModule;
  try {
    // Dynamic import via the variable form so TS doesn't try to resolve
    // the type at compile time (the package may not be in this app's
    // direct deps; it's a transitive dep of apps/web). Cast to unknown
    // because @resvg/resvg-js is an optional runtime dependency.
    const modName = '@resvg/resvg-js';
    resvg = (await import(modName)) as unknown as ResvgModule;
  } catch {
    // Fall back: write the SVG and skip the PNG step. The native build
    // tools (Xcode / Android Studio) accept SVGs in many slots.
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath.replace(/\.png$/, '.svg'), svg, 'utf8');
    return;
  }
  const r = new resvg.Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const png = r.render().asPng();
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, png);
}

async function main(): Promise<void> {
  const targets = [
    { svg: svgIcon(1024), out: 'resources/icon/icon-1024.png', size: 1024 },
    { svg: svgIcon(512), out: 'resources/icon/icon-512.png', size: 512 },
    { svg: svgIcon(192), out: 'resources/icon/icon-192.png', size: 192 },
    { svg: svgSplash(2732), out: 'resources/splash/splash-2732.png', size: 2732 },
  ];
  for (const t of targets) {
    const out = resolve(ROOT, t.out);
    process.stdout.write(`generating ${t.out} (${t.size}px)... `);
    await svgToPng(t.svg, out, t.size);
    process.stdout.write('done\n');
  }
  process.stdout.write(
    '\nnext: install @capacitor/assets and run `pnpm cap-assets generate`\n' +
      '      to fan these masters out to every iOS + Android density.\n',
  );
}

await main();
