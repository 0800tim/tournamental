import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TimingsRecorder, appendTimings } from '../timings.js';

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vtorn-timings-test-'));
});

describe('TimingsRecorder', () => {
  it('records each step duration', async () => {
    const rec = new TimingsRecorder('marketing', 'staging', { repoRoot: tmpRoot });
    await rec.step('build', () => Promise.resolve(42));
    await rec.step('smoke', () => Promise.resolve());
    const out = await rec.finalise('success');
    expect(out.steps.map(s => s.name)).toEqual(['build', 'smoke']);
    expect(out.steps.every(s => s.ok)).toBe(true);
  });

  it('records throwing step as ok=false and rethrows', async () => {
    const rec = new TimingsRecorder('marketing', 'staging', { repoRoot: tmpRoot });
    await expect(rec.step('boom', async () => { throw new Error('x'); })).rejects.toThrow('x');
    const out = await rec.finalise('failed');
    expect(out.steps[0].ok).toBe(false);
  });

  it('appends to deploy-timings.jsonl', async () => {
    const rec = new TimingsRecorder('marketing', 'staging', { repoRoot: tmpRoot });
    await rec.step('build', () => Promise.resolve());
    await rec.finalise('success');
    const p = path.join(tmpRoot, 'data', 'deploy-timings.jsonl');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf8');
    expect(content.trim().split('\n')).toHaveLength(1);
    const j = JSON.parse(content.trim());
    expect(j.app).toBe('marketing');
    expect(j.outcome).toBe('success');
  });

  it('appends across multiple deploys', async () => {
    for (let i = 0; i < 3; i++) {
      const rec = new TimingsRecorder('a', 'staging', { repoRoot: tmpRoot });
      await rec.step('s', () => Promise.resolve());
      await rec.finalise('success');
    }
    const p = path.join(tmpRoot, 'data', 'deploy-timings.jsonl');
    expect(fs.readFileSync(p, 'utf8').trim().split('\n')).toHaveLength(3);
  });

  it('does not throw if disk write fails (best-effort)', async () => {
    // simulate by pointing at an unwritable location — actually just point
    // at a dir that can't be created (file in place of dir).
    const blocker = path.join(tmpRoot, 'blocked');
    fs.writeFileSync(blocker, 'I am a file not a dir');
    const rec = new TimingsRecorder('a', 'staging', {
      path: path.join(blocker, 'inside.jsonl'),
    });
    await rec.step('s', () => Promise.resolve());
    await expect(rec.finalise('success')).resolves.toBeDefined();
  });

  it('honours explicit path option', async () => {
    const explicit = path.join(tmpRoot, 'custom.jsonl');
    const rec = new TimingsRecorder('a', 'production', { path: explicit });
    await rec.step('s', () => Promise.resolve());
    await rec.finalise('success', { buildId: 'abc', notes: 'ok' });
    const j = JSON.parse(fs.readFileSync(explicit, 'utf8').trim());
    expect(j.buildId).toBe('abc');
    expect(j.notes).toBe('ok');
    expect(j.env).toBe('production');
  });
});

describe('appendTimings', () => {
  it('appends a single line', async () => {
    const p = path.join(tmpRoot, 'a', 'b', 'log.jsonl');
    await appendTimings(
      {
        app: 'x',
        env: 'staging',
        startedAt: '2026-01-01T00:00:00Z',
        finishedAt: '2026-01-01T00:00:01Z',
        durationMs: 1000,
        steps: [],
        outcome: 'success',
      },
      p,
    );
    expect(fs.existsSync(p)).toBe(true);
  });
});
