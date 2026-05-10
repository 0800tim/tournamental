import { describe, it, expect } from 'vitest';
import {
  slotPaths,
  buildCommand,
  startCommand,
  smokeStartCommand,
} from '../build-slots.js';

describe('slotPaths', () => {
  it('uses .next prefix for next', () => {
    const s = slotPaths({ kind: 'next', appDir: '/repo/apps/web' });
    expect(s.staging).toBe('/repo/apps/web/.next-staging');
    expect(s.prod).toBe('/repo/apps/web/.next-prod');
    expect(s.prev).toBe('/repo/apps/web/.next-prev');
    expect(s.failed).toBe('/repo/apps/web/.next-failed');
  });

  it('uses dist prefix for astro', () => {
    const s = slotPaths({ kind: 'astro', appDir: '/repo/apps/marketing' });
    expect(s.staging).toBe('/repo/apps/marketing/dist-staging');
    expect(s.prod).toBe('/repo/apps/marketing/dist-prod');
  });

  it('uses dist prefix for node and fastify', () => {
    expect(slotPaths({ kind: 'node', appDir: '/x' }).staging).toBe('/x/dist-staging');
    expect(slotPaths({ kind: 'fastify', appDir: '/x' }).staging).toBe('/x/dist-staging');
  });

  it('honours custom prefix', () => {
    const s = slotPaths({ kind: 'next', appDir: '/x', prefix: 'build' });
    expect(s.staging).toBe('/x/build-staging');
    expect(s.prod).toBe('/x/build-prod');
  });

  it('resolves relative app dirs', () => {
    const s = slotPaths({ kind: 'next', appDir: 'apps/web' });
    expect(s.staging.endsWith('apps/web/.next-staging')).toBe(true);
    // absolute
    expect(s.staging.startsWith('/')).toBe(true);
  });
});

describe('buildCommand', () => {
  it('next sets NEXT_BUILD_DIR', () => {
    const slots = slotPaths({ kind: 'next', appDir: '/x' });
    const bc = buildCommand({ kind: 'next', appDir: '/x' }, slots);
    expect(bc.cmd).toContain('build');
    expect(bc.env.NEXT_BUILD_DIR).toBe(slots.staging);
    expect(bc.env.NODE_ENV).toBe('production');
    expect(bc.postMove).toBeUndefined();
  });

  it('astro returns a postMove from dist to dist-staging', () => {
    const slots = slotPaths({ kind: 'astro', appDir: '/x' });
    const bc = buildCommand({ kind: 'astro', appDir: '/x' }, slots);
    expect(bc.postMove).toBeDefined();
    expect(bc.postMove?.from).toBe('/x/dist');
    expect(bc.postMove?.to).toBe('/x/dist-staging');
  });

  it('node and fastify post-move dist to dist-staging', () => {
    for (const kind of ['node', 'fastify'] as const) {
      const slots = slotPaths({ kind, appDir: '/x' });
      const bc = buildCommand({ kind, appDir: '/x' }, slots);
      expect(bc.postMove?.from).toBe('/x/dist');
      expect(bc.postMove?.to).toBe('/x/dist-staging');
    }
  });
});

describe('startCommand', () => {
  it('next start uses prod slot via NEXT_BUILD_DIR', () => {
    const slots = slotPaths({ kind: 'next', appDir: '/x' });
    const sc = startCommand({ kind: 'next', appDir: '/x' }, slots, 3300);
    expect(sc.cmd).toContain('next start');
    expect(sc.cmd).toContain('--port 3300');
    expect(sc.env.NEXT_BUILD_DIR).toBe(slots.prod);
  });

  it('astro preview points at prod slot via ASTRO_OUT_DIR', () => {
    const slots = slotPaths({ kind: 'astro', appDir: '/x' });
    const sc = startCommand({ kind: 'astro', appDir: '/x' }, slots, 3320);
    expect(sc.cmd).toContain('astro preview');
    expect(sc.env.ASTRO_OUT_DIR).toBe(slots.prod);
  });

  it('node + fastify start runs node on the prod slot index.js', () => {
    for (const kind of ['node', 'fastify'] as const) {
      const slots = slotPaths({ kind, appDir: '/x' });
      const sc = startCommand({ kind, appDir: '/x' }, slots, 3310);
      expect(sc.cmd).toContain('/x/dist-prod/index.js');
    }
  });
});

describe('smokeStartCommand', () => {
  it('binds to 127.0.0.1 for next', () => {
    const slots = slotPaths({ kind: 'next', appDir: '/x' });
    const sc = smokeStartCommand({ kind: 'next', appDir: '/x' }, slots, 3099);
    expect(sc.cmd).toContain('127.0.0.1');
    expect(sc.cmd).toContain('--port 3099');
    expect(sc.env.NEXT_BUILD_DIR).toBe(slots.staging);
  });

  it('binds to 127.0.0.1 for astro', () => {
    const slots = slotPaths({ kind: 'astro', appDir: '/x' });
    const sc = smokeStartCommand({ kind: 'astro', appDir: '/x' }, slots, 4099);
    expect(sc.cmd).toContain('127.0.0.1');
    expect(sc.env.ASTRO_OUT_DIR).toBe(slots.staging);
  });

  it('node + fastify points at staging slot', () => {
    for (const kind of ['node', 'fastify'] as const) {
      const slots = slotPaths({ kind, appDir: '/x' });
      const sc = smokeStartCommand({ kind, appDir: '/x' }, slots, 5099);
      expect(sc.cmd).toContain('/x/dist-staging/index.js');
      expect(sc.env.PORT).toBe('5099');
      expect(sc.env.HOST).toBe('127.0.0.1');
    }
  });
});
