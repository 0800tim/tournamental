"use client";

/**
 * BrowserSwarm, the interactive swarm UI for /run.
 *
 * One page, four sections, one CTA:
 *   1. Optional Supabase config (URL + anon key, OR skip).
 *   2. Optional LLM API key paste (Anthropic or OpenAI, OR skip).
 *   3. Bot-count slider (100 to 1,000,000) + strategy picker.
 *   4. "Start swarm" + live progress + live stats.
 *
 * The heavy lifting runs in dedicated Web Workers; the React component
 * stays on the main thread and only marshalls config + progress. We
 * spawn `navigator.hardwareConcurrency` workers and shard the bot
 * range across them. Each worker sends throttled progress messages
 * back at ~4Hz.
 *
 * Federation:
 *   - On first run we register a `browser` node (creds persisted to
 *     IndexedDB).
 *   - After all workers report `slice_done` for a match we combine
 *     their per-slice merkle roots into one root and POST to
 *     /v1/nodes/commit. (The combined merkle is sorted-pair sha256
 *     across worker roots, same shape as everything else, so a
 *     verifier can reconstruct it from worker slices.)
 *   - Best-bot leaderboard fires after the post-match scoring path,
 *     which is a follow-up wire-up after the renderer ships.
 *
 * Storage:
 *   - IndexedDB always.
 *   - Supabase mirror if the user configured it.
 *
 * Performance budget:
 *   - 100,000 bots * 104 matches = 10.4M decisions, target < 30s on a
 *     mid-range laptop.
 *   - The chalk decide() is ~12 ns/call in V8 once warm, so 10.4M
 *     decisions cost ~125ms of pure compute. The rest of the budget
 *     goes to merkle hashing and the main-thread marshalling.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { FederationClient } from "./federation";
import { merkleRoot } from "./merkle";
import {
  defaultPersistence,
  type Persistence,
} from "./persistence";
import {
  probeSupabase,
  SUPABASE_SCHEMA_SQL,
  supabasePersistence,
} from "./supabase";
import type {
  BotPick,
  BotRecord,
  CommitLogRow,
  MatchSpec,
  NodeCredentials,
  StrategyName,
  SupabaseConfig,
  SwarmProgress,
  SwarmStats,
} from "./types";

const PHASE_LABEL: Record<SwarmProgress["phase"], string> = {
  idle: "Idle",
  preparing: "Preparing workers",
  generating: "Generating bots",
  committing: "Building merkle roots",
  federating: "Publishing to federation",
  done: "Done",
  error: "Error",
};

interface SliceDonePayload {
  kind: "slice_done";
  worker_index: number;
  run_id: string;
  merkle_roots_by_match: Record<string, string>;
  best_bot_score: number;
  bots_generated: number;
  picks_made: number;
  elapsed_ms: number;
  sample_bots: BotRecord[];
  sample_picks: BotPick[];
}

interface ProgressPayload {
  kind: "progress";
  worker_index: number;
  bots_generated: number;
  picks_made: number;
  current_match_id: string | null;
}

interface ErrorPayload {
  kind: "error";
  worker_index: number;
  message: string;
}

type WorkerMessage = SliceDonePayload | ProgressPayload | ErrorPayload;

/**
 * A small synthetic World Cup 2026 group-stage fixture set used as the
 * demo data when the user hits "Start swarm" before the real fixtures
 * are wired into the run page. The real flow will feed
 * `defaultMatches` from `apps/web/lib/match-stats.ts` once that exposes
 * the full 104-match list. For the WIRED-demo screenshot we just want
 * the worker spinning on something realistic.
 */
function buildDemoMatches(): MatchSpec[] {
  const teams = [
    "argentina",
    "france",
    "brazil",
    "england",
    "germany",
    "spain",
    "portugal",
    "netherlands",
    "uruguay",
    "croatia",
    "morocco",
    "japan",
  ];
  const matches: MatchSpec[] = [];
  let count = 0;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      count++;
      matches.push({
        match_id: `wc26-demo-${count.toString().padStart(3, "0")}`,
        tournament_id: "fifa-wc-2026",
        home_team: teams[i]!,
        away_team: teams[j]!,
        kickoff_utc: new Date(Date.now() + count * 3_600_000).toISOString(),
        allows_draw: count <= 36,
        odds: {
          home_win: 0.45 - ((count * 0.013) % 0.2),
          draw: 0.25,
          away_win: 0.3 + ((count * 0.011) % 0.2),
        },
      });
      if (matches.length >= 64) return matches;
    }
  }
  return matches;
}

