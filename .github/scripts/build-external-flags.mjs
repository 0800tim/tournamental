#!/usr/bin/env node
/**
 * Aggregate scanner artifacts into a single external-flags.json that
 * the triage bot consumes via --external-flags.
 *
 * Reads from ./artifacts/<artifact-name>/<file>.json and emits an
 * array of Flag objects (per the FlagSchema in pr-triage-bot/src/lib/types.ts).
 */

import { readFileSync, existsSync } from 'node:fs';

const out = [];

function pushFlag(f) {
  // Defensive: trim every string and clamp lengths.
  const safe = {
    id: String(f.id ?? '').slice(0, 200) || `auto-${out.length}`,
    severity: ['info', 'low', 'medium', 'high', 'critical'].includes(f.severity)
      ? f.severity
      : 'medium',
    score: Math.max(0, Math.min(100, Number(f.score ?? 0))),
    title: String(f.title ?? '').slice(0, 160) || 'finding',
    detail: f.detail ? String(f.detail).slice(0, 2000) : undefined,
    source: f.source,
  };
  if (
    [
      'gitleaks',
      'osv-scanner',
      'semgrep',
      'license-audit',
      'network-allowlist',
      'classifier',
      'secret-scope',
      'prompt-injection',
      'codeowners',
      'dco',
      'first-time-contributor',
    ].includes(safe.source)
  ) {
    out.push(safe);
  }
}

// OSV-Scanner
{
  const path = 'artifacts/osv-results/osv-results.json';
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      const results = raw.results ?? [];
      let count = 0;
      for (const result of results) {
        for (const pkg of result.packages ?? []) {
          for (const v of pkg.vulnerabilities ?? []) {
            const sev = (v.database_specific?.severity ?? 'medium').toLowerCase();
            const sevMap = { critical: 'critical', high: 'high', moderate: 'medium', low: 'low' };
            pushFlag({
              id: `osv-${v.id}`,
              severity: sevMap[sev] ?? 'medium',
              score: sev === 'critical' ? 60 : sev === 'high' ? 40 : 15,
              title: `${v.id} in ${pkg.package?.name}@${pkg.package?.version}`,
              detail: v.summary ?? v.details?.slice(0, 1500),
              source: 'osv-scanner',
            });
            count++;
            if (count > 30) break;
          }
        }
      }
    } catch (e) {
      console.error('osv parse failed:', e.message);
    }
  }
}

// Semgrep
{
  const path = 'artifacts/semgrep-results/semgrep-results.json';
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      const findings = raw.results ?? [];
      let count = 0;
      for (const f of findings) {
        const sev = String(f.extra?.severity ?? 'INFO').toLowerCase();
        const sevMap = { error: 'high', warning: 'medium', info: 'low' };
        pushFlag({
          id: `semgrep-${f.check_id}-${f.path}-${f.start?.line ?? 0}`.slice(0, 200),
          severity: sevMap[sev] ?? 'low',
          score: sev === 'error' ? 25 : sev === 'warning' ? 10 : 0,
          title: `${f.check_id} in ${f.path}`,
          detail: f.extra?.message?.slice(0, 1500),
          source: 'semgrep',
        });
        count++;
        if (count > 50) break;
      }
    } catch (e) {
      console.error('semgrep parse failed:', e.message);
    }
  }
}

// License audit
{
  const path = 'artifacts/license-results/license-results.json';
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      for (const v of raw.violations ?? []) {
        pushFlag({
          id: `license-${v.name}-${v.version}`,
          severity: 'high',
          score: 40,
          title: `Disallowed licence: ${v.name}@${v.version} (${v.licence ?? 'unknown'})`,
          detail: `Reason: ${v.reason}`,
          source: 'license-audit',
        });
      }
    } catch (e) {
      console.error('license parse failed:', e.message);
    }
  }
}

// Network allowlist
{
  const path = 'artifacts/network-results/network-results.json';
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      for (const host of raw.unknownHosts ?? []) {
        pushFlag({
          id: `network-${host}`,
          severity: 'medium',
          score: 25,
          title: `New third-party host: ${host}`,
          source: 'network-allowlist',
        });
      }
    } catch (e) {
      console.error('network parse failed:', e.message);
    }
  }
}

// Secret-scope
{
  const path = 'artifacts/secret-scope-results/secret-scope-results.json';
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      for (const env of raw.undocumentedEnvVars ?? []) {
        pushFlag({
          id: `secret-scope-${env}`,
          severity: 'low',
          score: 5,
          title: `New undocumented env var: ${env}`,
          source: 'secret-scope',
        });
      }
    } catch (e) {
      console.error('secret-scope parse failed:', e.message);
    }
  }
}

// Prompt-injection canary
{
  const path = 'artifacts/prompt-injection-results/prompt-injection-results.json';
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      for (const h of raw.hits ?? []) {
        pushFlag({
          id: `prompt-inj-${h.pattern}-${h.file}-${h.line}`.slice(0, 200),
          severity: 'high',
          score: 45,
          title: `Prompt-injection pattern '${h.pattern}' in ${h.file}:${h.line}`,
          source: 'prompt-injection',
        });
      }
    } catch (e) {
      console.error('prompt-injection parse failed:', e.message);
    }
  }
}

process.stdout.write(JSON.stringify(out, null, 2));
