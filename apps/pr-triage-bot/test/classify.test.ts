import { describe, it, expect } from 'vitest';
import { classifyPaths } from '../src/lib/classify.js';

describe('classifyPaths', () => {
  it('returns empty result for empty input', () => {
    const r = classifyPaths([]);
    expect(r.workspaces).toEqual([]);
    expect(r.areaLabels).toEqual([]);
    expect(r.touchesSensitive).toBe(false);
    expect(r.touchesWorkflow).toBe(false);
    expect(r.touchesRootManifest).toBe(false);
  });

  it('detects apps and topic labels', () => {
    const r = classifyPaths([
      'apps/web/components/replay/Field.tsx',
      'apps/web/lib/animation/lerp.ts',
      'apps/api/src/routes/match.ts',
    ]);
    expect(r.workspaces).toContain('apps/web');
    expect(r.workspaces).toContain('apps/api');
    expect(r.areaLabels).toContain('area:renderer');
    expect(r.areaLabels).toContain('area:api');
  });

  it('flags sensitive auth zone', () => {
    const r = classifyPaths(['apps/auth-sms/src/lib/otp.ts']);
    expect(r.touchesSensitive).toBe(true);
    expect(r.sensitiveReasons).toContain('apps/auth-sms');
    expect(r.areaLabels).toContain('area:auth');
  });

  it('flags identity, vstamp, drips, dm-otp as sensitive', () => {
    const r = classifyPaths([
      'apps/identity/src/lib/storage.ts',
      'apps/vstamp/src/lib/merkle.ts',
      'apps/drips-bridge/src/lib/payouts.ts',
      'apps/dm-otp/src/lib/code.ts',
    ]);
    expect(r.touchesSensitive).toBe(true);
    expect(r.sensitiveReasons.sort()).toEqual([
      'apps/dm-otp',
      'apps/drips-bridge',
      'apps/identity',
      'apps/vstamp',
    ]);
  });

  it('flags workflow changes', () => {
    const r = classifyPaths(['.github/workflows/pr-security.yml']);
    expect(r.touchesWorkflow).toBe(true);
    expect(r.touchesSensitive).toBe(true);
  });

  it('flags root manifest changes', () => {
    const r = classifyPaths(['package.json', 'pnpm-lock.yaml']);
    expect(r.touchesRootManifest).toBe(true);
    expect(r.touchesSensitive).toBe(true);
  });

  it('does NOT flag a nested package.json as the root manifest', () => {
    const r = classifyPaths(['apps/web/package.json']);
    expect(r.touchesRootManifest).toBe(false);
    // It does flag as sensitive because /^package\.json$/ does not match
    // but the SENSITIVE_FILES list only matches root files.
    expect(r.touchesSensitive).toBe(false);
  });

  it('detects packages and spec', () => {
    const r = classifyPaths(['packages/spec/src/index.ts']);
    expect(r.workspaces).toContain('packages/spec');
    expect(r.areaLabels).toContain('area:spec');
  });

  it('catches docs changes as area:docs', () => {
    const r = classifyPaths(['docs/04-renderer.md']);
    expect(r.areaLabels).toContain('area:docs');
    expect(r.touchesSensitive).toBe(false);
  });

  it('does not double-count workspaces', () => {
    const r = classifyPaths([
      'apps/web/a.ts',
      'apps/web/b.ts',
      'apps/web/c.ts',
    ]);
    expect(r.workspaces).toEqual(['apps/web']);
  });
});
