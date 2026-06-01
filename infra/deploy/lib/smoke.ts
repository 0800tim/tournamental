/**
 * smoke.ts — boot the freshly-built staging slot on a private port,
 * hammer it with a few HTTP asserts, return pass/fail.
 *
 * If ANY assert fails, the orchestrator aborts before swapping prod.
 *
 * Bound to 127.0.0.1 deliberately — never publicly exposed.
 */

import { spawn, type ChildProcess } from 'node:child_process';

export interface SmokeAssertion {
  /** Path on the test server (e.g. '/healthz'). */
  url: string;
  /** Expected HTTP status. Defaults to 200. */
  expect?: number;
  /** Optional max response time in ms (warn if exceeded). */
  maxMs?: number;
  /** Human label for log output. */
  label?: string;
}

export interface SmokeOptions {
  /** Command to start the throwaway server. */
  startCmd: string;
  /** Working directory for the started process. */
  cwd: string;
  /** Environment vars to merge with process.env. */
  env: Record<string, string>;
  /** Port the server will bind to (must match what `startCmd` uses). */
  port: number;
  /** Asserts to run once the server is ready. */
  asserts: SmokeAssertion[];
  /** Max seconds to wait for the server to come up. Default 60. */
  readyTimeoutSec?: number;
  /** Logger. Defaults to console.log. */
  log?: (line: string) => void;
  /** Health probe URL to detect server-ready. Defaults to '/'. */
  readyProbeUrl?: string;
  /** Test seam — mockable HTTP fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam — mockable spawn. */
  spawnImpl?: typeof spawn;
}

export interface SmokeResult {
  passed: boolean;
  ready: boolean;
  asserts: Array<{
    url: string;
    label: string;
    expected: number;
    actual?: number;
    ok: boolean;
    elapsedMs?: number;
    error?: string;
  }>;
  durationMs: number;
}

/**
 * Run smoke tests. Boots the server, polls until ready, runs all asserts,
 * always tears the server down.
 */
export async function smoke(opts: SmokeOptions): Promise<SmokeResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const fetcher = opts.fetchImpl ?? fetch;
  const spawner = opts.spawnImpl ?? spawn;
  const readyTimeoutSec = opts.readyTimeoutSec ?? 60;
  const readyProbe = opts.readyProbeUrl ?? '/';
  const t0 = Date.now();

  log(`[smoke] starting test server on 127.0.0.1:${opts.port}`);
  const child: ChildProcess = spawner(opts.startCmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    shell: true,
    stdio: 'pipe',
    detached: false,
  });
  // Forward child output so smoke failures are debuggable; without this
  // a crash-on-startup looks like "server exited prematurely" with no
  // useful context. Prefixed so the orchestrator's own logs stay
  // distinguishable from the smoke server's own output.
  if (child.stdout) {
    child.stdout.on('data', (b: Buffer) =>
      process.stderr.write(`[smoke:stdout] ${b}`),
    );
  }
  if (child.stderr) {
    child.stderr.on('data', (b: Buffer) =>
      process.stderr.write(`[smoke:stderr] ${b}`),
    );
  }

  const cleanup = async () => {
    if (child.pid && !child.killed) {
      try {
        child.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        // best-effort
      }
    }
  };

  // poll readiness
  let ready = false;
  for (let i = 0; i < readyTimeoutSec; i++) {
    if (child.exitCode !== null) {
      log(`[smoke] server exited prematurely (code=${child.exitCode})`);
      break;
    }
    try {
      const res = await fetcher(`http://127.0.0.1:${opts.port}${readyProbe}`, {
        signal: AbortSignal.timeout(2000),
      });
      // any non-network response means the server is up; status doesn't matter
      // for the readiness probe, only for the asserts below.
      void res;
      ready = true;
      log(`[smoke] ready after ${i + 1}s`);
      break;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (!ready) {
    await cleanup();
    return {
      passed: false,
      ready: false,
      asserts: [],
      durationMs: Date.now() - t0,
    };
  }

  const results: SmokeResult['asserts'] = [];
  for (const a of opts.asserts) {
    const expected = a.expect ?? 200;
    const label = a.label ?? a.url;
    const aT0 = Date.now();
    try {
      const res = await fetcher(`http://127.0.0.1:${opts.port}${a.url}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const elapsed = Date.now() - aT0;
      const ok = res.status === expected;
      results.push({ url: a.url, label, expected, actual: res.status, ok, elapsedMs: elapsed });
      if (ok) {
        log(`[smoke] OK   ${label}  HTTP ${res.status}  ${elapsed}ms`);
      } else {
        log(`[smoke] FAIL ${label}  expected ${expected}, got ${res.status}`);
      }
      if (a.maxMs && elapsed > a.maxMs) {
        log(`[smoke] WARN ${label}  ${elapsed}ms > budget ${a.maxMs}ms`);
      }
    } catch (err) {
      results.push({
        url: a.url,
        label,
        expected,
        ok: false,
        error: (err as Error).message,
      });
      log(`[smoke] FAIL ${label}  ${(err as Error).message}`);
    }
  }

  await cleanup();

  return {
    passed: results.every(r => r.ok),
    ready: true,
    asserts: results,
    durationMs: Date.now() - t0,
  };
}
