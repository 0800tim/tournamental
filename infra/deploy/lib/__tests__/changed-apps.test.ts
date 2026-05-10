import { describe, it, expect } from 'vitest';
import { detectChangedApps } from '../changed-apps.js';

describe('detectChangedApps', () => {
  it('maps apps/<name>/... to that app', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: [
        'apps/marketing/src/page.astro',
        'apps/marketing/package.json',
        'apps/web/components/foo.tsx',
      ],
    });
    expect(r.apps).toEqual(['marketing', 'web']);
    expect(r.rebuildAll).toBe(false);
  });

  it('treats packages/* changes as rebuild-all', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: ['packages/spec/src/index.ts'],
    });
    expect(r.rebuildAll).toBe(true);
  });

  it('treats lockfile changes as rebuild-all', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: ['pnpm-lock.yaml'],
    });
    expect(r.rebuildAll).toBe(true);
  });

  it('treats infra/deploy changes as rebuild-all', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: ['infra/deploy/lib/swap.ts'],
    });
    expect(r.rebuildAll).toBe(true);
  });

  it('ignores docs and sessions', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: [
        'docs/47-cicd-pipeline.md',
        'sessions/2026-05-11_x.md',
      ],
    });
    expect(r.apps).toEqual([]);
    expect(r.rebuildAll).toBe(false);
  });

  it('records reasons per app', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: [
        'apps/web/x.ts',
        'apps/web/y.ts',
        'apps/api/z.ts',
      ],
    });
    expect(r.reasons.web).toHaveLength(2);
    expect(r.reasons.api).toHaveLength(1);
  });

  it('dedupes apps that appear in many files', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: Array.from({ length: 20 }, (_, i) => `apps/web/file${i}.ts`),
    });
    expect(r.apps).toEqual(['web']);
  });

  it('honours custom mapper', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: ['custom/something.ts'],
      mapper: (p) => (p.startsWith('custom/') ? 'custom' : null),
    });
    expect(r.apps).toEqual(['custom']);
  });

  it('returns sorted apps', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: [
        'apps/zeta/x.ts',
        'apps/alpha/x.ts',
        'apps/mu/x.ts',
      ],
    });
    expect(r.apps).toEqual(['alpha', 'mu', 'zeta']);
  });
});
