import { describe, it, expect, vi } from 'vitest';
import { reloadOrRestart, pm2Save } from '../pm2.js';

describe('reloadOrRestart', () => {
  it('returns reload action when reload succeeds', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: '', stderr: '' };
    });
    const r = await reloadOrRestart({
      name: 'my-app',
      ecosystemFile: '/x.cjs',
      execImpl: exec,
    });
    expect(r.action).toBe('reload');
    expect(calls[0].args).toEqual(['reload', 'my-app', '--update-env']);
    expect(calls).toHaveLength(1);
  });

  it('falls back to restart when reload fails', async () => {
    let n = 0;
    const exec = vi.fn(async () => {
      n += 1;
      if (n === 1) return { code: 1, stdout: '', stderr: 'cannot reload fork-mode' };
      return { code: 0, stdout: '', stderr: '' };
    });
    const r = await reloadOrRestart({
      name: 'my-app',
      ecosystemFile: '/x.cjs',
      execImpl: exec,
    });
    expect(r.action).toBe('restart');
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('falls all the way back to start from ecosystem when neither reload nor restart works', async () => {
    let n = 0;
    const exec = vi.fn(async () => {
      n += 1;
      if (n < 3) return { code: 1, stdout: '', stderr: 'unknown process' };
      return { code: 0, stdout: '', stderr: '' };
    });
    const r = await reloadOrRestart({
      name: 'my-app',
      ecosystemFile: '/x.cjs',
      execImpl: exec,
    });
    expect(r.action).toBe('start');
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('passes --update-env on reload', async () => {
    let argsSeen: string[] = [];
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      argsSeen = args;
      return { code: 0, stdout: '', stderr: '' };
    });
    await reloadOrRestart({
      name: 'a',
      ecosystemFile: '/x',
      execImpl: exec,
    });
    expect(argsSeen).toContain('--update-env');
  });

  it('start uses --only flag with the named process', async () => {
    let lastArgs: string[] = [];
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      lastArgs = args;
      return { code: lastArgs[0] === 'start' ? 0 : 1, stdout: '', stderr: '' };
    });
    await reloadOrRestart({
      name: 'foo',
      ecosystemFile: '/eco.cjs',
      execImpl: exec,
    });
    expect(lastArgs).toEqual(['start', '/eco.cjs', '--only', 'foo', '--update-env']);
  });

  it('records duration', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const r = await reloadOrRestart({
      name: 'a',
      ecosystemFile: '/x',
      execImpl: exec,
    });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('pm2Save', () => {
  it('returns ok=true when pm2 save succeeds', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const r = await pm2Save(exec);
    expect(r.ok).toBe(true);
  });

  it('returns ok=false on save failure', async () => {
    const exec = vi.fn(async () => ({ code: 1, stdout: '', stderr: '' }));
    const r = await pm2Save(exec);
    expect(r.ok).toBe(false);
  });
});
