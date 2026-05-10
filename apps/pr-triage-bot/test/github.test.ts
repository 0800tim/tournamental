import { describe, it, expect, vi } from 'vitest';
import { GithubAdapter, type Runner } from '../src/lib/github.js';

function mockRunner(responses: Array<{ stdout?: string; stderr?: string; code?: number }>): Runner {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      code: r.code ?? 0,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
    });
  }
  return fn as Runner;
}

describe('GithubAdapter.getPR', () => {
  it('parses gh pr view output', async () => {
    const runner = mockRunner([
      {
        stdout: JSON.stringify({
          number: 42,
          title: 'feat: x',
          body: 'desc',
          author: { login: 'octocat' },
          authorAssociation: 'CONTRIBUTOR',
          baseRefName: 'main',
          headRefOid: 'abcdef1234',
          isDraft: false,
        }),
      },
    ]);
    const gh = new GithubAdapter({ repo: '0800tim/vtorn', runner });
    const pr = await gh.getPR(42);
    expect(pr.number).toBe(42);
    expect(pr.author).toBe('octocat');
    expect(pr.headRefOid).toBe('abcdef1234');
  });

  it('throws on non-zero exit', async () => {
    const runner = mockRunner([{ code: 1, stderr: 'not found' }]);
    const gh = new GithubAdapter({ repo: '0800tim/vtorn', runner });
    await expect(gh.getPR(99)).rejects.toThrow(/not found/);
  });
});

describe('GithubAdapter.listFiles', () => {
  it('parses paginated output', async () => {
    const arr1 = JSON.stringify([
      { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0 },
    ]);
    const arr2 = JSON.stringify([
      { filename: 'b.ts', status: 'added', additions: 5, deletions: 0 },
    ]);
    const runner = mockRunner([{ stdout: `${arr1}\n${arr2}` }]);
    const gh = new GithubAdapter({ repo: '0800tim/vtorn', runner });
    const files = await gh.listFiles(1);
    expect(files.length).toBe(2);
    expect(files[0]?.path).toBe('a.ts');
    expect(files[1]?.path).toBe('b.ts');
  });
});

describe('GithubAdapter.applyLabels', () => {
  it('rejects unsafe label names', async () => {
    const runner = mockRunner([{}]);
    const gh = new GithubAdapter({ repo: '0800tim/vtorn', runner });
    await expect(gh.applyLabels(1, ['valid', 'with space'])).rejects.toThrow(/unsafe label/);
  });

  it('skips when label list is empty', async () => {
    const runner = mockRunner([]);
    const gh = new GithubAdapter({ repo: '0800tim/vtorn', runner });
    await gh.applyLabels(1, []);
    // No calls made.
    expect((runner as unknown as { mock?: { calls: unknown[] } }).mock?.calls.length ?? 0).toBe(0);
  });
});

describe('GithubAdapter.requestReviewers', () => {
  it('rejects unsafe reviewer logins', async () => {
    const runner = mockRunner([{}]);
    const gh = new GithubAdapter({ repo: '0800tim/vtorn', runner });
    await expect(gh.requestReviewers(1, ['valid', 'has;semicolon'])).rejects.toThrow(/unsafe reviewer/);
  });
});
