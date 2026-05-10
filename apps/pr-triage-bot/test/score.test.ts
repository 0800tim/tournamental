import { describe, it, expect } from 'vitest';
import { classifyPaths } from '../src/lib/classify.js';
import { scorePR, SCORE_THRESHOLDS } from '../src/lib/score.js';
import type { TriageInput } from '../src/lib/types.js';

function baseInput(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    pr: {
      number: 1,
      title: 't',
      body: '',
      author: 'someone',
      authorAssociation: 'CONTRIBUTOR',
      baseRef: 'main',
      headSha: 'abcdef0',
      draft: false,
    },
    files: [],
    networkHosts: [],
    newEnvVars: [],
    newDeps: [],
    externalFlags: [],
    promptInjectionHits: [],
    ...overrides,
  };
}

describe('scorePR', () => {
  it('green when nothing is flagged', () => {
    const input = baseInput({
      files: [
        {
          path: 'docs/notes.md',
          status: 'modified',
          additions: 1,
          deletions: 0,
        },
      ],
    });
    const cls = classifyPaths(input.files.map((f) => f.path));
    const r = scorePR(input, cls);
    expect(r.verdict).toBe('green');
    expect(r.riskScore).toBeLessThan(SCORE_THRESHOLDS.yellow);
  });

  it('yellow when modifying CI workflows', () => {
    const input = baseInput({
      files: [
        {
          path: '.github/workflows/ci.yml',
          status: 'modified',
          additions: 5,
          deletions: 0,
        },
      ],
    });
    const cls = classifyPaths(input.files.map((f) => f.path));
    const r = scorePR(input, cls);
    expect(['yellow', 'red']).toContain(r.verdict);
    expect(r.flags.some((f) => f.id === 'ci-workflow-change')).toBe(true);
    // CI workflow is also sensitive — the sensitive-zone flag fires.
    expect(r.flags.some((f) => f.id === 'sensitive-zone')).toBe(true);
  });

  it('red when touching apps/auth-sms', () => {
    const input = baseInput({
      files: [
        {
          path: 'apps/auth-sms/src/lib/otp.ts',
          status: 'modified',
          additions: 10,
          deletions: 2,
        },
      ],
    });
    const cls = classifyPaths(input.files.map((f) => f.path));
    const r = scorePR(input, cls);
    expect(r.verdict).toBe('red');
    expect(r.flags.some((f) => f.id === 'sensitive-zone' && f.severity === 'high')).toBe(true);
  });

  it('escalates first-time contributor editing root package.json to red', () => {
    const input = baseInput({
      pr: {
        number: 1,
        title: 't',
        body: '',
        author: 'newbie',
        authorAssociation: 'FIRST_TIME_CONTRIBUTOR',
        baseRef: 'main',
        headSha: 'abcdef0',
        draft: false,
      },
      files: [
        {
          path: 'package.json',
          status: 'modified',
          additions: 1,
          deletions: 0,
        },
      ],
      newDeps: [{ name: 'left-pad', version: '1.0.0', ecosystem: 'npm' }],
    });
    const cls = classifyPaths(input.files.map((f) => f.path));
    const r = scorePR(input, cls);
    expect(r.verdict).toBe('red');
    expect(r.flags.some((f) => f.id === 'first-timer-root-manifest')).toBe(true);
  });

  it('flags new third-party network hosts', () => {
    const input = baseInput({
      files: [
        {
          path: 'apps/api/src/lib/foo.ts',
          status: 'added',
          additions: 5,
          deletions: 0,
        },
      ],
      networkHosts: ['attacker.example.com'],
    });
    const cls = classifyPaths(input.files.map((f) => f.path));
    const r = scorePR(input, cls);
    expect(r.flags.some((f) => f.id === 'new-network-hosts')).toBe(true);
  });

  it('caps the risk score at 100', () => {
    const input = baseInput({
      pr: {
        number: 1,
        title: 't',
        body: '',
        author: 'newbie',
        authorAssociation: 'FIRST_TIME_CONTRIBUTOR',
        baseRef: 'main',
        headSha: 'abcdef0',
        draft: false,
      },
      files: [
        { path: 'apps/auth-sms/x.ts', status: 'modified', additions: 1, deletions: 0 },
        { path: 'apps/identity/y.ts', status: 'modified', additions: 1, deletions: 0 },
        { path: 'package.json', status: 'modified', additions: 1, deletions: 0 },
        { path: '.github/workflows/ci.yml', status: 'modified', additions: 1, deletions: 0 },
      ],
      newDeps: [
        { name: 'a', version: '1', ecosystem: 'npm' },
        { name: 'b', version: '1', ecosystem: 'npm' },
        { name: 'c', version: '1', ecosystem: 'npm' },
      ],
      networkHosts: ['x.example.com', 'y.example.com'],
      promptInjectionHits: ['ignore-previous-instructions (config/prompts/x.md)'],
    });
    const cls = classifyPaths(input.files.map((f) => f.path));
    const r = scorePR(input, cls);
    expect(r.riskScore).toBeLessThanOrEqual(100);
    expect(r.verdict).toBe('red');
  });

  it('yellow when adding 3+ deps without sensitive zones', () => {
    const input = baseInput({
      files: [{ path: 'apps/api/package.json', status: 'modified', additions: 3, deletions: 0 }],
      newDeps: [
        { name: 'a', version: '1', ecosystem: 'npm' },
        { name: 'b', version: '1', ecosystem: 'npm' },
        { name: 'c', version: '1', ecosystem: 'npm' },
      ],
    });
    const cls = classifyPaths(input.files.map((f) => f.path));
    const r = scorePR(input, cls);
    expect(r.verdict).toBe('yellow');
  });

  it('passes external flags through', () => {
    const input = baseInput({
      externalFlags: [
        {
          id: 'gitleaks-aws-key',
          severity: 'critical',
          score: 90,
          title: 'AWS access key found in diff',
          source: 'gitleaks',
        },
      ],
    });
    const cls = classifyPaths([]);
    const r = scorePR(input, cls);
    expect(r.verdict).toBe('red');
    expect(r.flags.some((f) => f.source === 'gitleaks')).toBe(true);
  });

  it('a single high-severity finding alone forces red even at low score', () => {
    const input = baseInput({
      externalFlags: [
        {
          id: 'semgrep-eval',
          severity: 'high',
          score: 0, // intentionally zero — verify severity floor still applies
          title: 'eval() usage',
          source: 'semgrep',
        },
      ],
    });
    const cls = classifyPaths([]);
    const r = scorePR(input, cls);
    expect(r.verdict).toBe('red');
  });

  it('a single medium severity floor forces yellow', () => {
    const input = baseInput({
      externalFlags: [
        {
          id: 'osv-low-impact',
          severity: 'medium',
          score: 0,
          title: 'GHSA-XXXX',
          source: 'osv-scanner',
        },
      ],
    });
    const cls = classifyPaths([]);
    const r = scorePR(input, cls);
    expect(r.verdict).toBe('yellow');
  });
});
