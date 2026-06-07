#!/usr/bin/env node
// Tournamental billion-bot dashboard.
//
// - Serves HTML + JSON stats for a pool of bot-node child processes.
// - Each worker = one `tournamental-bot-node generate --bots=<batch>` process,
//   writing to its own SQLite DB at $DATA_DIR/worker-XX.db.
// - Adjustable worker count, batch size, elapsed time, instantaneous rate,
//   host + container CPU readouts.
// - Dry-run: workers never POST to central.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const PORT = Number(process.env.DASH_PORT || 4080);
const HOST = process.env.DASH_HOST || "0.0.0.0";
const INITIAL_WORKERS = Number(process.env.WORKERS || 48);
const MAX_WORKERS = Number(process.env.MAX_WORKERS || 96);
const INITIAL_BATCH = Number(process.env.BATCH_SIZE || 100_000);
const TARGET = Number(process.env.TARGET_BOTS || 1_000_000_000);
const DATA_DIR = process.env.DATA_DIR || "/app/data";
const NODE_LABEL = process.env.NODE_LABEL || "vtorn-dev-1b-test";
const CLI = process.env.BOT_NODE_CLI || "tournamental-bot-node";
const HOST_PROC_STAT = process.env.HOST_PROC_STAT || "/host-proc/stat";
const HOST_PROC_LOADAVG = process.env.HOST_PROC_LOADAVG || "/host-proc/loadavg";
const TOTAL_HOST_CORES = cpus().length;
const CLK_TCK = 100; // Standard Linux USER_HZ; bot-node never overrides.

// Aggregate-leaderboard publish config. When OPERATOR_API_KEY is set,
// the dashboard auto-POSTs /v1/swarms/<sha256(key)>/summary every
// PUBLISH_INTERVAL_MS so the count shows up on the operator's
// /profile/<operator_id>/swarm page. Same payload shape the browser
// swarm uses (apps/web/components/browser-swarm/federation.ts).
const OPERATOR_API_KEY = process.env.OPERATOR_API_KEY || "";
const CENTRAL_URL = (process.env.CENTRAL_URL || "https://api.tournamental.com").replace(/\/$/, "");
// Cadence is "publish once every PUBLISH_EVERY_BOTS new bots OR every
// PUBLISH_MAX_INTERVAL_MS, whichever comes first". The volume trigger
// is the primary, the time-based one is a safety net so a slow swarm
// still shows life on the leaderboard between batches.
const PUBLISH_EVERY_BOTS = Number(process.env.PUBLISH_EVERY_BOTS || 100_000);
const PUBLISH_MAX_INTERVAL_MS = Number(process.env.PUBLISH_MAX_INTERVAL_MS || 5 * 60_000);
const PUBLISH_MIN_INTERVAL_MS = Number(process.env.PUBLISH_MIN_INTERVAL_MS || 5_000);
// Legacy alias - keep for the dashboard label.
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS || PUBLISH_MAX_INTERVAL_MS);
const OPERATOR_ID = OPERATOR_API_KEY
  ? createHash("sha256").update(OPERATOR_API_KEY).digest("hex")
  : "";
// Cosmetic match catalogue is the bundled 104-match WC 2026 fixture
// file; the dashboard needs the first match's kickoff to set
// kickoff_at on the publish payload (idempotency key).
let FIRST_KICKOFF_AT = Date.now();
try {
  const matchesFile = process.env.TOURNAMENTAL_MATCHES;
  if (matchesFile) {
    const arr = JSON.parse(readFileSync(matchesFile, "utf8"));
    if (Array.isArray(arr) && arr.length > 0) {
      FIRST_KICKOFF_AT = new Date(arr[0].kickoff_utc).getTime();
    }
  }
} catch {
  // fall through with Date.now()
}

mkdirSync(DATA_DIR, { recursive: true });

const state = {
  running: false,
  started_at: null,
  stopped_at: null,
  desired_workers: INITIAL_WORKERS,
  batch_size: INITIAL_BATCH,
  workers: [], // index -> WorkerHandle
  errors: [],
  bots_at_start: 0,
  total_bots_cached: 0,
  total_bots_cached_at: 0,
  last_rate_bots: 0,
  last_rate_ts: 0,
  rate_window: [], // [{ts, total}] for short-window rolling rate
};

function workerDbPath(i) {
  return join(DATA_DIR, `worker-${String(i).padStart(2, "0")}.db`);
}

