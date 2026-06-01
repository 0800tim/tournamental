#!/usr/bin/env node
// Capture FIFA Annex C Best-Third assignments for the 2026 World Cup from
// cup-predictor.com's public function endpoint. CORS-open, no auth.
// All C(12,8) = 495 combinations. Output: a single JSON file mapping the
// alphabetical 8-group key (e.g. "A,C,D,F,G,I,J,L") to the assignment map
// (e.g. { "1A": "3C", ... }).

import { writeFileSync } from "node:fs";

const APP_ID = "6925f65163c4c04b9a4d5f51";
const API_URL = `https://base44.app/api/apps/${APP_ID}/functions/getAnnexCAssignment`;
const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

function allCombinationsOf8() {
  const out = [];
  for (let mask = 0; mask < 1 << 12; mask++) {
    let count = 0;
    for (let b = 0; b < 12; b++) if (mask & (1 << b)) count++;
    if (count !== 8) continue;
    const combo = [];
    for (let b = 0; b < 12; b++) if (mask & (1 << b)) combo.push(GROUPS[b]);
    out.push(combo);
  }
  return out;
}

async function fetchOne(combo, attempt = 1) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-id": APP_ID,
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 Tournamental-research/1.0 (one-off Annex C table capture)",
    },
    body: JSON.stringify({ groups: combo }),
  });
  if (!res.ok) {
    if (attempt < 6) {
      // Exponential backoff with jitter; the API 500s under burst load.
      const wait = 600 * Math.pow(1.5, attempt - 1) + Math.random() * 400;
      await new Promise((r) => setTimeout(r, wait));
      return fetchOne(combo, attempt + 1);
    }
    throw new Error(`http-${res.status} for combo ${combo.join(",")}`);
  }
  return res.json();
}

async function main() {
  const combos = allCombinationsOf8();
  console.error(`Capturing ${combos.length} combinations…`);
  const out = {};
  const errors = [];
  const BATCH = 6;
  for (let i = 0; i < combos.length; i += BATCH) {
    const slice = combos.slice(i, i + BATCH);
    const settled = await Promise.allSettled(slice.map(fetchOne));
    settled.forEach((r, j) => {
      if (r.status === "fulfilled") {
        out[r.value.key] = r.value.assignment;
      } else {
        errors.push({ combo: slice[j], error: String(r.reason) });
      }
    });
    if (i % 60 === 0) {
      console.error(`  …${i + slice.length}/${combos.length} done`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(`Captured ${Object.keys(out).length} / ${combos.length}`);
  if (errors.length) console.error("Errors:", errors.slice(0, 5));

  const outPath = new globalThis.URL(
    "../packages/bracket-engine/data/fifa-2026-annex-c-assignments.json",
    import.meta.url,
  );
  const sortedKeys = Object.keys(out).sort();
  const sorted = {};
  for (const k of sortedKeys) sorted[k] = out[k];
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        _meta: {
          source: "https://cup-predictor.com/createbracket",
          endpoint:
            "POST https://base44.app/api/apps/6925f65163c4c04b9a4d5f51/functions/getAnnexCAssignment",
          captured_at_utc: new Date().toISOString(),
          notes:
            "FIFA 2026 Annex C: maps the alphabetical 8-group key to {group-winner -> 3rd-placer group} assignments for R32. Sourced from cup-predictor.com; verify against FIFA's published regulations before release.",
          combinations: Object.keys(sorted).length,
        },
        assignments: sorted,
      },
      null,
      2,
    ),
  );
  console.error(`Wrote ${outPath.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