const INITIAL_PROGRESS: SwarmProgress = {
  phase: "idle",
  bots_generated: 0,
  picks_made: 0,
  current_match_id: null,
  merkle_roots_built: 0,
  errors: [],
  throughput: 0,
  started_at: null,
};

const INITIAL_STATS: SwarmStats = {
  best_bot_score: 0,
  bots_still_perfect: 0,
  merkle_root: null,
  federation_rank: null,
};

const CORES_FALLBACK = 4;

function workerCount(): number {
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return Math.max(1, Math.min(16, navigator.hardwareConcurrency));
  }
  return CORES_FALLBACK;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-NZ").format(Math.round(n));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m ${rest}s`;
}

export interface BrowserSwarmProps {
  /** Optional override; defaults to the synthetic demo fixtures above. */
  readonly matches?: readonly MatchSpec[];
  /** When true, never hit the network for federation. Used by the
   *  `?dry=1` query-string for the smoke test in the done-criteria. */
  readonly dryRun?: boolean;
}

export default function BrowserSwarm({
  matches,
  dryRun = false,
}: BrowserSwarmProps): JSX.Element {
  const demoMatches = useMemo(() => matches ?? buildDemoMatches(), [matches]);

  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseKey, setSupabaseKey] = useState("");
  const [supabaseStatus, setSupabaseStatus] = useState<
    "untested" | "ok" | "error" | "checking"
  >("untested");

  const [apiVendor, setApiVendor] = useState<"none" | "anthropic" | "openai">(
    "none",
  );
  const [apiKey, setApiKey] = useState("");

  const [botCount, setBotCount] = useState(10_000);
  const [strategy, setStrategy] = useState<StrategyName>("chalk-v1");

  const [progress, setProgress] = useState<SwarmProgress>(INITIAL_PROGRESS);
  const [stats, setStats] = useState<SwarmStats>(INITIAL_STATS);
  const [credentials, setCredentials] = useState<NodeCredentials | null>(null);

  // Tim 2026-06-07: persistent cumulative swarm cursor. Each press of
  // Start ADDS botCount bots starting from next_bot_index, then writes
  // back so the next press continues. Survives tab close + reopen via
  // the IndexedDB swarm_state object store.
  const [swarmTotal, setSwarmTotal] = useState<number>(0);
  const [batchesCommitted, setBatchesCommitted] = useState<number>(0);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const nextBotIndexRef = useRef<number>(0);

  const persistenceRef = useRef<Persistence>(defaultPersistence());
  const workersRef = useRef<Worker[]>([]);
  const runIdRef = useRef<string>("");
  const throughputSamplesRef = useRef<Array<{ t: number; bots: number }>>([]);
  const workerProgressRef = useRef<number[]>([]);
  const sliceResultsRef = useRef<SliceDonePayload[]>([]);

  // Load cached credentials on first mount.
  useEffect(() => {
    let cancelled = false;
    persistenceRef.current
      .loadCredentials()
      .then((c) => {
        if (!cancelled && c) setCredentials(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Tim 2026-06-07: load the persistent swarm cursor on mount so each
  // press of Start picks up where the last one left off (across tab
  // close + reopen).
  useEffect(() => {
    let cancelled = false;
    persistenceRef.current
      .loadSwarmState()
      .then((s) => {
        if (cancelled) return;
        nextBotIndexRef.current = s.next_bot_index;
        setSwarmTotal(s.total_bots_generated);
        setBatchesCommitted(s.batches_committed);
        setLastRunAt(s.last_run_at_utc);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Tidy up any live workers when the component unmounts.
  useEffect(() => {
    return () => {
      for (const w of workersRef.current) w.terminate();
      workersRef.current = [];
    };
  }, []);

  const supabaseConfig: SupabaseConfig | undefined = useMemo(() => {
    if (!supabaseUrl.trim() || !supabaseKey.trim()) return undefined;
    return { url: supabaseUrl.trim(), anon_key: supabaseKey.trim() };
  }, [supabaseUrl, supabaseKey]);

  const onTestSupabase = useCallback(async () => {
    if (!supabaseConfig) return;
    setSupabaseStatus("checking");
    const ok = await probeSupabase(supabaseConfig);
    setSupabaseStatus(ok ? "ok" : "error");
  }, [supabaseConfig]);

  const onCopySql = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
    } catch {
      // No-op; the textarea is still selectable.
    }
  }, []);

  const onStart = useCallback(async () => {
    if (progress.phase === "generating" || progress.phase === "committing") return;

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    runIdRef.current = runId;
    sliceResultsRef.current = [];
    throughputSamplesRef.current = [];

    setProgress({
      ...INITIAL_PROGRESS,
      phase: "preparing",
      started_at: Date.now(),
    });
    setStats(INITIAL_STATS);

    // Register / re-use credentials.
    const fed = new FederationClient({ dry_run: dryRun });
    let creds = credentials;
    if (!creds) {
      const reg = await fed.register(null);
      if (reg.credentials) {
        creds = reg.credentials;
        setCredentials(reg.credentials);
        await persistenceRef.current.saveCredentials(reg.credentials).catch(() => {});
      }
    }

    const cores = workerCount();
    const perWorker = Math.ceil(botCount / cores);
    workerProgressRef.current = new Array(cores).fill(0);

    setProgress((p) => ({ ...p, phase: "generating" }));

    const workers: Worker[] = [];
    const slicePromise = new Promise<void>((resolve) => {
      let finished = 0;
      const handleMessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;
        if (msg.kind === "progress") {
          workerProgressRef.current[msg.worker_index] = msg.bots_generated;
          const total = workerProgressRef.current.reduce(
            (s, x) => s + x,
            0,
          );
          const now = performance.now();
          throughputSamplesRef.current.push({ t: now, bots: total });
          // Trim to last 2s window.
          while (
            throughputSamplesRef.current.length > 1 &&
            now - throughputSamplesRef.current[0]!.t > 2000
          ) {
            throughputSamplesRef.current.shift();
          }
          const samples = throughputSamplesRef.current;
          let throughput = 0;
          if (samples.length >= 2) {
            const first = samples[0]!;
            const last = samples[samples.length - 1]!;
            const dt = (last.t - first.t) / 1000;
            const db = last.bots - first.bots;
            throughput = dt > 0 ? db / dt : 0;
          }
          setProgress((p) => ({
            ...p,
            bots_generated: total,
            picks_made: total * demoMatches.length,
            current_match_id: msg.current_match_id,
            throughput,
          }));
        } else if (msg.kind === "slice_done") {
          sliceResultsRef.current.push(msg);
          finished++;
          if (finished === cores) resolve();
        } else if (msg.kind === "error") {
          setProgress((p) => ({
            ...p,
            errors: [...p.errors, `worker ${msg.worker_index}: ${msg.message}`],
            phase: "error",
          }));
          finished++;
          if (finished === cores) resolve();
        }
      };

      // Tim 2026-06-07: offset every worker's bot index range by
      // nextBotIndexRef.current so successive presses of Start
      // accumulate rather than overwrite. Bot 0 is the first bot the
      // user EVER generated on this device; bot N+1 is generated on
      // the next press after N.
      const offset = nextBotIndexRef.current;
      for (let i = 0; i < cores; i++) {
        const start = offset + i * perWorker;
        const end = offset + Math.min(botCount, (i + 1) * perWorker);
        if (start >= end) {
          finished++;
          continue;
        }
        // The `new URL(..., import.meta.url)` form is the Next/webpack
        // idiom that picks up the worker file at build time without
        // additional config.
        const w = new Worker(new URL("./worker.ts", import.meta.url), {
          type: "module",
        });
        w.onmessage = handleMessage;
        w.onerror = (err) => {
          setProgress((p) => ({
            ...p,
            errors: [...p.errors, err.message || "worker error"],
          }));
        };
        workers.push(w);
        w.postMessage({
          kind: "generate",
          worker_index: i,
          bot_start: start,
          bot_end: end,
          run_id: runId,
          strategy,
          matches: demoMatches,
        });
      }
      if (finished === cores) resolve();
    });

    workersRef.current = workers;
    await slicePromise;
    for (const w of workers) w.terminate();
    workersRef.current = [];

    // Combine per-worker, per-match roots into a single root per match
    // (sorted-pair sha256, same shape as everywhere else).
    setProgress((p) => ({ ...p, phase: "committing" }));

    const allSlices = sliceResultsRef.current;
    const totalBots = allSlices.reduce((s, r) => s + r.bots_generated, 0);
    const totalPicks = allSlices.reduce((s, r) => s + r.picks_made, 0);
    const bestScore = allSlices.reduce(
      (best, r) => Math.max(best, r.best_bot_score),
      0,
    );

    // Persist sample bots / picks.
    const sampleBots: BotRecord[] = [];
    const samplePicks: BotPick[] = [];
    for (const s of allSlices) {
      sampleBots.push(...s.sample_bots);
      samplePicks.push(...s.sample_picks);
    }
    await persistenceRef.current.saveBots(sampleBots).catch(() => {});
    await persistenceRef.current.savePicks(samplePicks).catch(() => {});
    if (supabaseConfig) {
      await supabasePersistence.saveBots(supabaseConfig, sampleBots).catch(() => {});
      await supabasePersistence
        .savePicks(supabaseConfig, samplePicks)
        .catch(() => {});
    }

    const combinedRoots: Record<string, string> = {};
    let merkleBuilt = 0;
    for (const match of demoMatches) {
      const workerRoots = allSlices
        .map((r) => r.merkle_roots_by_match[match.match_id])
        .filter((x): x is string => typeof x === "string");
      const combined = await merkleRoot(workerRoots);
      combinedRoots[match.match_id] = combined;
      merkleBuilt++;
      if (merkleBuilt % 8 === 0) {
        setProgress((p) => ({ ...p, merkle_roots_built: merkleBuilt }));
      }
    }

    setProgress((p) => ({
      ...p,
      merkle_roots_built: merkleBuilt,
      phase: "federating",
    }));

    // Pick the first match as the representative commit for the demo
    // and federate that. Real flow per-match is wired up by Agent A09.
    const firstMatch = demoMatches[0];
    let topMerkle: string | null = null;
    let federationRank: number | null = null;
    if (firstMatch && creds) {
      const root = combinedRoots[firstMatch.match_id]!;
      topMerkle = root;
      const commitRow: CommitLogRow = {
        match_id: firstMatch.match_id,
        merkle_root: root,
        bot_count: totalBots,
        kickoff_at_utc: new Date(firstMatch.kickoff_utc).getTime(),
        committed_at_utc: Date.now(),
        central_ack_at_utc: null,
      };
      const commit = await fed.commit(creds, commitRow);
      const commitAck = commit.central_ack_at_utc;
      const persisted: CommitLogRow = {
        ...commitRow,
        central_ack_at_utc: commitAck,
      };
      await persistenceRef.current.saveCommit(persisted).catch(() => {});
      if (supabaseConfig) {
        await supabasePersistence.saveCommit(supabaseConfig, persisted).catch(() => {});
      }
      const lb = await fed.leaderboard(
        creds,
        {
          best_bot_score: bestScore,
          bots_still_perfect: totalBots, // pre-match: every bot still perfect
          merkle_root: root,
          federation_rank: null,
        },
        firstMatch.match_id,
      );
      federationRank = lb.rank;
    }

    setStats({
      best_bot_score: bestScore,
      bots_still_perfect: totalBots,
      merkle_root: topMerkle,
      federation_rank: federationRank,
    });

    // Tim 2026-06-07: advance the persistent swarm cursor + bump the
    // visible cumulative total. The next press of Start picks up from
    // here.
    const newNextIndex = nextBotIndexRef.current + totalBots;
    const newTotalEverGenerated = newNextIndex; // bot 0 is the first ever generated
    const newBatchesCommitted = batchesCommitted + 1;
    const runAt = new Date().toISOString();
    nextBotIndexRef.current = newNextIndex;
    setSwarmTotal(newTotalEverGenerated);
    setBatchesCommitted(newBatchesCommitted);
    setLastRunAt(runAt);
    await persistenceRef.current
      .saveSwarmState({
        next_bot_index: newNextIndex,
        total_bots_generated: newTotalEverGenerated,
        last_run_at_utc: runAt,
        batches_committed: newBatchesCommitted,
      })
      .catch(() => {});

    setProgress((p) => ({
      ...p,
      phase: "done",
      bots_generated: totalBots,
      picks_made: totalPicks,
    }));
  }, [
    batchesCommitted,
    botCount,
    credentials,
    demoMatches,
    dryRun,
    progress.phase,
    strategy,
    supabaseConfig,
  ]);

  const onStop = useCallback(() => {
    for (const w of workersRef.current) w.terminate();
    workersRef.current = [];
    setProgress((p) => ({ ...p, phase: "idle" }));
  }, []);

  const cores = useMemo(() => workerCount(), []);
  const elapsedMs = progress.started_at ? Date.now() - progress.started_at : 0;

  return (
    <section className="vt-swarm" aria-label="Browser bot swarm console">
      <div className="vt-swarm-grid">
        <FieldsetCard
          title="1. Storage"
          subtitle="Pick where your bots live. IndexedDB is private to this browser; Supabase is shareable across devices."
        >
          <label className="vt-swarm-label" htmlFor="vt-supabase-url">
            Supabase URL <span className="vt-swarm-hint">optional</span>
          </label>
          <input
            id="vt-supabase-url"
            className="vt-swarm-input"
            placeholder="https://abcdefgh.supabase.co"
            value={supabaseUrl}
            onChange={(e) => setSupabaseUrl(e.target.value)}
          />
          <label className="vt-swarm-label" htmlFor="vt-supabase-key">
            Supabase anon key
          </label>
          <input
            id="vt-supabase-key"
            className="vt-swarm-input"
            placeholder="eyJhbGc..."
            value={supabaseKey}
            onChange={(e) => setSupabaseKey(e.target.value)}
          />
          <div className="vt-swarm-row">
            <button
              type="button"
              className="vt-swarm-button vt-swarm-button--ghost"
              disabled={!supabaseConfig || supabaseStatus === "checking"}
              onClick={onTestSupabase}
            >
              Test connection
            </button>
            <SupabaseBadge status={supabaseStatus} />
          </div>
          <details className="vt-swarm-details">
            <summary>Schema SQL (paste into Supabase SQL editor)</summary>
            <textarea
              className="vt-swarm-sql"
              readOnly
              value={SUPABASE_SCHEMA_SQL}
              rows={10}
            />
            <button
              type="button"
              className="vt-swarm-button vt-swarm-button--ghost"
              onClick={onCopySql}
            >
              Copy SQL
            </button>
          </details>
        </FieldsetCard>

        <FieldsetCard
          title="2. Strategy"
          subtitle="Chalk-weighted heuristic runs entirely in your browser at zero cost. Drop in an LLM key to elevate champion bots."
        >
          <label className="vt-swarm-label" htmlFor="vt-strategy">
            Strategy
          </label>
          <select
            id="vt-strategy"
            className="vt-swarm-input"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as StrategyName)}
          >
            <option value="chalk-v1">Chalk-weighted (default, free)</option>
            <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (your key)</option>
            <option value="gpt-4o">GPT-4o (your key)</option>
          </select>
          {strategy !== "chalk-v1" && (
            <>
              <label className="vt-swarm-label" htmlFor="vt-vendor">
                Vendor
              </label>
              <select
                id="vt-vendor"
                className="vt-swarm-input"
                value={apiVendor}
                onChange={(e) =>
                  setApiVendor(e.target.value as typeof apiVendor)
                }
              >
                <option value="none">Skip (use chalk instead)</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
              <label className="vt-swarm-label" htmlFor="vt-api-key">
                API key <span className="vt-swarm-hint">never leaves this tab</span>
              </label>
              <input
                id="vt-api-key"
                className="vt-swarm-input"
                placeholder="sk-..."
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </>
          )}
        </FieldsetCard>

        <FieldsetCard
          title="3. Swarm size"
          subtitle={`Generating across ${cores} CPU cores. Start small, scale up.`}
        >
          <label className="vt-swarm-label" htmlFor="vt-count">
            Bots: <strong>{formatNumber(botCount)}</strong>
          </label>
          <input
            id="vt-count"
            type="range"
            min={100}
            max={1_000_000}
            step={100}
            value={botCount}
            onChange={(e) => setBotCount(Number(e.target.value))}
            className="vt-swarm-slider"
          />
          <div className="vt-swarm-presets">
            {[1_000, 10_000, 100_000, 1_000_000].map((n) => (
              <button
                type="button"
                key={n}
                className="vt-swarm-chip"
                onClick={() => setBotCount(n)}
              >
                {formatNumber(n)}
              </button>
            ))}
          </div>
        </FieldsetCard>

        <FieldsetCard
          title="4. Run"
          subtitle="Workers spin up in parallel. Tab stays responsive."
        >
          <button
            type="button"
            className="vt-swarm-button vt-swarm-button--primary"
            onClick={onStart}
            disabled={
              progress.phase === "generating" ||
              progress.phase === "committing" ||
              progress.phase === "federating"
            }
          >
            {progress.phase === "idle" || progress.phase === "done"
              ? `Start swarm (${formatNumber(botCount)} bots)`
              : PHASE_LABEL[progress.phase]}
          </button>
          {progress.phase !== "idle" && progress.phase !== "done" && (
            <button
              type="button"
              className="vt-swarm-button vt-swarm-button--ghost"
              onClick={onStop}
            >
              Stop
            </button>
          )}
        </FieldsetCard>
      </div>

      <div className="vt-swarm-cumulative">
        <div className="vt-swarm-cumulative-row">
          <div>
            <p className="vt-swarm-cumulative-label">Your swarm so far</p>
            <p className="vt-swarm-cumulative-count">
              {formatNumber(swarmTotal)} <span>bots</span>
            </p>
          </div>
          <div className="vt-swarm-cumulative-meta">
            <p>
              <strong>{batchesCommitted}</strong> batches committed
              {lastRunAt && (
                <>
                  {" "}· last run {new Date(lastRunAt).toLocaleString()}
                </>
              )}
            </p>
            <p>
              Stored in <strong>IndexedDB</strong> on this device
              {supabaseConfig && supabaseStatus === "ok" && (
                <> + your Supabase project</>
              )}.
              Press <strong>Start swarm</strong> again to add more.
              Close the tab and the count persists.
            </p>
            {swarmTotal > 0 && (
              <p style={{ marginTop: 6 }}>
                <a
                  href="/run/bots"
                  style={{
                    color: "#f6c64f",
                    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
                    fontSize: 12,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  View all my bots ({formatNumber(swarmTotal)}) →
                </a>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="vt-swarm-live" aria-live="polite">
        <h2 className="vt-swarm-h2">Live (this run)</h2>
        <div className="vt-swarm-stats">
          <Stat label="Phase" value={PHASE_LABEL[progress.phase]} />
          <Stat
            label="Bots generated"
            value={formatNumber(progress.bots_generated)}
          />
          <Stat
            label="Picks made"
            value={formatNumber(progress.picks_made)}
          />
          <Stat
            label="Throughput"
            value={`${formatNumber(progress.throughput)} bots/s`}
          />
          <Stat
            label="Merkle roots"
            value={`${progress.merkle_roots_built} / ${demoMatches.length}`}
          />
          <Stat
            label="Elapsed"
            value={progress.started_at ? formatDuration(elapsedMs) : "0"}
          />
        </div>
        <ProgressBar
          fraction={
            botCount > 0 ? Math.min(1, progress.bots_generated / botCount) : 0
          }
        />
        <div className="vt-swarm-stats vt-swarm-stats--secondary">
          <Stat
            label="Best bot (chalk score)"
            value={stats.best_bot_score.toFixed(2)}
          />
          <Stat
            label="Bots still perfect"
            value={formatNumber(stats.bots_still_perfect)}
          />
          <Stat
            label="Merkle root"
            value={
              stats.merkle_root
                ? `${stats.merkle_root.slice(0, 10)}…`
                : "pending"
            }
          />
          <Stat
            label="Federation rank"
            value={
              stats.federation_rank !== null
                ? `#${stats.federation_rank}`
                : credentials
                  ? "offline"
                  : "not registered"
            }
          />
        </div>
        {progress.errors.length > 0 && (
          <ul className="vt-swarm-errors">
            {progress.errors.slice(-3).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        {credentials && (
          <p className="vt-swarm-creds">
            Node ID: <code>{credentials.node_id}</code>
          </p>
        )}
      </div>
    </section>
  );
}

function FieldsetCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <fieldset className="vt-swarm-card">
      <legend className="vt-swarm-card-legend">{title}</legend>
      <p className="vt-swarm-card-sub">{subtitle}</p>
      <div className="vt-swarm-card-body">{children}</div>
    </fieldset>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="vt-swarm-stat">
      <span className="vt-swarm-stat-label">{label}</span>
      <span className="vt-swarm-stat-value">{value}</span>
    </div>
  );
}

function ProgressBar({ fraction }: { fraction: number }): JSX.Element {
  const style: CSSProperties = { width: `${Math.round(fraction * 100)}%` };
  return (
    <div className="vt-swarm-progress" role="progressbar" aria-valuenow={Math.round(fraction * 100)}>
      <div className="vt-swarm-progress-fill" style={style} />
    </div>
  );
}

function SupabaseBadge({
  status,
}: {
  status: "untested" | "ok" | "error" | "checking";
}): JSX.Element {
  const label =
    status === "ok"
      ? "Connected"
      : status === "error"
        ? "Couldn't connect"
        : status === "checking"
          ? "Checking..."
          : "Not tested";
  return (
    <span className={`vt-swarm-badge vt-swarm-badge--${status}`}>{label}</span>
  );
}
