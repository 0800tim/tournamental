#!/usr/bin/env node
// Fill in any missing combinations from the Annex C table. Reads the
// existing JSON, computes which of the 495 are missing, and refetches
// them one-at-a-time with generous backoff.

import { readFileSync, writeFileSync } from "node:fs";

const APP_ID = "6925f65163c4c04b9a4d5f51";
const API_URL = `https://base44.app/api/apps/${APP_ID}/functions/getAnnexCAssignment`;
const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

const outPath = new globalThis.URL(
  "../packages/bracket-engine/data/fifa-2026-annex-c-assignments.json",
  import.meta.url,
);
const existing = JSON.parse(readFileSync(outPath, "utf-8"));
const haveKeys = new Set(Object.keys(existing.assignments));

const allCombos = [];
for (let mask = 0; mask < 1 << 12; mask++) {
  let count = 0;
  for (let b = 0; b < 12; b++) if (mask & (1 << b)) count++;
  if (count !== 8) continue;
  const combo = [];
  for (let b = 0; b < 12; b++) if (mask & (1 << b)) combo.push(GROUPS[b]);
  allCombos.push(combo);
}

const missing = allCombos.filter((c) => !haveKeys.has(c.join(",")));
console.error(`Missing ${missing.length} / ${allCombos.length}`);

async function fetchOne(combo, attempt = 1) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-id": APP_ID,
      Accept: "application/json",
    },
    body: JSON.stringify({ groups: combo }),
  });
  if (!res.ok) {
    if (attempt < 10) {
      const wait = 1500 * Math.pow(1.3, attempt - 1) + Math.random() * 800;
      await new Promise((r) => setTimeout(r, wait));
      return fetchOne(combo, attempt + 1);
    }
    throw new Error(`http-${res.status} for combo ${combo.join(",")}`);
  }
  return res.json();
}

const errors = [];
for (const combo of missing) {
  try {
    const j = await fetchOne(combo);
    existing.assignments[j.key] = j.assignment;
    console.error(`  + ${j.key}`);
  } catch (err) {
    errors.push({ combo, error: String(err) });
    console.error(`  ! ${combo.join(",")}: ${err}`);
  }
  await new Promise((r) => setTimeout(r, 600));
}

const sortedKeys = Object.keys(existing.assignments).sort();
const sorted = {};
for (const k of sortedKeys) sorted[k] = existing.assignments[k];
existing.assignments = sorted;
existing._meta.combinations = Object.keys(sorted).length;
existing._meta.captured_at_utc = new Date().toISOString();
writeFileSync(outPath, JSON.stringify(existing, null, 2));
console.error(
  `Final: ${Object.keys(sorted).length} / 495. Errors remaining: ${errors.length}`,
);
if (errors.length) console.error("Still missing:", errors.map((e) => e.combo.join(",")));
