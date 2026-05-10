/**
 * Parse `.env.example` to build the set of "known" env vars. Anything
 * outside this set that the PR newly references via `process.env.X`
 * triggers a `secret-scope` flag.
 */

import { readFileSync, existsSync } from 'node:fs';

export function loadKnownEnvVars(envExamplePath: string): Set<string> {
  if (!existsSync(envExamplePath)) return new Set();
  const txt = readFileSync(envExamplePath, 'utf-8');
  const out = new Set<string>();
  for (const line of txt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z][A-Z0-9_]+)\s*=/);
    if (m && m[1]) out.add(m[1]);
  }
  // Always-known runtime vars
  for (const v of ['NODE_ENV', 'PORT', 'HOST', 'CI', 'PATH', 'HOME', 'USER', 'PWD', 'TZ']) {
    out.add(v);
  }
  return out;
}

export function loadHostAllowlist(allowlistPath: string): Set<string> {
  if (!existsSync(allowlistPath)) return new Set();
  const txt = readFileSync(allowlistPath, 'utf-8');
  const out = new Set<string>();
  for (const line of txt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    out.add(trimmed.toLowerCase());
  }
  return out;
}
