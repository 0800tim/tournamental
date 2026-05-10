import { describe, it, expect, vi } from 'vitest';
import { smoke } from '../smoke.js';
import { EventEmitter } from 'node:events';

function fakeChild() {
  const e = new EventEmitter() as EventEmitter & {
    pid: number; killed: boolean; exitCode: number | null;
    kill: (sig?: string) => boolean; stdout: EventEmitter; stderr: EventEmitter;
  };
  e.pid = 999;
  e.killed = false;
  e.exitCode = null;
  e.kill = () => { e.killed = true; return true; };
  e.stdout = new EventEmitter();
  e.stderr = new EventEmitter();
  return e;
}

describe('smoke', () => {
  it('passes when all asserts return expected status', async () => {
    const fakeFetch: any = vi.fn(async (_url: string) => new Response('', { status: 200 }));
    const fakeSpawn: any = vi.fn(() => fakeChild());
    const r = await smoke({
      startCmd: 'echo',
      cwd: '/tmp',
      env: {},
      port: 12345,
      asserts: [
        { url: '/healthz', label: 'health' },
        { url: '/api/x', label: 'api' },
      ],
      log: () => undefined,
      fetchImpl: fakeFetch,
      spawnImpl: fakeSpawn,
      readyTimeoutSec: 2,
    });
    expect(r.passed).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.asserts).toHaveLength(2);
    expect(r.asserts.every(a => a.ok)).toBe(true);
  });

  it('fails when an assert returns wrong status', async () => {
    let n = 0;
    const fakeFetch: any = vi.fn(async () => {
      n += 1;
      // ready probe + 2 asserts
      if (n === 1) return new Response('', { status: 200 });
      if (n === 2) return new Response('', { status: 200 });
      return new Response('', { status: 500 });
    });
    const fakeSpawn: any = vi.fn(() => fakeChild());
    const r = await smoke({
      startCmd: 'echo',
      cwd: '/tmp',
      env: {},
      port: 12345,
      asserts: [
        { url: '/ok', label: 'ok' },
        { url: '/bad', label: 'bad' },
      ],
      log: () => undefined,
      fetchImpl: fakeFetch,
      spawnImpl: fakeSpawn,
      readyTimeoutSec: 2,
    });
    expect(r.passed).toBe(false);
    expect(r.asserts.find(a => a.label === 'bad')?.ok).toBe(false);
  });

  it('respects custom expected status (e.g. 302)', async () => {
    let n = 0;
    const fakeFetch: any = vi.fn(async () => {
      n += 1;
      if (n === 1) return new Response('', { status: 200 });
      return new Response('', { status: 302 });
    });
    const fakeSpawn: any = vi.fn(() => fakeChild());
    const r = await smoke({
      startCmd: 'echo',
      cwd: '/tmp',
      env: {},
      port: 12345,
      asserts: [{ url: '/redirect', expect: 302, label: 'redir' }],
      log: () => undefined,
      fetchImpl: fakeFetch,
      spawnImpl: fakeSpawn,
      readyTimeoutSec: 2,
    });
    expect(r.passed).toBe(true);
  });

  it('returns ready=false when server never starts', async () => {
    const fakeFetch: any = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const fakeSpawn: any = vi.fn(() => fakeChild());
    const r = await smoke({
      startCmd: 'echo',
      cwd: '/tmp',
      env: {},
      port: 12345,
      asserts: [{ url: '/x', label: 'x' }],
      log: () => undefined,
      fetchImpl: fakeFetch,
      spawnImpl: fakeSpawn,
      readyTimeoutSec: 1,
    });
    expect(r.passed).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('kills the child server on completion', async () => {
    const c = fakeChild();
    const fakeFetch: any = vi.fn(async () => new Response('', { status: 200 }));
    const fakeSpawn: any = vi.fn(() => c);
    await smoke({
      startCmd: 'echo',
      cwd: '/tmp',
      env: {},
      port: 12345,
      asserts: [{ url: '/x' }],
      log: () => undefined,
      fetchImpl: fakeFetch,
      spawnImpl: fakeSpawn,
      readyTimeoutSec: 1,
    });
    expect(c.killed).toBe(true);
  });

  it('records error string for unreachable assert URL', async () => {
    let n = 0;
    const fakeFetch: any = vi.fn(async () => {
      n += 1;
      if (n === 1) return new Response('', { status: 200 });
      throw new Error('connection-reset');
    });
    const fakeSpawn: any = vi.fn(() => fakeChild());
    const r = await smoke({
      startCmd: 'echo',
      cwd: '/tmp',
      env: {},
      port: 12345,
      asserts: [{ url: '/oops', label: 'oops' }],
      log: () => undefined,
      fetchImpl: fakeFetch,
      spawnImpl: fakeSpawn,
      readyTimeoutSec: 1,
    });
    expect(r.passed).toBe(false);
    expect(r.asserts[0].error).toContain('connection-reset');
  });

  it('warns on slow asserts but still passes', async () => {
    const fakeFetch: any = vi.fn(async () => {
      // delay so elapsed > budget
      await new Promise(r => setTimeout(r, 25));
      return new Response('', { status: 200 });
    });
    const fakeSpawn: any = vi.fn(() => fakeChild());
    const lines: string[] = [];
    const r = await smoke({
      startCmd: 'echo',
      cwd: '/tmp',
      env: {},
      port: 12345,
      asserts: [{ url: '/x', label: 'x', maxMs: 5 }],
      log: (l) => lines.push(l),
      fetchImpl: fakeFetch,
      spawnImpl: fakeSpawn,
      readyTimeoutSec: 1,
    });
    expect(r.passed).toBe(true);
    expect(lines.some(l => l.includes('WARN'))).toBe(true);
  });
});
