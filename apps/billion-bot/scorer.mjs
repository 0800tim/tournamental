// Perfect-bracket scorer for the billion-bot swarm.
//
// v0.3.0 bots are regenerate-on-demand: nothing per-bot is stored, only
// (run_seed, strategy, total_bots) per swarm. To find how many bots still
// have a perfect bracket we regenerate each bot's pick for every settled
// match and count those correct on ALL of them. The regenerator is pure
// (sha256 + the chalk strategy), so scoring needs the swarm DBs only to
// enumerate seeds read-only; the heavy loop never touches SQLite.
//
// Work is fanned out across worker threads (score-worker.mjs). Each bot
// early-exits at its first wrong pick, so with matches ordered
// chronologically the average cost is ~2 regenerations/bot even though
// there are 40+ settled matches. The full 1.5B fleet scores in ~2h on
// ~20 threads; the result is cached so the dashboard reads it instantly.
//
// Tim 2026-06-23.

import { readFileSync, readdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Normalise a match-results payload into { wc2026-mNNN: outcome }. The
 *  game DB keys results by bare match number ("1"); fixtures + bot-node
 *  use the "wc2026-m001" form. Accept either. */
export function mapResultsToOutcomes(results) {
  const out = {};
  for (const r of results || []) {
    if (!r || !r.outcome) continue;
    const id = String(r.match_id);
    const key = /^wc2026-m\d+$/.test(id)
      ? id
      : `wc2026-m${id.padStart(3, "0")}`;
    out[key] = r.outcome;
  }
  return out;
}

export async function fetchResults(resultsUrl) {
  const res = await fetch(resultsUrl, {
    headers: { "user-agent": "billion-bot-scorer" },
  });
  if (!res.ok) throw new Error(`results fetch HTTP ${res.status}`);
  const j = await res.json();
  return Array.isArray(j.results) ? j.results : [];
}

export function loadFixtures(fixturesPath) {
  const arr = JSON.parse(readFileSync(fixturesPath, "utf8"));
  const byId = {};
  for (const m of arr) byId[m.match_id] = m;
  return byId;
}

/** Settled matches in chronological (kickoff) order. A match counts only
 *  when we have both a recorded outcome and its fixture (for the odds the
 *  chalk strategy needs to reproduce picks). */
export function buildSettled(outcomes, byId) {
  return Object.keys(outcomes)
    .filter((id) => byId[id])
    .map((id) => ({ match: byId[id], outcome: outcomes[id] }))
    .sort((a, b) => (a.match.kickoff_utc < b.match.kickoff_utc ? -1 : 1));
}

/** Read every worker DB once (read-only) and collect [run_seed, total_bots]
 *  for every chalk-v1 swarm. This is the only DB access scoring performs. */
export function enumerateSwarms(dataDir) {
  const files = readdirSync(dataDir)
    .filter((f) => /^worker-\d+\.db$/.test(f))
    .sort();
  const swarms = [];
  let total = 0;
  for (const f of files) {
    let db;
    try {
      db = new Database(join(dataDir, f), {
        readonly: true,
        fileMustExist: true,
      });
      const rows = db
        .prepare(
          "SELECT run_seed, total_bots FROM swarm_run WHERE strategy='chalk-v1'",
        )
        .all();
      for (const r of rows) {
        swarms.push([r.run_seed, r.total_bots]);
        total += r.total_bots;
      }
    } catch {
      // DB mid-write or schema not present yet -- skip, pick up next run.
    } finally {
      if (db) db.close();
    }
  }
  return { swarms, total };
}

/** Greedy largest-first packing into `n` buckets balanced by bot count. */
function shardSwarms(swarms, n) {
  const sorted = [...swarms].sort((a, b) => b[1] - a[1]);
  const buckets = Array.from({ length: n }, () => ({ bots: 0, list: [] }));
  for (const s of sorted) {
    buckets.sort((a, b) => a.bots - b.bots);
    buckets[0].list.push(s);
    buckets[0].bots += s[1];
  }
  return buckets.map((b) => b.list).filter((l) => l.length);
}

/**
 * Score the whole fleet. Returns:
 *   { total, settled, perfect, curve:[{k,match_id,home,away,outcome,survivors}],
 *     scored_at, elapsed_ms }
 * `onProgress(done, total)` fires as bots are processed.
 */
export async function runScoring(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || "/app/data";
  const fixturesPath =
    opts.fixturesPath ||
    process.env.TOURNAMENTAL_MATCHES ||
    join(dataDir, "..", "fifa-wc-2026-fixtures.json");
  const resultsUrl =
    opts.resultsUrl ||
    process.env.RESULTS_URL ||
    "https://play.tournamental.com/api/v1/match-results/fifa-wc-2026";
  const nWorkers = Math.max(
    1,
    opts.workers ||
      Number(process.env.SCORE_WORKERS) ||
      Math.max(1, Math.min(24, cpus().length - 4)),
  );
  const onProgress = opts.onProgress || (() => {});

  const t0 = Date.now();
  const rawResults = opts.results || (await fetchResults(resultsUrl));
  const outcomes = mapResultsToOutcomes(rawResults);
  const byId = loadFixtures(fixturesPath);
  const settled = buildSettled(outcomes, byId);
  const K = settled.length;
  if (K === 0) {
    return {
      total: 0,
      settled: 0,
      perfect: 0,
      curve: [],
      scored_at: Date.now(),
      elapsed_ms: Date.now() - t0,
    };
  }

  let { swarms, total } = enumerateSwarms(dataDir);
  if (opts.sampleSwarms) swarms = swarms.slice(0, opts.sampleSwarms);
  total = swarms.reduce((s, x) => s + x[1], 0);

  const shards = shardSwarms(swarms, Math.min(nWorkers, swarms.length || 1));
  // hist[w] = #bots whose first wrong pick (chronological, 1-based) is match
  // w; hist[K+1] = survived all K matches.
  const hist = new Array(K + 2).fill(0);
  const progressByWorker = new Array(shards.length).fill(0);

  await Promise.all(
    shards.map(
      (list, idx) =>
        new Promise((resolve, reject) => {
          const w = new Worker(join(__dirname, "score-worker.mjs"), {
            workerData: { swarms: list, settled },
          });
          w.on("message", (m) => {
            if (m.type === "progress") {
              progressByWorker[idx] = m.done;
              onProgress(
                progressByWorker.reduce((a, b) => a + b, 0),
                total,
              );
            } else if (m.type === "done") {
              for (let i = 0; i < m.hist.length; i++) hist[i] += m.hist[i];
              progressByWorker[idx] = m.total;
              onProgress(
                progressByWorker.reduce((a, b) => a + b, 0),
                total,
              );
            }
          });
          w.on("error", reject);
          w.on("exit", (code) =>
            code === 0 ? resolve() : reject(new Error(`worker exit ${code}`)),
          );
        }),
    ),
  );

  // survivors_after_k = total - sum(hist[1..k])
  let cum = 0;
  const curve = [];
  for (let k = 1; k <= K; k++) {
    cum += hist[k];
    const s = settled[k - 1];
    curve.push({
      k,
      match_id: s.match.match_id,
      home: s.match.home_team,
      away: s.match.away_team,
      outcome: s.outcome,
      survivors: total - cum,
    });
  }

  return {
    total,
    settled: K,
    perfect: hist[K + 1],
    curve,
    scored_at: Date.now(),
    elapsed_ms: Date.now() - t0,
  };
}

// Standalone runner for testing:  node scorer.mjs [--sample=20] [--workers=4]
if (process.argv[1] && process.argv[1].endsWith("scorer.mjs")) {
  const arg = (k, d) => {
    const m = process.argv.find((a) => a.startsWith(`--${k}=`));
    return m ? m.split("=")[1] : d;
  };
  const sample = Number(arg("sample", 0)) || undefined;
  const workers = Number(arg("workers", 0)) || undefined;
  runScoring({
    sampleSwarms: sample,
    workers,
    onProgress: (d, t) =>
      process.stderr.write(`\r${d.toLocaleString()} / ${t.toLocaleString()}`),
  })
    .then((r) => {
      process.stderr.write("\n");
      console.log(JSON.stringify(r, null, 1));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
