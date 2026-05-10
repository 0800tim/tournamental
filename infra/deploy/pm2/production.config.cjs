/**
 * PM2 ecosystem for the *production* environment.
 *
 * Mirrors staging.config.cjs but:
 *   - process names end in -prod
 *   - reads from .env.production (gitignored)
 *   - port table is the canonical 33xx range from docs/22.
 *
 * Internal ports stay localhost; public traffic comes via the Cloudflare
 * Tunnel ingress rules.
 */

const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const APPS = path.join(REPO_ROOT, 'apps');

function fastifyApp({ name, app, port, instances = 1 }) {
  return {
    name,
    cwd: path.join(APPS, app),
    script: path.join(APPS, app, 'dist-prod', 'index.js'),
    interpreter: 'node',
    interpreter_args: '--enable-source-maps',
    instances,
    exec_mode: instances > 1 ? 'cluster' : 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '0.0.0.0',
    },
    env_file: path.join(REPO_ROOT, 'apps', app, '.env.production'),
    out_file: `/var/log/vtorn/${name}.out.log`,
    error_file: `/var/log/vtorn/${name}.err.log`,
    merge_logs: true,
    max_memory_restart: '512M',
    autorestart: true,
  };
}

function nextApp({ name, app, port, instances = 1 }) {
  return {
    name,
    cwd: path.join(APPS, app),
    script: 'node_modules/.bin/next',
    args: `start --hostname 0.0.0.0 --port ${port}`,
    instances,
    exec_mode: instances > 1 ? 'cluster' : 'fork',
    env: {
      NODE_ENV: 'production',
      NEXT_BUILD_DIR: path.join(APPS, app, '.next-prod'),
      PORT: String(port),
    },
    env_file: path.join(REPO_ROOT, 'apps', app, '.env.production'),
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
    env_file: path.join(REPO_ROOT, 'apps', app, '.env.production'),
    out_file: `/var/log/vtorn/${name}.out.log`,
    error_file: `/var/log/vtorn/${name}.err.log`,
    merge_logs: true,
    max_memory_restart: '512M',
    autorestart: true,
  };
}

module.exports = {
  apps: [
    astroApp({ name: 'vtorn-marketing-prod', app: 'marketing', port: 3320 }),
    nextApp({ name: 'vtorn-web-prod', app: 'web', port: 3300, instances: 2 }),
    fastifyApp({ name: 'vtorn-api-prod', app: 'api', port: 3310, instances: 2 }),
    fastifyApp({ name: 'vtorn-game-prod', app: 'game', port: 3360, instances: 2 }),
    // fastifyApp({ name: 'vtorn-auth-sms-prod', app: 'auth-sms', port: 3330 }),
    // fastifyApp({ name: 'vtorn-dm-otp-prod', app: 'dm-otp', port: 3331 }),
    // fastifyApp({ name: 'vtorn-odds-ingest-prod', app: 'odds-ingest', port: 3341 }),
    // fastifyApp({ name: 'vtorn-stream-server-prod', app: 'stream-server', port: 4002, instances: 2 }),
    // fastifyApp({ name: 'vtorn-affiliate-router-prod', app: 'affiliate-router', port: 3370 }),
    // fastifyApp({ name: 'vtorn-vstamp-prod', app: 'vstamp', port: 3390 }),
    // fastifyApp({ name: 'vtorn-clip-pipeline-prod', app: 'clip-pipeline', port: 3380 }),
    // nextApp({ name: 'vtorn-admin-prod', app: 'admin', port: 3340 }),
  ],
};
