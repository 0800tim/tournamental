#!/usr/bin/env node
/**
 * Convert daily/weekly scanner outputs into a JSONL stream of Finding
 * objects (per the schema in apps/security-watchdog/src/lib/types.ts).
 *
 * Usage:
 *   watchdog-roll-up.mjs daily   → reads pnpm-audit.json + osv-daily.json
 *   watchdog-roll-up.mjs weekly  → (placeholder; weekly results currently
 *                                   land directly in their action logs)
 */

import { readFileSync, existsSync } from 'node:fs';

const mode = process.argv[2] ?? 'daily';
const now = Date.now();

function emit(finding) {
  process.stdout.write(JSON.stringify(finding) + '\n');
}

function severity(s) {
  const v = String(s ?? '').toLowerCase();
  if (v === 'critical') return 'critical';
  if (v === 'high') return 'high';
  if (v === 'moderate' || v === 'medium') return 'medium';
  if (v === 'low') return 'low';
  return 'info';
}

if (mode === 'daily') {
  // pnpm audit
  if (existsSync('pnpm-audit.json')) {
    try {
      const raw = JSON.parse(readFileSync('pnpm-audit.json', 'utf-8'));
      const advisories = raw.advisories ?? {};
      for (const a of Object.values(advisories)) {
        emit({
          id: `pnpm-audit:${a.id ?? a.url}:${a.module_name}`,
          source: 'npm-audit',
          severity: severity(a.severity),
          status: 'open',
          firstSeenAt: now,
          lastSeenAt: now,
          title: `${a.title ?? a.module_name} (${a.severity})`,
          detail: (a.overview ?? '').slice(0, 1500),
          location: a.module_name,
          tags: ['daily', 'deps'],
        });
      }
    } catch (e) {
      console.error('pnpm-audit roll-up failed:', e.message);
    }
  }
  // OSV
  if (existsSync('osv-daily.json')) {
    try {
      const raw = JSON.parse(readFileSync('osv-daily.json', 'utf-8'));
      for (const result of raw.results ?? []) {
        for (const pkg of result.packages ?? []) {
          for (const v of pkg.vulnerabilities ?? []) {
            const sev = (v.database_specific?.severity ?? 'medium').toLowerCase();
            emit({
              id: `osv:${v.id}:${pkg.package?.name}@${pkg.package?.version}`,
              source: 'osv-scanner',
              severity: severity(sev),
              status: 'open',
              firstSeenAt: now,
              lastSeenAt: now,
              title: `${v.id} in ${pkg.package?.name}@${pkg.package?.version}`,
              detail: (v.summary ?? '').slice(0, 1500),
              location: pkg.package?.name,
              tags: ['daily', 'osv'],
            });
          }
        }
      }
    } catch (e) {
      console.error('osv roll-up failed:', e.message);
    }
  }
} else if (mode === 'weekly') {
  // Weekly findings are emitted by the in-line gitleaks/semgrep
  // actions; this stub is for symmetry. Future: read their JSON outputs.
}
