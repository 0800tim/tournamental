#!/usr/bin/env node
/**
 * Secret-scope audit.
 *
 * Reads .env.example to build the set of "documented" env vars. Walks
 * the diff for newly added `process.env.X` references; any X not in
 * .env.example is flagged.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const KNOWN = new Set([
  'NODE_ENV',
  'PORT',
  'HOST',
  'CI',
  'PATH',
  'HOME',
  'USER',
  'PWD',
  'TZ',
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  'GITHUB_BASE_REF',
  'GITHUB_HEAD_REF',
  'GITHUB_SHA',
  'GITHUB_RUN_ID',
]);

function loadEnvExample() {
  if (!existsSync('.env.example')) return new Set();
  const txt = readFileSync('.env.example', 'utf-8');
  const out = new Set();
  for (const line of txt.split('\n')) {
    const m = line.trim().match(/^([A-Z][A-Z0-9_]+)\s*=/);
    if (m) out.add(m[1]);
  }
  return out;
}

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf-8' });
}

function* addedEnvVars() {
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
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const re = /process\.env\.([A-Z][A-Z0-9_]+)/g;
    let m;
    while ((m = re.exec(line))) yield m[1];
  }
}

const envExample = loadEnvExample();
const known = new Set([...KNOWN, ...envExample]);
const found = new Set();
for (const v of addedEnvVars()) {
  if (!known.has(v)) found.add(v);
}

const out = {
  ok: found.size === 0,
  undocumentedEnvVars: [...found].sort(),
  knownCount: known.size,
};
process.stdout.write(JSON.stringify(out, null, 2));
