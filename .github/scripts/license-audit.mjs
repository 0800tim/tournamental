#!/usr/bin/env node
/**
 * License audit.
 *
 * Walks the diff for added/modified package.json files, finds newly
 * added dependencies (vs. main), resolves each to its declared licence
 * via the npm registry, and rejects anything outside the allowlist.
 *
 * Output: JSON to stdout
 *   {
 *     ok: boolean,
 *     checked: [{ name, version, licence }],
 *     violations: [{ name, version, licence, reason }],
 *   }
 *
 * Allowlist is intentionally narrow. Anything else triggers a manual
 * licence-review handshake (handled in docs/security/03).
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ALLOWLIST = new Set([
  'Apache-2.0',
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
  '0BSD',
  'CC-BY-4.0',
  'BlueOak-1.0.0',
]);

const FETCH_TIMEOUT_MS = 5000;

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf-8' });
}

function* changedPackageJsons() {
  const base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : 'origin/main';
  try {
    git('fetch origin --depth=1');
  } catch {
    /* ignore — already fetched */
  }
  let names = '';
  try {
    names = git(`diff --name-only ${base}...HEAD`).trim();
  } catch {
    names = git('diff --name-only HEAD').trim();
  }
  for (const path of names.split('\n')) {
    if (/(^|\/)package\.json$/.test(path)) yield path;
  }
}

function depsFromHead(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const json = JSON.parse(raw);
  const all = {
    ...json.dependencies,
    ...json.devDependencies,
    ...json.peerDependencies,
    ...json.optionalDependencies,
  };
  return Object.entries(all).map(([name, version]) => ({ name, version }));
}

function depsFromBase(path) {
  const base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : 'origin/main';
  try {
    const raw = git(`show ${base}:${path}`);
    const json = JSON.parse(raw);
    const all = {
      ...json.dependencies,
      ...json.devDependencies,
      ...json.peerDependencies,
      ...json.optionalDependencies,
    };
    return new Set(Object.keys(all));
  } catch {
    return new Set();
  }
}

async function fetchLicence(name) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const lic = data.license ?? data.licenses;
    if (typeof lic === 'string') return lic;
    if (Array.isArray(lic) && typeof lic[0]?.type === 'string') return lic[0].type;
    if (typeof lic === 'object' && typeof lic?.type === 'string') return lic.type;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const r = await fn();
    if (r) return r;
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  return null;
}

async function main() {
  const checked = [];
  const violations = [];
  const seen = new Set();

  for (const path of changedPackageJsons()) {
    const baseDeps = depsFromBase(path);
    const headDeps = depsFromHead(path);
    for (const { name, version } of headDeps) {
      if (baseDeps.has(name)) continue;
      const k = `${name}@${version}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const licence = await withRetry(() => fetchLicence(name));
      checked.push({ name, version, licence });
      if (!licence) {
        violations.push({ name, version, licence, reason: 'licence-unknown' });
        continue;
      }
      // Strict match — `(MIT OR Apache-2.0)` etc. is split.
      const tokens = licence.split(/\s+(?:OR|AND)\s+|[(),]/i).map((t) => t.trim()).filter(Boolean);
      const allowed = tokens.some((t) => ALLOWLIST.has(t));
      if (!allowed) {
        violations.push({ name, version, licence, reason: 'not-on-allowlist' });
      }
    }
  }

  const out = { ok: violations.length === 0, checked, violations };
  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: e.message, checked: [], violations: [] }));
  process.exit(0);
});