function spawnWorker(i) {
  const dbPath = workerDbPath(i);
  const env = {
    ...process.env,
    TOURNAMENTAL_NODE_DB: dbPath,
    LOG_LEVEL: "warn",
  };
  const w = {
    i,
    dbPath,
    batches: 0,
    lastExitCode: null,
    alive: false,
    proc: null,
    stopRequested: false,
    cpu_clk_ticks: 0, // cumulative cpu time for this worker's pids (utime+stime)
  };

  function loop() {
    if (w.stopRequested || i >= state.desired_workers) {
      w.alive = false;
      return;
    }
    const proc = spawn(CLI, ["generate", `--bots=${state.batch_size}`], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    w.proc = proc;
    w.alive = true;
    let errBuf = "";
    proc.stderr.on("data", (d) => {
      errBuf += d.toString();
    });
    proc.on("exit", (code) => {
      // Accumulate cpu ticks from the dying process before we lose its /proc entry.
      // (Already gone by here, but resourceUsage isn't available on children;
      //  we rely on /proc sampling during the run instead.)
      w.lastExitCode = code;
      if (code !== 0 && errBuf) {
        state.errors.push({
          worker: i,
          ts: Date.now(),
          code,
          msg: errBuf.slice(0, 200),
        });
        if (state.errors.length > 50) state.errors.shift();
      }
      if (code === 0) w.batches += 1;
      w.proc = null;
      if (!w.stopRequested && state.running && i < state.desired_workers) {
        setImmediate(loop);
      } else {
        w.alive = false;
      }
    });
  }

  w.start = () => {
    w.stopRequested = false;
    loop();
  };
  w.stop = () => {
    w.stopRequested = true;
    if (w.proc && !w.proc.killed) {
      try { w.proc.kill("SIGTERM"); } catch {}
    }
  };
  return w;
}

function ensureWorkerCount() {
  // Spawn / tear down to match desired_workers without touching live ones.
  while (state.workers.length < state.desired_workers) {
    const idx = state.workers.length;
    const w = spawnWorker(idx);
    state.workers.push(w);
    if (state.running) w.start();
  }
  // Surplus workers above desired_workers: tell them to stop after current batch.
  for (let i = state.desired_workers; i < state.workers.length; i++) {
    state.workers[i].stop();
  }
}

function startAll() {
  if (state.running) return;
  state.errors = [];
  // Read current bot count as our baseline so rate is "since Start", not "since DB inception".
  const baseline = countAllBots();
  state.bots_at_start = baseline;
  state.last_rate_bots = baseline;
  state.last_rate_ts = Date.now();
  state.rate_window = [{ ts: Date.now(), total: baseline }];

  state.running = true;
  state.started_at = Date.now();
  state.stopped_at = null;
  ensureWorkerCount();
  for (const w of state.workers.slice(0, state.desired_workers)) {
    if (!w.alive) w.start();
  }
}

function stopAll() {
  if (!state.running) return;
  state.running = false;
  state.stopped_at = Date.now();
  for (const w of state.workers) {
    try { w.stop(); } catch {}
  }
}

function countAllBots() {
  let total = 0;
  for (const w of state.workers) {
    try {
      if (existsSync(w.dbPath)) {
        const db = new Database(w.dbPath, { readonly: true, fileMustExist: true });
        try {
          const row = db.prepare("SELECT COUNT(*) AS c FROM bot").get();
          total += row?.c ?? 0;
        } catch {
          // schema not yet there
        }
        db.close();
      }
    } catch {
      // file mid-write - skip and pick up next tick
    }
  }
  return total;
}

function totalDbBytes() {
  let bytes = 0;
  for (const w of state.workers) {
    try {
      if (existsSync(w.dbPath)) bytes += statSync(w.dbPath).size;
    } catch {}
  }
  return bytes;
}

// ---------- CPU sampling ----------
// Host CPU: read /host-proc/stat first line, compute delta from previous sample.
let hostPrev = null;
let hostPct = 0;

function sampleHostCpu() {
  try {
    const line = readFileSync(HOST_PROC_STAT, "utf8").split("\n", 1)[0]; // "cpu  u n s i iow irq sirq steal guest gnice"
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (parts[3] || 0) + (parts[4] || 0); // idle + iowait
    const total = parts.reduce((a, b) => a + b, 0);
    if (hostPrev) {
      const dTotal = total - hostPrev.total;
      const dIdle = idle - hostPrev.idle;
      hostPct = dTotal > 0 ? Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)) : hostPct;
    }
    hostPrev = { total, idle };
  } catch {
    hostPct = -1; // signal "unknown"
  }
}

