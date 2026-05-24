/**
 * pm2.ts — PM2 reload/restart wrapper.
 *
 * Strategy:
 *   - Prefer `pm2 reload <name> --update-env` (zero-downtime if cluster mode).
 *   - Fall back to `pm2 restart <name> --update-env` if reload returns
 *     non-zero (which it will for fork-mode apps that PM2 won't reload).
 *   - If the app isn't yet known to PM2, `pm2 start` it from the ecosystem
 *     file the caller passes in.
 *
 * The actual exec is exposed as a test seam so unit tests can run without PM2.
 */

import { spawn } from 'node:child_process';

export interface Pm2Options {
  /** PM2 process name, e.g. 'vtorn-marketing-prod'. */
  name: string;
  /** Path to the ecosystem file used for first-time `pm2 start`. */
  ecosystemFile: string;
  /**
   * Deploy environment. `pm2 reload --update-env` inherits the parent
   * shell's env, so if NODE_ENV in the publish-all shell is 'development'
   * it will clobber the ecosystem's NODE_ENV='production' on every
   * reload. We force the correct NODE_ENV in the spawn env to prevent
   * that. Tim 2026-05-24: hit this in prod — Next.js never loaded
   * .env.production, AUTH_JWT_SECRET was empty, every signed-in
   * session 401'd.
   */
  env?: 'staging' | 'production';
  /** Logger. */
  log?: (line: string) => void;
  /**
   * Test seam — replace the exec call. Default uses node:child_process.spawn.
   * Should resolve { code, stdout, stderr }.
   */
  execImpl?: (cmd: string, args: string[], execEnv?: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface Pm2Result {
  action: 'reload' | 'restart' | 'start' | 'noop';
  durationMs: number;
  stdout: string;
  stderr: string;
}

const realExec = (cmd: string, args: string[], execEnv?: NodeJS.ProcessEnv) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const c = spawn(cmd, args, {
      stdio: 'pipe',
      shell: false,
      env: execEnv ?? process.env,
    });
    let stdout = '';
    let stderr = '';
    c.stdout?.on('data', (d) => (stdout += d.toString()));
    c.stderr?.on('data', (d) => (stderr += d.toString()));
    c.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    c.on('error', (e) => resolve({ code: 1, stdout, stderr: stderr + (e?.message ?? '') }));
  });

/**
 * Reload the named PM2 process, falling back to restart, falling back to
 * start (from ecosystem file) if the process is unknown to PM2.
 *
 * Returns which action was actually taken so callers can log it.
 */
export async function reloadOrRestart(opts: Pm2Options): Promise<Pm2Result> {
  const log = opts.log ?? (() => undefined);
  const exec = opts.execImpl ?? realExec;
  const t0 = Date.now();

  // pm2 reload / restart with --update-env inherits the parent shell's
  // env. The publish-all orchestrator runs from a shell that may have
  // NODE_ENV=development (the host's default), which then clobbers the
  // ecosystem's NODE_ENV=production. We force the right NODE_ENV in
  // the spawn env so the next pm2 call surfaces the correct one to the
  // running process. Also keep the existing env so PATH etc. still
  // work. Tim 2026-05-24 root cause for the silent session-401 outage.
  const targetNodeEnv = opts.env === 'production' ? 'production' : 'development';
  const execEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: targetNodeEnv,
  };

  // try reload first (zero-downtime, works for cluster-mode apps)
  log(`[pm2] reload ${opts.name} (NODE_ENV=${targetNodeEnv})`);
  const r = await exec('pm2', ['reload', opts.name, '--update-env'], execEnv);
  if (r.code === 0) {
    return {
      action: 'reload',
      durationMs: Date.now() - t0,
      stdout: r.stdout,
      stderr: r.stderr,
    };
  }

  // reload failed — try restart (~2-3s blip but works for fork mode)
  log(`[pm2] reload failed (${r.code}), trying restart`);
  const restart = await exec('pm2', ['restart', opts.name, '--update-env'], execEnv);
  if (restart.code === 0) {
    return {
      action: 'restart',
      durationMs: Date.now() - t0,
      stdout: restart.stdout,
      stderr: restart.stderr,
    };
  }

  // restart failed — process likely not registered. Start from ecosystem.
  log(`[pm2] restart failed (${restart.code}), starting from ecosystem ${opts.ecosystemFile}`);
  const start = await exec(
    'pm2',
    ['start', opts.ecosystemFile, '--only', opts.name, '--update-env'],
    execEnv,
  );
  return {
    action: 'start',
    durationMs: Date.now() - t0,
    stdout: start.stdout,
    stderr: start.stderr,
  };
}

/**
 * `pm2 save` — persists the current process list to the dump file so it
 * resurrects on host reboot. Cheap; safe to call after every deploy.
 */
export async function pm2Save(
  execImpl?: Pm2Options['execImpl'],
): Promise<{ ok: boolean }> {
  const exec = execImpl ?? realExec;
  const r = await exec('pm2', ['save']);
  return { ok: r.code === 0 };
}
