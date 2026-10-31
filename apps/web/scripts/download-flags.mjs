#!/usr/bin/env node
/**
 * Pre-download team flags from Wikimedia Commons to
 * `apps/web/public/flags/{CODE}.svg`. Public domain or attribution-free;
 * the licence of each file is recorded in the teams JSON when known.
 * Run once at setup time; results are committed. Existing files are
 * kept, so re-running for a new tournament only fetches the new unions.
 *
 *   node scripts/download-flags.mjs                        # FIFA World Cup 2026 (default)
 *   node scripts/download-flags.mjs ../../data/rwc-2027/teams.json
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TEAMS_PATH = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, "..", "..", "..", "data", "fifa-wc-2026", "teams.json");
const OUT_DIR = resolve(here, "..", "public", "flags");

await mkdir(OUT_DIR, { recursive: true });

const teams = JSON.parse(await readFile(TEAMS_PATH, "utf8")).teams;

let ok = 0;
let skipped = 0;
let failed = 0;

for (const team of teams) {
  const out = resolve(OUT_DIR, `${team.code}.svg`);
  try {
    await access(out);
    skipped += 1;
    continue;
  } catch {}
  if (!team.flag_svg_url) {
    console.warn(`! ${team.code}: no flag_svg_url`);
    failed += 1;
    continue;
  }
  try {
    const res = await fetch(team.flag_svg_url, {
      headers: { "User-Agent": "Tournamental-Flag-Downloader/1.0 (info@tournamental.com)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (!body.startsWith("<")) throw new Error("not SVG");
    await writeFile(out, body, "utf8");
    console.log(`  ${team.code}  ${team.name}  (${body.length} bytes)`);
    ok += 1;
  } catch (e) {
    console.warn(`! ${team.code}: ${e.message}`);
    failed += 1;
  }
}

console.log(`\n  ${ok} downloaded, ${skipped} skipped, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