let hostLoad = [0, 0, 0];
function sampleHostLoad() {
  try {
    const txt = readFileSync(HOST_PROC_LOADAVG, "utf8");
    const parts = txt.trim().split(/\s+/).slice(0, 3).map(Number);
    if (parts.every((n) => Number.isFinite(n))) hostLoad = parts;
  } catch {}
}

// Container worker CPU: sum utime+stime jiffies of all live worker pids
// across a sample window, divide by elapsed wall clock and host cores.
let workersPrev = null;
let workersPct = 0;

function sampleWorkersCpu() {
  try {
    let ticks = 0;
    let pids = 0;
    for (const w of state.workers) {
      const proc = w.proc;
      if (!proc || proc.killed || proc.exitCode != null) continue;
      const pid = proc.pid;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        // Field 14 = utime, 15 = stime. comm field can contain spaces; split by last ')'.
        const after = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
        // after[0] = state. utime is field 14 overall = after[11]; stime = after[12].
        const utime = Number(after[11]);
        const stime = Number(after[12]);
        if (Number.isFinite(utime) && Number.isFinite(stime)) {
          ticks += utime + stime;
          pids += 1;
        }
      } catch {}
    }
    const now = Date.now();
    if (workersPrev && now > workersPrev.ts) {
      const dTicks = ticks - workersPrev.ticks;
      const dSec = (now - workersPrev.ts) / 1000;
      const cpuSec = dTicks / CLK_TCK;
      workersPct = dSec > 0 ? Math.max(0, (cpuSec / dSec / TOTAL_HOST_CORES) * 100) : workersPct;
    }
    workersPrev = { ts: now, ticks, pids };
  } catch {
    workersPct = -1;
  }
}

setInterval(() => {
  sampleHostCpu();
  sampleHostLoad();
  sampleWorkersCpu();
}, 1000).unref();

// ---------- Aggregate-leaderboard publish ----------
// Same endpoint the browser swarm POSTs to. Keyed by sha256(api_key)
// so multiple sources (browser + this container) under the same
// operator key roll into one /profile/<id>/swarm page.
const publishState = {
  enabled: !!OPERATOR_API_KEY,
  endpoint: OPERATOR_API_KEY ? `${CENTRAL_URL}/v1/swarms/${OPERATOR_ID}/summary` : null,
  last_status: null,           // null | "ok" | "skipped" | "error"
  last_status_at: null,
  last_total_published: 0,
  publishes_attempted: 0,
  publishes_succeeded: 0,
  last_error_msg: null,
};

