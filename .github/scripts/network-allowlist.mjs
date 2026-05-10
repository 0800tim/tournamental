#!/usr/bin/env node
/**
 * Network allowlist audit.
 *
 * Walks the diff and extracts hostnames referenced in newly added
 * `fetch(`, `axios.`, `got(`, `https.request`, `new URL(` calls. Any
 * host not in `.github/security/network-allowlist.txt` is flagged.
 *
 * Output: JSON to stdout
 *   {
 *     ok: boolean,
 *     unknownHosts: string[],
 *     allowlistedHosts: string[],
 *   }
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const URL_RE = /(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?:[\/:?#]|$)/gi;

const ALWAYS_OK = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'vtourn.com',
  'aiva.nz',
  'github.com',
  'tools.ietf.org',
  'datatracker.ietf.org',
  'wikipedia.org',
  'developer.mozilla.org',
]);

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf-8' });
}

function loadAllowlist() {
  const path = '.github/security/network-allowlist.txt';
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, 'utf-8')
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#')),
  );
}

function isAllowed(host, allow) {
  if (ALWAYS_OK.has(host)) return true;
  if (allow.has(host)) return true;
  for (const a of allow) {
    if (a.startsWith('.') && host.endsWith(a)) return true;
  }
  return false;
}

function* addedLines() {
  const base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : 'origin/main';
  try {
    git('fetch origin --depth=1');
  } catch {
    /* ignore */
  }
  let diff;
  try {
    diff = git(`diff --unified=0 ${base}...HEAD`);
  } catch {
    diff = git('diff --unified=0 HEAD');
  }
  let path = '';
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^diff --git a\/(\S+)/);
    if (fileMatch) {
      path = fileMatch[1];
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift)$/.test(path)) continue;
    if (/\/(node_modules|\.next|dist|build)\//.test(path)) continue;
    // Skip test files and fixtures — hostile-host literals are deliberate.
    if (/(^|\/)(tests?|__tests__|fixtures?|e2e)\//.test(path)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
    yield line.slice(1);
  }
}

function main() {
  const allow = loadAllowlist();
  const unknown = new Set();
  for (const line of addedLines()) {
    // Skip clear comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(line))) {
      const host = m[1].toLowerCase();
      if (!isAllowed(host, allow)) unknown.add(host);
    }
  }
  const out = {
    ok: unknown.size === 0,
    unknownHosts: [...unknown].sort(),
    allowlistedHosts: [...allow].sort(),
  };
  process.stdout.write(JSON.stringify(out, null, 2));
}

main();
