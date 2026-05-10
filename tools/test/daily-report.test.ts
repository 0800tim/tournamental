/**
 * Tests for the daily-report generator.
 *
 * The script is structured as pure functions plus a thin `runMain`
 * shell, so we exercise:
 *   - `parseConventionalSubject` and `summariseCommitTypes` over a
 *     synthetic git log,
 *   - `extractPort` against the actual script patterns we ship with
 *     (next, astro, fastify-with-PORT),
 *   - `parseArgs` for CLI flag handling,
 *   - `renderReport` produces the expected section structure,
 *   - `buildOutput` is idempotent — second run appends instead of
 *     overwriting.
 */

import { describe, expect, it } from 'vitest';
import {
  buildOutput,
  extractPort,
  formatLongDate,
  parseArgs,
  parseConventionalSubject,
  parseGitLogOutput,
  renderReport,
  summariseCommitTypes,
  type ReportData,
} from '../src/daily-report.js';

describe('parseConventionalSubject', () => {
  it('extracts type and scope from a feat() subject', () => {
    expect(parseConventionalSubject('feat(web): add /team/[code] page')).toEqual({
      type: 'feat',
      scope: 'web',
    });
  });

  it('handles a scopeless fix', () => {
    expect(parseConventionalSubject('fix: handle empty payload')).toEqual({
      type: 'fix',
      scope: null,
    });
  });

  it('returns nulls for non-conventional subjects', () => {
    expect(parseConventionalSubject('Random unstructured commit')).toEqual({
      type: null,
      scope: null,
    });
  });

  it('handles a breaking-change marker', () => {
    expect(parseConventionalSubject('feat(api)!: drop legacy /v0 endpoint')).toEqual({
      type: 'feat',
      scope: 'api',
    });
  });
});