async function publishOnce() {
  if (!publishState.enabled) {
    publishState.last_status = "skipped";
    publishState.last_status_at = Date.now();
    return;
  }
  const total = state.total_bots_cached || countAllBots();
  const now = Date.now();
  const delta = total - publishState.last_total_published;
  const lastAt = publishState.last_status_at || 0;
  const sinceLast = lastAt > 0 ? now - lastAt : Number.POSITIVE_INFINITY;

  // Volume-or-time gate, per Tim's spec: fire when EITHER condition
  // is met (whichever comes first), but never closer together than
  // PUBLISH_MIN_INTERVAL_MS so a burst can't hammer the central.
  const volumeOk = delta >= PUBLISH_EVERY_BOTS;
  const timeoutOk = sinceLast >= PUBLISH_MAX_INTERVAL_MS;
  const floorOk = sinceLast >= PUBLISH_MIN_INTERVAL_MS;

  if (delta <= 0) {
    publishState.last_status = "skipped";
    publishState.last_status_at = now;
    return;
  }
  if (!floorOk) {
    return; // tick again on the next poll
  }
  if (!volumeOk && !timeoutOk) {
    // Not enough new bots AND not enough time elapsed: hold.
    return;
  }
  publishState.publishes_attempted += 1;
  const payload = {
    total_bots: total,
    // Pre-kickoff stub: every match still has all bots alive. Once
    // matches resolve, a scoring pass should fill this in for real.
    bots_alive_after_match_n: [],
    best_bot_score: 0,
    top_k: [],
    // The merkle root would normally come from the bot-node `commit`
    // pipeline; for the aggregate surface a constant-per-batch hash
    // is acceptable. Hashing (operator_id || total) is cheap and
    // deterministic so the server can dedupe identical re-POSTs.
    merkle_root: createHash("sha256")
      .update(`${OPERATOR_ID}::${total}::${FIRST_KICKOFF_AT}`)
      .digest("hex"),
    kickoff_at: FIRST_KICKOFF_AT,
    generated_at: Date.now(),
  };
  try {
    const res = await fetch(publishState.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${OPERATOR_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      publishState.last_status = "error";
      publishState.last_status_at = Date.now();
      publishState.last_error_msg = `${res.status} ${body.slice(0, 200)}`;
      return;
    }
    publishState.last_status = "ok";
    publishState.last_status_at = Date.now();
    publishState.last_total_published = total;
    publishState.publishes_succeeded += 1;
    publishState.last_error_msg = null;
  } catch (err) {
    publishState.last_status = "error";
    publishState.last_status_at = Date.now();
    publishState.last_error_msg = String(err?.message || err).slice(0, 200);
  }
}

if (publishState.enabled) {
  // Poll on the minimum-interval cadence; publishOnce decides whether
  // the volume or time-ceiling gate is met. PUBLISH_INTERVAL_MS is
  // kept as a legacy alias for any operator who has it set explicitly.
  const pollMs = Math.min(PUBLISH_MIN_INTERVAL_MS, PUBLISH_INTERVAL_MS);
  setInterval(() => {
    void publishOnce();
  }, pollMs).unref();
}

// ---------- Stats aggregation ----------
function aggregateStats() {
  // Cache the SELECT COUNT(*) for 500ms since a 1Hz poll opens 48 DBs.
  const now = Date.now();
  if (now - state.total_bots_cached_at > 500) {
    state.total_bots_cached = countAllBots();
    state.total_bots_cached_at = now;
    state.rate_window.push({ ts: now, total: state.total_bots_cached });
    while (state.rate_window.length > 12 && now - state.rate_window[0].ts > 10_000) {
      state.rate_window.shift();
    }
  }
  const totalBots = state.total_bots_cached;

  const alive = state.workers.slice(0, state.desired_workers).filter((w) => w.alive).length;
  const batches = state.workers.reduce((sum, w) => sum + w.batches, 0);

  const elapsedMs = state.started_at ? (state.stopped_at ?? now) - state.started_at : 0;
  const sessionBots = Math.max(totalBots - state.bots_at_start, 0);
  const avgRate = elapsedMs > 0 ? sessionBots / (elapsedMs / 1000) : 0;

  // Rolling window rate: oldest-to-newest in last ~5s
  let liveRate = 0;
  if (state.rate_window.length >= 2) {
    const first = state.rate_window[0];
    const last = state.rate_window[state.rate_window.length - 1];
    const dT = (last.ts - first.ts) / 1000;
    liveRate = dT > 0 ? Math.max(0, (last.total - first.total) / dT) : 0;
  }

  const remaining = Math.max(TARGET - totalBots, 0);
  const etaSec = liveRate > 0 ? remaining / liveRate : null;

  return {
    running: state.running,
    started_at: state.started_at,
    stopped_at: state.stopped_at,
    elapsed_seconds: Math.floor(elapsedMs / 1000),
    desired_workers: state.desired_workers,
    max_workers: MAX_WORKERS,
    workers_spawned: state.workers.length,
    workers_alive: alive,
    batch_size: state.batch_size,
    batches_completed: batches,
    total_bots: totalBots,
    bots_this_session: sessionBots,
    target_bots: TARGET,
    progress_pct: TARGET > 0 ? (totalBots / TARGET) * 100 : 0,
    bots_per_sec_live: Math.round(liveRate),
    bots_per_sec_avg: Math.round(avgRate),
    eta_seconds: etaSec,
    db_bytes: totalDbBytes(),
    host_cores: TOTAL_HOST_CORES,
    host_mem_bytes: totalmem(),
    host_cpu_pct: hostPct,
    host_load_1m: hostLoad[0],
    host_load_5m: hostLoad[1],
    host_load_15m: hostLoad[2],
    workers_cpu_pct_of_host: workersPct,
    node_label: NODE_LABEL,
    federation_mode: publishState.enabled
      ? `auto-publishing to ${publishState.endpoint} every ${PUBLISH_INTERVAL_MS / 1000}s`
      : "dry-run (no OPERATOR_API_KEY set; local only, never POSTs)",
    publish: {
      enabled: publishState.enabled,
      operator_id: OPERATOR_ID || null,
      endpoint: publishState.endpoint,
      last_status: publishState.last_status,
      last_status_at: publishState.last_status_at,
      last_total_published: publishState.last_total_published,
      attempts: publishState.publishes_attempted,
      succeeded: publishState.publishes_succeeded,
      last_error: publishState.last_error_msg,
    },
    recent_errors: state.errors.slice(-5),
  };
}

// ---------- HTML ----------
const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Tournamental Billion Bot - ${NODE_LABEL}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { background:#0a0a0c; color:#e5e7eb; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; margin:0; padding:24px 32px 80px; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight:600; font-size:30px; margin:0 0 4px; color:#facc15; letter-spacing:-.01em;}
  .sub { color:#9ca3af; margin-bottom:20px; font-size:12px; }
  .status-row { display:flex; gap:12px; align-items:center; margin-bottom:16px; flex-wrap: wrap; }
  .status { padding:8px 14px; border-radius:999px; font-size:12px; font-weight:600; }
  .status.running { background:#052e2b; color:#34d399; border:1px solid #065f46; }
  .status.stopped { background:#27272a; color:#9ca3af; border:1px solid #3f3f46; }
  .pulse { display:inline-block; width:8px; height:8px; border-radius:50%; background:#34d399; margin-right:6px; animation: pulse 1.4s ease-in-out infinite; vertical-align:1px; }
  .pulse.off { background:#71717a; animation:none; }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.3;} }
  .elapsed { color:#facc15; font-weight:600; font-variant-numeric: tabular-nums; }
  .ctrl { display:flex; gap:8px; flex-wrap: wrap; margin-bottom:24px; align-items:center; }
  button { background:#facc15; color:#0a0a0c; border:0; border-radius:6px; padding:9px 18px; font-weight:700; cursor:pointer; font-family:inherit; font-size:13px; }
  button.stop { background:#27272a; color:#fafafa; border:1px solid #3f3f46; }
  button.minor { background:transparent; color:#9ca3af; border:1px solid #3f3f46; font-weight:500; }
  button:disabled { opacity:.4; cursor:not-allowed; }
  .throttle { display:flex; gap:6px; align-items:center; background:#15151a; padding:6px 12px; border-radius:6px; border:1px solid #27272a; }
  .throttle label { font-size:11px; color:#9ca3af; text-transform:uppercase; letter-spacing:.06em; margin-right:6px; }
  .throttle .chip { background:#27272a; color:#fafafa; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px; user-select:none; border:1px solid transparent; }
  .throttle .chip:hover { border-color:#facc15; }
  .throttle .chip.active { background:#facc15; color:#0a0a0c; font-weight:700; }
  .throttle .input { background:#0a0a0c; color:#fafafa; border:1px solid #3f3f46; border-radius:4px; padding:4px 8px; font-family:inherit; width:70px; font-size:12px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:10px; margin-bottom:20px; }
  .card { background:#15151a; border:1px solid #27272a; border-radius:8px; padding:14px 16px; }
  .card .label { color:#9ca3af; font-size:10px; letter-spacing:.10em; text-transform:uppercase; margin-bottom:6px; }
  .card .value { font-size:22px; color:#fafafa; font-variant-numeric: tabular-nums; }
  .card .value.gold { color:#facc15; }
  .card .value.cpu-low { color:#34d399; }
  .card .value.cpu-mid { color:#facc15; }
  .card .value.cpu-high { color:#fb7185; }
  .card .sub2 { color:#71717a; font-size:11px; margin-top:4px; }
  .card .bar { height:4px; background:#27272a; border-radius:2px; margin-top:8px; overflow:hidden; }
  .card .bar > div { height:100%; background:#facc15; transition: width .4s ease; }
  .section-h { color:#71717a; font-size:11px; letter-spacing:.10em; text-transform:uppercase; margin:24px 0 8px; }
  pre { background:#0d0d10; border:1px solid #27272a; border-radius:6px; padding:12px; overflow-x:auto; font-size:11px; color:#a1a1aa; max-height:240px; }
  .err { color:#fca5a5; font-size:11px; margin-top:8px; background:#1f1115; border:1px solid #7f1d1d; border-radius:6px; padding:8px 12px; }
  .meta { color:#71717a; font-size:11px; margin-top:24px; }
  a { color:#facc15; text-decoration:none; }
</style>
</head>
<body>
  <h1>Tournamental Billion Bot</h1>
  <div class="sub">node label <strong>${NODE_LABEL}</strong> &middot; dry-run (no central POSTs) &middot; host <strong>${TOTAL_HOST_CORES} cores</strong></div>

  <div class="status-row">
    <div id="status" class="status stopped"><span class="pulse off"></span>stopped</div>
    <div>Elapsed: <span class="elapsed" id="elapsed">00:00:00</span></div>
    <div id="errCount" style="color:#fca5a5; font-size:12px;"></div>
  </div>

  <div class="ctrl">
    <button id="start">Start</button>
    <button id="stop" class="stop">Stop</button>
    <button id="refresh" class="minor">Refresh now</button>

    <div class="throttle">
      <label>Workers</label>
      <span class="chip" data-w="16">16</span>
      <span class="chip" data-w="24">24</span>
      <span class="chip" data-w="32">32</span>
      <span class="chip" data-w="48">48</span>
      <span class="chip" data-w="64">64</span>
      <span class="chip" data-w="96">96</span>
      <input class="input" id="workersInput" type="number" min="1" max="${MAX_WORKERS}" />
      <button id="setWorkers" class="minor">set</button>
    </div>

    <div class="throttle">
      <label>Batch</label>
      <span class="chip" data-b="10000">10k</span>
      <span class="chip" data-b="50000">50k</span>
      <span class="chip" data-b="100000">100k</span>
      <span class="chip" data-b="250000">250k</span>
      <span class="chip" data-b="1000000">1M</span>
    </div>
  </div>

  <div class="section-h">Throughput</div>
  <div class="grid">
    <div class="card"><div class="label">Bots committed</div><div class="value gold" id="total_bots">-</div><div class="sub2" id="total_sub"></div></div>
    <div class="card"><div class="label">Live rate (5s)</div><div class="value gold" id="rate_live">-</div><div class="sub2">bots / sec</div></div>
    <div class="card"><div class="label">Avg rate (session)</div><div class="value" id="rate_avg">-</div><div class="sub2">bots / sec</div></div>
    <div class="card"><div class="label">ETA to ${(TARGET/1e9).toFixed(0)}B</div><div class="value" id="eta">-</div></div>
    <div class="card"><div class="label">Progress</div><div class="value" id="progress">-</div><div class="bar"><div id="progress_bar" style="width:0%"></div></div></div>
    <div class="card"><div class="label">Batches done</div><div class="value" id="batches">-</div><div class="sub2" id="batches_sub"></div></div>
  </div>

  <div class="section-h">Aggregate publish</div>
  <div class="grid">
    <div class="card"><div class="label">Publish status</div><div class="value" id="pub_status">-</div><div class="sub2" id="pub_endpoint" style="word-break:break-all;"></div></div>
    <div class="card"><div class="label">Last published</div><div class="value" id="pub_total">-</div><div class="sub2" id="pub_last_at"></div></div>
    <div class="card"><div class="label">POSTs ok / attempted</div><div class="value" id="pub_ok">-</div><div class="sub2" id="pub_last_err"></div></div>
  </div>

  <div class="section-h">Capacity</div>
  <div class="grid">
    <div class="card"><div class="label">Workers alive</div><div class="value" id="workers">-</div><div class="sub2" id="workers_sub"></div></div>
    <div class="card"><div class="label">Container CPU</div><div class="value cpu-mid" id="cont_cpu">-</div><div class="sub2">% of host (sum of workers)</div><div class="bar"><div id="cont_cpu_bar" style="width:0%; background:#34d399;"></div></div></div>
    <div class="card"><div class="label">Host CPU</div><div class="value cpu-mid" id="host_cpu">-</div><div class="sub2">% across all cores</div><div class="bar"><div id="host_cpu_bar" style="width:0%; background:#fb7185;"></div></div></div>
    <div class="card"><div class="label">Host load 1m / 5m / 15m</div><div class="value" id="host_load" style="font-size:16px;">-</div><div class="sub2" id="host_load_sub"></div></div>
    <div class="card"><div class="label">DB on disk</div><div class="value" id="dbsize">-</div><div class="sub2">across all worker DBs</div></div>
    <div class="card"><div class="label">Batch size</div><div class="value" id="batchsize_card">-</div><div class="sub2">bots per worker per batch</div></div>
  </div>

  <div id="errBox"></div>

  <details>
    <summary style="cursor:pointer; color:#9ca3af; font-size:11px; margin-top:24px;">Raw stats JSON</summary>
    <pre id="raw">loading...</pre>
  </details>

  <div class="meta">
    JSON: <a href="/api/stats">/api/stats</a> &middot;
    Configure: <code>POST /api/configure {workers, batch_size}</code> &middot;
    Federation: dry-run only. Picks stay in this container.
  </div>

<script>
function fmt(n) { return n == null ? "-" : Number(n).toLocaleString(); }
function fmtBytes(b) {
  if (!b) return "-";
  const u = ["B","KB","MB","GB","TB"]; let i = 0;
  while (b >= 1024 && i < u.length-1) { b /= 1024; i++; }
  return b.toFixed(1) + " " + u[i];
}
function fmtEta(sec) {
  if (sec == null || !isFinite(sec) || sec <= 0) return "-";
  if (sec < 60) return Math.round(sec) + "s";
  if (sec < 3600) return (sec/60).toFixed(1) + "m";
  if (sec < 86400) return (sec/3600).toFixed(2) + "h";
  return (sec/86400).toFixed(1) + "d";
}
function fmtElapsed(sec) {
  if (!sec || sec < 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
}
function cpuClass(pct) {
  if (pct == null || pct < 0) return "";
  if (pct < 40) return "cpu-low";
  if (pct < 75) return "cpu-mid";
  return "cpu-high";
}

let lastTotal = 0;
let lastSeenAt = 0;
async function refresh() {
  try {
    const r = await fetch("/api/stats");
    const s = await r.json();

    const statusEl = document.getElementById("status");
    statusEl.className = "status " + (s.running ? "running" : "stopped");
    statusEl.innerHTML = '<span class="pulse ' + (s.running ? "" : "off") + '"></span>' + (s.running ? "running" : "stopped");

    document.getElementById("elapsed").textContent = fmtElapsed(s.elapsed_seconds);
    document.getElementById("total_bots").textContent = fmt(s.total_bots);
    document.getElementById("total_sub").textContent = s.bots_this_session ? "+" + fmt(s.bots_this_session) + " this session" : "";
    document.getElementById("rate_live").textContent = fmt(s.bots_per_sec_live);
    document.getElementById("rate_avg").textContent = fmt(s.bots_per_sec_avg);
    document.getElementById("eta").textContent = fmtEta(s.eta_seconds);

    const pct = (s.progress_pct ?? 0);
    document.getElementById("progress").textContent = pct.toFixed(4) + "%";
    document.getElementById("progress_bar").style.width = Math.min(100, pct) + "%";

    document.getElementById("batches").textContent = fmt(s.batches_completed);
    document.getElementById("batches_sub").textContent = "size " + fmt(s.batch_size);

    document.getElementById("workers").textContent = s.workers_alive + " / " + s.desired_workers;
    document.getElementById("workers_sub").textContent = "spawned " + s.workers_spawned + " &middot; max " + s.max_workers;
    document.getElementById("workers_sub").innerHTML = "spawned " + s.workers_spawned + " &middot; max " + s.max_workers;

    const cont = s.workers_cpu_pct_of_host;
    const contEl = document.getElementById("cont_cpu");
    contEl.textContent = cont == null || cont < 0 ? "-" : cont.toFixed(1) + "%";
    contEl.className = "value " + cpuClass(cont);
    document.getElementById("cont_cpu_bar").style.width = Math.min(100, cont >= 0 ? cont : 0) + "%";

    const hcpu = s.host_cpu_pct;
    const hEl = document.getElementById("host_cpu");
    hEl.textContent = hcpu == null || hcpu < 0 ? "-" : hcpu.toFixed(1) + "%";
    hEl.className = "value " + cpuClass(hcpu);
    document.getElementById("host_cpu_bar").style.width = Math.min(100, hcpu >= 0 ? hcpu : 0) + "%";

    document.getElementById("host_load").textContent =
      s.host_load_1m.toFixed(2) + " / " + s.host_load_5m.toFixed(2) + " / " + s.host_load_15m.toFixed(2);
    document.getElementById("host_load_sub").textContent = "saturation > " + s.host_cores + " = oversubscribed";

    document.getElementById("dbsize").textContent = fmtBytes(s.db_bytes);
    document.getElementById("batchsize_card").textContent = fmt(s.batch_size);

    // Publish card.
    const p = s.publish || {};
    const pStatusEl = document.getElementById("pub_status");
    if (!p.enabled) {
      pStatusEl.textContent = "OFF";
      pStatusEl.className = "value";
      document.getElementById("pub_endpoint").textContent = "no OPERATOR_API_KEY set";
    } else {
      const stateMap = { ok: ["LIVE", "cpu-low"], skipped: ["idle", ""], error: ["ERROR", "cpu-high"] };
      const [label, cls] = stateMap[p.last_status] || ["pending", ""];
      pStatusEl.textContent = label;
      pStatusEl.className = "value " + cls;
      document.getElementById("pub_endpoint").textContent = (p.endpoint || "").replace(/^https?:\/\//, "");
    }
    document.getElementById("pub_total").textContent = fmt(p.last_total_published || 0);
    document.getElementById("pub_last_at").textContent =
      p.last_status_at ? new Date(p.last_status_at).toLocaleTimeString() : "-";
    document.getElementById("pub_ok").textContent = (p.succeeded || 0) + " / " + (p.attempts || 0);
    document.getElementById("pub_last_err").textContent = p.last_error ? "err: " + p.last_error : "";

    // Active chip highlighting
    document.querySelectorAll(".chip[data-w]").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.w) === s.desired_workers);
    });
    document.querySelectorAll(".chip[data-b]").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.b) === s.batch_size);
    });
    document.getElementById("workersInput").placeholder = s.desired_workers;

    const errBox = document.getElementById("errBox");
    if (s.recent_errors && s.recent_errors.length) {
      errBox.innerHTML = s.recent_errors.map(e =>
        '<div class="err">worker ' + e.worker + ' exit ' + e.code + ': ' + (e.msg || "") + '</div>'
      ).join("");
      document.getElementById("errCount").textContent = s.recent_errors.length + " recent worker error(s)";
    } else {
      errBox.innerHTML = "";
      document.getElementById("errCount").textContent = "";
    }

    document.getElementById("raw").textContent = JSON.stringify(s, null, 2);
  } catch (e) {
    document.getElementById("raw").textContent = "fetch error: " + e.message;
  }
}

async function postJSON(url, body) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}

document.getElementById("start").onclick = async () => { await postJSON("/api/start"); refresh(); };
document.getElementById("stop").onclick = async () => { await postJSON("/api/stop"); refresh(); };
document.getElementById("refresh").onclick = refresh;

document.querySelectorAll(".chip[data-w]").forEach((el) => {
  el.onclick = async () => { await postJSON("/api/configure", { workers: Number(el.dataset.w) }); refresh(); };
});
document.querySelectorAll(".chip[data-b]").forEach((el) => {
  el.onclick = async () => { await postJSON("/api/configure", { batch_size: Number(el.dataset.b) }); refresh(); };
});
document.getElementById("setWorkers").onclick = async () => {
  const v = Number(document.getElementById("workersInput").value);
  if (v > 0) { await postJSON("/api/configure", { workers: v }); refresh(); }
};

refresh();
setInterval(refresh, 1500);
</script>
</body>
</html>`;

// ---------- HTTP server ----------
const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }
  if (req.method === "GET" && req.url === "/api/stats") {
    const s = aggregateStats();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(s, null, 2));
    return;
  }
  if (req.method === "POST" && req.url === "/api/start") {
    startAll();
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ started: true, workers: state.desired_workers }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/stop") {
    stopAll();
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ stopped: true }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/configure") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let cfg = {};
      try { cfg = body ? JSON.parse(body) : {}; } catch {}
      if (typeof cfg.workers === "number" && cfg.workers > 0) {
        state.desired_workers = Math.min(Math.max(1, Math.floor(cfg.workers)), MAX_WORKERS);
        ensureWorkerCount();
      }
      if (typeof cfg.batch_size === "number" && cfg.batch_size > 0) {
        state.batch_size = Math.max(1, Math.floor(cfg.batch_size));
      }
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({
        desired_workers: state.desired_workers,
        batch_size: state.batch_size,
      }));
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `billion-bot dashboard up on http://${HOST}:${PORT} - workers=${INITIAL_WORKERS} (max ${MAX_WORKERS}) batch=${INITIAL_BATCH} target=${TARGET} cores=${TOTAL_HOST_CORES}\n`,
  );
});

function shutdown() {
  stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
