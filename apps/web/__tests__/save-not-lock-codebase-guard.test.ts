/**
 * Vitest — regression guard for the Lock → Save rename.
 *
 * Reads through every .tsx/.ts file under apps/web/app and
 * apps/web/components looking for user-visible strings that start with
 * capital "Lock" (i.e. JSX text or attribute values). Any new occurrence
 * fails the test with a pointer to the offending file so a future PR
 * that re-introduces "Lock pick" or "Lock in your bracket" gets caught
 * at CI.
 *
 * Internal identifiers — `lockedAt`, `oddsAtLock`, `lockMultiplier`,
 * `lockedKeys`, `LockSummary`, `kickoff_lockout`, `is-locked` etc. —
 * are intentionally allowlisted (they're consumed by the scoring
 * engine and stay).
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOTS = [
  path.join(__dirname, "..", "app"),
  path.join(__dirname, "..", "components"),
];

// Skip the share-card agent's territory (sibling agent owns it).
const SKIP_DIRS = [
  "components/share",
  "app/share",
  "app/api/og",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (SKIP_DIRS.some((d) => p.replace(/\\/g, "/").includes(`/${d}`))) continue;
    if (e.isDirectory()) {
      out.push(...walk(p));
    } else if (e.isFile() && /\.(tsx|ts)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Strip line + block comments and known internal identifiers from the
 * source so what remains is roughly "the code that could end up in user
 * copy". Crude but effective: we don't need to parse, just narrow the
 * search surface enough that a remaining `\bLock\b` is almost
 * certainly visible to a user.
 */
function strip(source: string): string {
  let s = source;
  // Block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  // Line comments
  s = s.replace(/\/\/[^\n]*/g, "");
  // Internal identifiers and CSS class names that contain "lock".
  // Order matters — replace longest forms first.
  const allowed: readonly RegExp[] = [
    /\bLockSummary\b/g,
    /\bLockSummaryProps\b/g,
    /\boddsAtLock\b/g,
    /\blockedAt\b/g,
    /\blockedKeys\b/g,
    /\blockMultiplier\b/g,
    /\bkickoff_lockout\b/g,
    /\bonToggleLock\b/g,
    /\bbracket-lock-[\w-]*/g,
    /\bmpr-locked-banner\b/g,
    /\bmpp-locked-banner\b/g,
    /\bmp-locked-odds\b/g,
    /\bmp-locked-odds-\w+/g,
    /\bis-locked\b/g,
    /\bmpr-locked\b/g,
    /\bmpp-is-locked\b/g,
    // Verb forms inside identifiers ("locked", "lockout", "locking",
    // "lockstep") — never user-visible by themselves; strip them so they
    // don't get counted.
    /\block(?:ed|ing|s|out|step)\b/gi,
  ];
  for (const re of allowed) s = s.replace(re, "_INTERNAL_");
  return s;
}

describe("Lock → Save rename — codebase guard", () => {
  it("no .tsx/.ts in apps/web/{app,components} renders user-visible 'Lock'", () => {
    const offenders: Array<{ file: string; matches: string[] }> = [];
    for (const root of ROOTS) {
      if (!fs.existsSync(root)) continue;
      for (const file of walk(root)) {
        const src = strip(fs.readFileSync(file, "utf8"));
        const matches = src.match(/\bLock\b/g) ?? [];
        if (matches.length > 0) {
          offenders.push({ file: path.relative(process.cwd(), file), matches });
        }
      }
    }
    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `${o.file}: ${o.matches.length}× ${o.matches.join(", ")}`)
        .join("\n  ");
      throw new Error(
        `User-visible "Lock" detected after rename. Update copy to "Save":\n  ${detail}`,
      );
    }
  });

  it("BracketBuilder uses 'Save bracket' as the primary CTA copy", () => {
    const file = path.join(
      __dirname,
      "..",
      "components",
      "bracket",
      "BracketBuilder.tsx",
    );
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/Save bracket/);
    expect(src).toMatch(/Save draft locally/);
    expect(src).not.toMatch(/"Lock final"/);
    expect(src).not.toMatch(/Lock the bracket before kickoff/);
  });

  it("MatchPickPopup primary button reads 'Save pick'", () => {
    const file = path.join(
      __dirname,
      "..",
      "components",
      "match-pick",
      "MatchPickPopup.tsx",
    );
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/"Save pick"/);
    expect(src).not.toMatch(/"Lock it in"/);
  });

  it("LockSummary user-facing strings read 'Save', 'Saved', 'early-save'", () => {
    const file = path.join(
      __dirname,
      "..",
      "components",
      "bracket",
      "LockSummary.tsx",
    );
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/picks saved/);
    expect(src).toMatch(/Save the rest before/);
    expect(src).toMatch(/Top early-save multipliers/);
    expect(src).not.toMatch(/Top lock multipliers/);
    expect(src).not.toMatch(/Lock the rest before/);
  });

  it("the world-cup-2026 landing page reads 'save'/'saved' in user copy", () => {
    const file = path.join(
      __dirname,
      "..",
      "app",
      "world-cup-2026",
      "landing",
      "page.tsx",
    );
    const src = fs.readFileSync(file, "utf8");
    // Accept either "0 picks saved" or "0 brackets saved" — sibling
    // PR #127 settled on the latter; both are correct user copy.
    expect(src).toMatch(/0 (?:picks|brackets) saved\. Be first\./);
    expect(src).toMatch(/Save your bracket now/);
    expect(src).not.toMatch(/Lock in your bracket now/);
    expect(src).not.toMatch(/0 picks locked\. Be first\./);
    expect(src).not.toMatch(/0 brackets locked\. Be first\./);
  });
});
