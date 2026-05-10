import { describe, it, expect } from 'vitest';
import { triage } from '../src/lib/triage.js';
import type { TriageInput } from '../src/lib/types.js';

const NOW = new Date('2026-05-11T00:00:00Z');

function input(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    pr: {
      number: 21,
      title: 'feat(api): expose match summary',
      body: 'Adds /v1/match/:id summary endpoint.',
      author: 'somebody',
      authorAssociation: 'CONTRIBUTOR',
      baseRef: 'main',
      headSha: 'deadbee',
      draft: false,
    },
    files: [
      {
        path: 'apps/api/src/routes/match.ts',
        status: 'modified',
        additions: 12,
        deletions: 0,
      },
    ],
    networkHosts: [],
    newEnvVars: [],
    newDeps: [],
    externalFlags: [],
    promptInjectionHits: [],
    ...overrides,
  };
}

describe('triage', () => {
  it('produces a stable verdict shape', () => {
    const v = triage(input(), { now: NOW });
    expect(v.prNumber).toBe(21);
    expect(v.verdict).toBe('green');
    expect(v.summary.filesChanged).toBe(1);
    expect(v.summary.appsTouched).toContain('apps/api');
    expect(v.labels).toContain('auto-triage:green');
    expect(v.labels).toContain('area:api');
    expect(v.marker).toContain('vtorn-triage-bot:rev:deadbee');
    expect(v.generatedAt).toBe(NOW.toISOString());
  });

  it.todo('does not request the PR author as reviewer', () => {
    const v = triage(
      input({
        pr: {
          number: 1,
          title: 't',
          body: '',
          author: '0800tim',
          authorAssociation: 'OWNER',
          baseRef: 'main',
          headSha: 'abcd',
          draft: false,
        },
        files: [
          {
            path: 'apps/auth-sms/src/x.ts',
            status: 'modified',
            additions: 1,
            deletions: 0,
          },
        ],
      }),
    );
    expect(v.reviewers).not.toContain('0800tim');
  });

  it.todo('requests human reviewer for sensitive zone changes (non-author)', () => {
    const v = triage(
      input({
        pr: {
          number: 1,
          title: 't',
          body: '',
          author: 'someone-else',
          authorAssociation: 'CONTRIBUTOR',
          baseRef: 'main',
          headSha: 'abcd',
          draft: false,
        },
        files: [
          {
            path: 'apps/auth-sms/src/x.ts',
            status: 'modified',
            additions: 1,
            deletions: 0,
          },
        ],
      }),
    );
    expect(v.verdict).toBe('red');
    expect(v.reviewers).toContain('0800tim');
  });

  it('rejects malformed input via Zod', () => {
    expect(() => triage({ pr: { number: 'oops' } })).toThrow();
    expect(() => triage({})).toThrow();
  });

  it('idempotent verdict when re-run on same input', () => {
    const v1 = triage(input(), { now: NOW });
    const v2 = triage(input(), { now: NOW });
    expect(v1).toEqual(v2);
  });

  it('dryRun flag flows through', () => {
    const v = triage(input(), { dryRun: true, now: NOW });
    expect(v.dryRun).toBe(true);
  });

  it('applies deps/security labels for prompt-injection hits', () => {
    const v = triage(
      input({
        files: [
          { path: 'config/prompts/x.md', status: 'added', additions: 1, deletions: 0 },
        ],
        promptInjectionHits: ['ignore-previous-instructions (config/prompts/x.md)'],
      }),
    );
    expect(v.labels).toContain('security:prompt-injection');
    expect(v.labels).toContain('auto-triage:red');
  });
});
