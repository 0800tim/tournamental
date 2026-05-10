/**
 * GitHub adapter — wraps the `gh` CLI for PR data + comment posting.
 *
 * SECURITY notes:
 *   - We never pass PR-derived strings as shell args. Every spawn call
 *     uses an argv array (no shell), so PR titles, bodies, diffs cannot
 *     break out into the shell.
 *   - When posting a comment, the body is written to a tempfile and
 *     passed via `--input <file>` — eliminating arg-length issues and
 *     any quoting risk.
 *   - We accept a `runner` for tests so no real `gh` calls happen during
 *     unit tests.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RunnerResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (cmd: string, args: readonly string[], stdin?: string) => Promise<RunnerResult>;

export const realRunner: Runner = (cmd, args, stdin) =>
  new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += String(d)));
    proc.stderr.on('data', (d) => (stderr += String(d)));
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    if (stdin !== undefined) {
      proc.stdin.end(stdin);
    }
  });

export interface GithubAdapterOptions {
  repo: string; // "owner/repo"
  runner?: Runner;
}

export class GithubAdapter {
  constructor(private readonly opts: GithubAdapterOptions) {}

  private get runner(): Runner {
    return this.opts.runner ?? realRunner;
  }

  /** Fetch PR metadata via `gh pr view`. */
  async getPR(prNumber: number): Promise<{
    number: number;
    title: string;
    body: string;
    author: string;
    authorAssociation: string;
    baseRef: string;
    headRefOid: string;
    isDraft: boolean;
  }> {
    // gh pr view --json does NOT support authorAssociation; fetch it via gh api.
    const fields = [
      'number',
      'title',
      'body',
      'author',
      'baseRefName',
      'headRefOid',
      'isDraft',
    ];
    const res = await this.runner('gh', [
      'pr',
      'view',
      String(prNumber),
      '--repo',
      this.opts.repo,
      '--json',
      fields.join(','),
    ]);
    if (res.code !== 0) {
      throw new Error(`gh pr view failed: ${res.stderr.trim()}`);
    }
    const raw = JSON.parse(res.stdout) as {
      number: number;
      title: string;
      body: string;
      author?: { login?: string };
      baseRefName: string;
      headRefOid: string;
      isDraft: boolean;
    };
    // Pull author_association via the raw API; default to NONE if unavailable.
    let authorAssociation = 'NONE';
    try {
      const apiRes = await this.runner('gh', [
        'api',
        `repos/${this.opts.repo}/pulls/${prNumber}`,
        '--jq',
        '.author_association',
      ]);
      if (apiRes.code === 0) {
        const v = apiRes.stdout.trim();
        if (v) authorAssociation = v;
      }
    } catch {
      // best-effort; default already set
    }
    return {
      number: raw.number,
      title: raw.title ?? '',
      body: raw.body ?? '',
      author: raw.author?.login ?? 'unknown',
      authorAssociation,
      baseRef: raw.baseRefName,
      headRefOid: raw.headRefOid,
      isDraft: raw.isDraft,
    };
  }

  /** Fetch the file list via `gh api`. */
  async listFiles(prNumber: number): Promise<
    Array<{
      path: string;
      status: 'added' | 'modified' | 'removed' | 'renamed';
      additions: number;
      deletions: number;
      patch?: string;
    }>
  > {
    const res = await this.runner('gh', [
      'api',
      `repos/${this.opts.repo}/pulls/${prNumber}/files`,
      '--paginate',
    ]);
    if (res.code !== 0) {
      throw new Error(`gh api files failed: ${res.stderr.trim()}`);
    }
    // The CLI returns a series of JSON arrays concatenated when paginating.
    const text = res.stdout.trim();
    const arrays = text.split(/\n(?=\[)/g);
    const all: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }> = [];
    for (const a of arrays) {
      if (!a) continue;
      const parsed = JSON.parse(a);
      if (Array.isArray(parsed)) all.push(...parsed);
    }
    return all
      .map((f) => ({
        path: f.filename,
        status: normaliseStatus(f.status),
        additions: f.additions,
        deletions: f.deletions,
        patch: typeof f.patch === 'string' ? f.patch.slice(0, 200_000) : undefined,
      }))
      .filter((f) => !!f.path);
  }

  /**
   * Post or update the triage comment idempotently.
   *
   * Strategy: list comments, find the one whose body starts with our
   * marker, and replace; otherwise create a new one.
   */
  async upsertComment(
    prNumber: number,
    marker: string,
    body: string,
  ): Promise<{ created: boolean; commentId: number }> {
    // 1. Find existing
    const list = await this.runner('gh', [
      'api',
      `repos/${this.opts.repo}/issues/${prNumber}/comments`,
      '--paginate',
    ]);
    if (list.code !== 0) {
      throw new Error(`gh api comments list failed: ${list.stderr.trim()}`);
    }
    const arrays = list.stdout.trim().split(/\n(?=\[)/g);
    const all: Array<{ id: number; body: string }> = [];
    for (const a of arrays) {
      if (!a) continue;
      const parsed = JSON.parse(a);
      if (Array.isArray(parsed)) all.push(...parsed);
    }
    const existing = all.find((c) => typeof c.body === 'string' && c.body.includes(marker));

    // 2. Stage body via tempfile to avoid arg-length / quoting risk.
    const dir = mkdtempSync(join(tmpdir(), 'vtorn-triage-'));
    const path = join(dir, 'body.md');
    writeFileSync(path, body, 'utf-8');
    try {
      if (existing) {
        const res = await this.runner('gh', [
          'api',
          `repos/${this.opts.repo}/issues/comments/${existing.id}`,
          '-X',
          'PATCH',
          '-F',
          `body=@${path}`,
        ]);
        if (res.code !== 0) {
          throw new Error(`gh api comment patch failed: ${res.stderr.trim()}`);
        }
        return { created: false, commentId: existing.id };
      }
      const res = await this.runner('gh', [
        'api',
        `repos/${this.opts.repo}/issues/${prNumber}/comments`,
        '-X',
        'POST',
        '-F',
        `body=@${path}`,
      ]);
      if (res.code !== 0) {
        throw new Error(`gh api comment create failed: ${res.stderr.trim()}`);
      }
      const created = JSON.parse(res.stdout) as { id: number };
      return { created: true, commentId: created.id };
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
  }

  /** Apply a label set to a PR. Pre-existing labels are preserved. */
  async applyLabels(prNumber: number, labels: readonly string[]): Promise<void> {
    if (labels.length === 0) return;
    // Validate: no spaces, only allowed chars; reject anything weird.
    for (const l of labels) {
      if (!/^[a-z0-9:_\-./]+$/i.test(l)) {
        throw new Error(`Refusing to apply unsafe label: ${JSON.stringify(l)}`);
      }
    }
    const args = [
      'pr',
      'edit',
      String(prNumber),
      '--repo',
      this.opts.repo,
      ...labels.flatMap((l) => ['--add-label', l]),
    ];
    const res = await this.runner('gh', args);
    if (res.code !== 0) {
      // Common cause: a label doesn't exist yet. Don't fail the whole
      // triage — log to stderr and continue.
      // eslint-disable-next-line no-console
      console.warn(`gh pr edit (labels) non-zero exit: ${res.stderr.trim()}`);
    }
  }

  /** Request reviewers (best-effort; ignore "already requested" failures). */
  async requestReviewers(prNumber: number, reviewers: readonly string[]): Promise<void> {
    if (reviewers.length === 0) return;
    for (const r of reviewers) {
      if (!/^[A-Za-z0-9-]+$/.test(r)) {
        throw new Error(`Refusing to request unsafe reviewer name: ${JSON.stringify(r)}`);
      }
    }
    const args = [
      'pr',
      'edit',
      String(prNumber),
      '--repo',
      this.opts.repo,
      ...reviewers.flatMap((r) => ['--add-reviewer', r]),
    ];
    const res = await this.runner('gh', args);
    if (res.code !== 0) {
      // eslint-disable-next-line no-console
      console.warn(`gh pr edit (reviewers) non-zero exit: ${res.stderr.trim()}`);
    }
  }
}

function normaliseStatus(s: string): 'added' | 'modified' | 'removed' | 'renamed' {
  switch (s) {
    case 'added':
    case 'modified':
    case 'removed':
    case 'renamed':
      return s;
    case 'changed':
      return 'modified';
    default:
      return 'modified';
  }
}