describe('parseGitLogOutput + summariseCommitTypes', () => {
  it('parses synthetic log and aggregates type counts', () => {
    const raw = [
      'aaaaaaaaaaaa1 feat(web): add bracket page',
      'aaaaaaaaaaaa2 feat(api): add /v1/predictions',
      'aaaaaaaaaaaa3 fix(renderer): jitter on lerp',
      'aaaaaaaaaaaa4 docs(spec): note penalty events',
      'aaaaaaaaaaaa5 chore: bump deps',
      'aaaaaaaaaaaa6 something unstructured',
    ].join('\n');
    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(6);
    expect(commits[0]).toMatchObject({
      hash: 'aaaaaaa',
      type: 'feat',
      scope: 'web',
    });
    const counts = summariseCommitTypes(commits);
    expect(counts).toEqual([
      { type: 'feat', count: 2 },
      { type: 'chore', count: 1 },
      { type: 'docs', count: 1 },
      { type: 'fix', count: 1 },
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(parseGitLogOutput('')).toEqual([]);
    expect(parseGitLogOutput('   \n  ')).toEqual([]);
  });
});

describe('extractPort', () => {
  it('reads next dev -p NNNN', () => {
    expect(extractPort('next dev -p 3300')).toBe(3300);
    expect(extractPort('next start -p 3340')).toBe(3340);
  });

  it('reads astro --port NNNN', () => {
    expect(extractPort('astro dev --host 0.0.0.0 --port 3320')).toBe(3320);
  });

  it('reads --port=NNNN', () => {
    expect(extractPort('node server.js --port=4001')).toBe(4001);
  });

  it('reads PORT=NNNN env style', () => {
    expect(extractPort('PORT=3398 tsx watch src/index.ts')).toBe(3398);
  });

  it('returns null when no port is present', () => {
    expect(extractPort('tsx watch src/index.ts')).toBeNull();
    expect(extractPort(undefined)).toBeNull();
    expect(extractPort('')).toBeNull();
  });
});

describe('parseArgs', () => {
  it('defaults to today UTC and the default root', () => {
    const args = parseArgs([], '2026-05-11', '/repo');
    expect(args).toEqual({
      date: '2026-05-11',
      dryRun: false,
      repoRoot: '/repo',
      skipTests: false,
    });
  });

  it('respects --date and --dry-run', () => {
    const args = parseArgs(['--date=2026-01-02', '--dry-run'], '2026-05-11', '/repo');
    expect(args.date).toBe('2026-01-02');
    expect(args.dryRun).toBe(true);
  });

  it('respects --skip-tests', () => {
    const args = parseArgs(['--skip-tests'], '2026-05-11', '/repo');
    expect(args.skipTests).toBe(true);
  });

  it('rejects malformed --date', () => {
    expect(() => parseArgs(['--date=2026/05/11'], '2026-05-11', '/repo')).toThrow();
  });
});

describe('formatLongDate', () => {
  it('formats a UTC date without timezone drift', () => {
    expect(formatLongDate('2026-05-11')).toBe('Monday 11 May 2026');
    expect(formatLongDate('2026-05-10')).toBe('Sunday 10 May 2026');
  });
});

describe('renderReport', () => {
  function fixture(overrides: Partial<ReportData> = {}): ReportData {
    return {
      date: '2026-05-11',
      longDate: 'Monday 11 May 2026',
      generatedAt: '2026-05-11T08:00:00.000Z',
      commits: [
        { hash: 'abc1234', subject: 'feat(web): add /team/[code] page', type: 'feat', scope: 'web' },
        { hash: 'abc1235', subject: 'fix(api): null guard', type: 'fix', scope: 'api' },
      ],
      commitTypeCounts: [
        { type: 'feat', count: 1 },
        { type: 'fix', count: 1 },
      ],
      apps: [
        {
          group: 'apps',
          dir: 'web',
          name: '@vtorn/web',
          port: 3300,
          description: 'Tournamental 3D match renderer',
        },
        {
          group: 'apps',
          dir: 'auth-sms',
          name: '@vtorn/auth-sms',
          port: null,
          description: null,
        },
      ],
      packages: [
        {
          group: 'packages',
          dir: 'spec',
          name: '@vtorn/spec',
          port: null,
          description: 'Shared types',
        },
      ],
      testSummary: 'Test Files  12 passed (12)\nTests  470 passed (470)',
      openPRs: [
        { number: 94, title: 'feat(api): add v2 events', createdAt: '2026-05-11T07:00:00Z', state: 'OPEN' },
      ],
      warnings: [],
      ...overrides,
    };
  }

  it('renders a complete report with all sections', () => {
    const md = renderReport(fixture());
    // Front-matter
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toMatch(/^date: 2026-05-11$/m);
    expect(md).toMatch(/^commits: 2$/m);
    expect(md).toMatch(/^apps: 2$/m);
    expect(md).toMatch(/^packages: 1$/m);
    expect(md).toMatch(/^open_prs: 1$/m);
    // Title
    expect(md).toContain('# Daily Progress Report — Monday 11 May 2026');
    // Sections
    expect(md).toContain('## Headline numbers');
    expect(md).toContain('## Commits');
    expect(md).toContain('## Test summary');
    expect(md).toContain('## Open pull requests');
    expect(md).toContain("## What's running locally right now");
    expect(md).toContain('## Shared packages');
    // Commit list
    expect(md).toContain('- `abc1234` feat(web): add /team/[code] page');
    // Port table
    expect(md).toContain(':3300');
    // Open PR
    expect(md).toContain('#94 feat(api): add v2 events');
    // Conventional commit summary
    expect(md).toContain('1× `feat`');
    expect(md).toContain('1× `fix`');
  });

  it('handles a no-activity day gracefully', () => {
    const md = renderReport(
      fixture({
        commits: [],
        commitTypeCounts: [],
        openPRs: [],
        testSummary: null,
        warnings: ['gh pr list unavailable: command not found'],
      }),
    );
    expect(md).toContain('No commits landed during this UTC day');
    expect(md).toContain('No open pull requests');
    expect(md).toContain('Test runner output unavailable');
    expect(md).toContain('## Notes from the generator');
    expect(md).toContain('gh pr list unavailable');
  });
});

describe('buildOutput (idempotency)', () => {
  const generatedAt = '2026-05-11T15:32:00.000Z';
  const rendered = '---\ndate: 2026-05-11\n---\n\n# Daily Progress Report — Monday 11 May 2026\n\nBody.\n';

  it('returns the rendered content verbatim on first run', () => {
    const out = buildOutput(undefined, { generatedAt, rendered });
    expect(out).toBe(rendered);
  });

  it('appends an "Update appended at" section on subsequent runs', () => {
    const existing = rendered;
    const out = buildOutput(existing, { generatedAt, rendered });
    expect(out.startsWith(existing)).toBe(true);
    expect(out).toContain('## Update appended at 15:32 UTC');
    // Front-matter should NOT be duplicated in the appended block.
    const fmCount = (out.match(/^---$/gm) ?? []).length;
    expect(fmCount).toBe(2); // only the original opening + closing
  });

  it('preserves orchestrator hand-edits when re-running', () => {
    const handEdited = rendered + '\n## Orchestrator notes\n\nI added context.\n';
    const out = buildOutput(handEdited, { generatedAt, rendered });
    expect(out).toContain('## Orchestrator notes');
    expect(out).toContain('I added context.');
    expect(out).toContain('## Update appended at 15:32 UTC');
  });
});
