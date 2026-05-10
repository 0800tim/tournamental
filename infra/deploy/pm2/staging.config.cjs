/**
 * PM2 ecosystem for the *staging* environment.
 *
 * Each app is registered twice across the env files:
 *   - <name>-staging here (port 33xx → staging slot)
 *   - <name>-prod    in production.config.cjs (same internal port,
 *                    public hostname differs by Cloudflare-Tunnel ingress)
 *
 * Apps not yet deployable (clip-pipeline, vstamp, etc.) are commented out
 * and added as they ship.
 *
 * Source slot is wired via env vars:
 *   NEXT_BUILD_DIR  → for Next apps   (e.g. ./.next-prod)
 *   ASTRO_OUT_DIR   → for Astro apps  (e.g. ./dist-prod)
 *   For Fastify/Node, the published `script` path points at the slot.
 */

const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const APPS = path.join(REPO_ROOT, 'apps');

/** Helper to make a uniform per-app config block. */
function fastifyApp({ name, app, port }) {
  return {
    name,
    cwd: path.join(APPS, app),
    script: path.join(APPS, app, 'dist-prod', 'index.js'),
    interpreter: 'node',
    interpreter_args: '--enable-source-maps',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '0.0.0.0',
    },
    env_file: path.join(REPO_ROOT, 'apps', app, '.env.staging'),
    out_file: `/var/log/vtorn/${name}.out.log`,
    error_file: `/var/log/vtorn/${name}.err.log`,
    merge_logs: true,
    max_memory_restart: '512M',
    autorestart: true,
  };
}

function nextApp({ name, app, port }) {
  return {
    name,
    cwd: path.join(APPS, app),
    script: 'node_modules/.bin/next',
    args: `start --hostname 0.0.0.0 --port ${port}`,
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      NEXT_BUILD_DIR: path.join(APPS, app, '.next-prod'),
      PORT: String(port),
    },
    env_file: path.join(REPO_ROOT, 'apps', app, '.env.staging'),
    out_file: `/var/log/vtorn/${name}.out.log`,
    error_file: `/var/log/vtorn/${name}.err.log`,
    merge_logs: true,
    max_memory_restart: '1G',
    autorestart: true,
  };
}

function astroApp({ name, app, port }) {
  return {
    name,
    cwd: path.join(APPS, app),
    script: 'node_modules/.bin/astro',
    args: `preview --host 0.0.0.0 --port ${port}`,
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      ASTRO_OUT_DIR: path.join(APPS, app, 'dist-prod'),
      PORT: String(port),
    },
    env_file: path.join(REPO_ROOT, 'apps', app, '.env.staging'),
    out_file: `/var/log/vtorn/${name}.out.log`,
    error_file: `/var/log/vtorn/${name}.err.log`,
    merge_logs: true,
    max_memory_restart: '512M',
    autorestart: true,
  };
}

module.exports = {
  apps: [
    astroApp({ name: 'vtorn-marketing-staging', app: 'marketing', port: 13320 }),
    nextApp({ name: 'vtorn-web-staging', app: 'web', port: 13300 }),
    fastifyApp({ name: 'vtorn-api-staging', app: 'api', port: 13310 }),
    fastifyApp({ name: 'vtorn-game-staging', app: 'game', port: 13360 }),
    // fastifyApp({ name: 'vtorn-auth-sms-staging', app: 'auth-sms', port: 13330 }),
    // fastifyApp({ name: 'vtorn-dm-otp-staging', app: 'dm-otp', port: 13331 }),
    // fastifyApp({ name: 'vtorn-odds-ingest-staging', app: 'odds-ingest', port: 13341 }),
    // fastifyApp({ name: 'vtorn-stream-server-staging', app: 'stream-server', port: 14002 }),
    // fastifyApp({ name: 'vtorn-affiliate-router-staging', app: 'affiliate-router', port: 13370 }),
    // fastifyApp({ name: 'vtorn-vstamp-staging', app: 'vstamp', port: 13390 }),
    // fastifyApp({ name: 'vtorn-clip-pipeline-staging', app: 'clip-pipeline', port: 13380 }),
    // nextApp({ name: 'vtorn-admin-staging', app: 'admin', port: 13340 }),
  ],
};
