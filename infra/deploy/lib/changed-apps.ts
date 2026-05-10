/**
 * changed-apps.ts — compute the list of apps whose files changed in a
 * git diff range.
 *
 * Used by:
 *   - `publish-all.ts` to decide which apps to deploy after a merge
 *   - the build matrix in .github/workflows/build-and-deploy.yml
 *     (paths-filter could do this too, but having it as a TS function
 *     means we can unit-test the mapping logic and reuse it locally)
 */

import { spawnSync } from 'node:child_process';

export interface ChangedAppsOptions {
  /** repoRoot — passed as cwd to git. */
  repoRoot: string;
  /** Diff range. Defaults to 'origin/main..HEAD'. */
  range?: string;
  /** Test seam — pre-supplied list of changed file paths. */
  filesOverride?: string[];
  /**
   * Map a repo-relative path to the app name it belongs to, or null if it's
   * not part of any app. Default mapping:
   *   apps/<name>/...                  → <name>
   *   packages/<name>/...              → null (handled as monorepo dep change)
   *   infra/deploy/**                  → '__deploy_lib__' (special: rebuild all)
   *   pnpm-lock.yaml | tsconfig.base.* → '__lockfile__' (special: rebuild all)
   *   docs/**, sessions/**             → null
   */
  mapper?: (p: string) => string | null;
}

export interface ChangedAppsResult {
  /** App slugs e.g. ['marketing', 'web'] */
  apps: string[];
  /** Did a global trigger fire (lockfile, deploy lib, base tsconfig)? */
  rebuildAll: boolean;
  /** Raw file list. */
  files: string[];
  /** Reason text for human logs. */
  reasons: Record<string, string[]>;
}

const DEFAULT_MAPPER: NonNullable<ChangedAppsOptions['mapper']> = (p) => {
  if (p.startsWith('apps/')) {
    const slug = p.split('/')[1];
    return slug ?? null;
  }
  if (p.startsWith('packages/')) {
    // a packages/* change can affect any consumer; let the caller decide.
    // We mark it as a global trigger so all apps rebuild.
    return '__lockfile__';
  }
  if (p === 'pnpm-lock.yaml' || p === 'pnpm-workspace.yaml' || p.startsWith('tsconfig.base')) {
    return '__lockfile__';
  }
  if (p.startsWith('infra/deploy/')) {
    return '__deploy_lib__';
  }
  return null;
};

export function detectChangedApps(opts: ChangedAppsOptions): ChangedAppsResult {
  const mapper = opts.mapper ?? DEFAULT_MAPPER;
  let files = opts.filesOverride;
  if (!files) {
    const range = opts.range ?? 'origin/main..HEAD';
    const r = spawnSync('git', ['diff', '--name-only', range], {
      cwd: opts.repoRoot,
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      // Fall back to all-files-staged (still a valid signal).
      const fallback = spawnSync('git', ['ls-files'], { cwd: opts.repoRoot, encoding: 'utf8' });
      files = (fallback.stdout || '').split('\n').filter(Boolean);
    } else {
      files = (r.stdout || '').split('\n').filter(Boolean);
    }
  }

  const reasons: Record<string, string[]> = {};
  const apps = new Set<string>();
  let rebuildAll = false;

  for (const f of files) {
    const slug = mapper(f);
    if (!slug) continue;
    if (slug === '__lockfile__' || slug === '__deploy_lib__') {
      rebuildAll = true;
      reasons[slug] ??= [];
      reasons[slug].push(f);
      continue;
    }
    apps.add(slug);
    reasons[slug] ??= [];
    reasons[slug].push(f);
  }

  return {
    apps: [...apps].sort(),
    rebuildAll,
    files,
    reasons,
  };
}
