import { describe, it, expect } from 'vitest';
import { detectChangedApps } from '../lib/changed-apps.js';

/**
 * publish-all.ts itself is mostly orchestration glue. We test:
 *   - the change-detection result matches what publish-all would loop over
 *   - the rebuild-all signal triggers the all-apps fan-out
 *
 * The publish() function is exercised end-to-end by manual dry-runs;
 * unit tests for it would require a full fake Next/Astro/Fastify build,
 * which is not pulling its weight.
 */

describe('publish-all change-detection driver', () => {
  it('returns the list of apps the parallel runner will iterate', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: [
        'apps/marketing/src/index.astro',
        'apps/api/src/server.ts',
        'docs/22-deployment-and-tunnels.md',
      ],
    });
    expect(r.apps.sort()).toEqual(['api', 'marketing']);
    expect(r.rebuildAll).toBe(false);
  });

  it('triggers rebuild-all on a packages/* change', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: ['packages/spec/src/index.ts'],
    });
    expect(r.rebuildAll).toBe(true);
  });

  it('triggers rebuild-all on infra/deploy change', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: ['infra/deploy/lib/swap.ts'],
    });
    expect(r.rebuildAll).toBe(true);
  });

  it('returns empty when only docs and sessions changed', () => {
    const r = detectChangedApps({
      repoRoot: '/x',
      filesOverride: ['docs/47-cicd-pipeline.md', 'sessions/x.md'],
    });
    expect(r.apps).toEqual([]);
    expect(r.rebuildAll).toBe(false);
  });
});
