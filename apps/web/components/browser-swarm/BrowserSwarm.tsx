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

import { useUser } from "@/lib/auth/useUser";
import { whatsAppLoginDeepLink } from "@/lib/auth/inbound-login";

import { FederationClient } from "./federation";
import { merkleRoot } from "./merkle";
import {
  defaultPersistence,
  type Persistence,
} from "./persistence";
import {
  MASTER_SEED,
  buildDemoMatches,
  setLiveOddsByMatchId,
  type LiveOddsEntry,
} from "./regenerate";
import {
  ANCHOR_LABEL_BY_MODE,
  ANCHOR_TOURNAMENT_ID,
  ANCHOR_WEIGHT_BY_MODE,
  captureAnchorSnapshot,
  DEFAULT_ANCHOR_MODE,
  type AnchorMode,
  type AnchorSnapshot,
} from "./anchor";
import {
  probeSupabase,
  SUPABASE_SCHEMA_SQL,
  supabasePersistence,
} from "./supabase";
import type {
  BotPick,
  BotRecord,
  CommitLogRow,
  HashingSnapshot,
  MatchSpec,
  NodeCredentials,
  StrategyName,
  SupabaseConfig,
  SwarmCompletionPayload,
  SwarmProgress,
  SwarmStats,
  WorkerErrorMessage,
  WorkerHashingMessage,
  WorkerProgressMessage,
  WorkerSliceDoneMessage,
} from "./types";

const PHASE_LABEL: Record<SwarmProgress["phase"], string> = {
  idle: "Idle",
  preparing: "Preparing workers",
  generating: "Generating bots",
  hashing: "Sealing cryptographic proof",
  committing: "Combining merkle roots",
  federating: "Publishing to federation",
  done: "Done",
  error: "Error",
};

type WorkerMessage =
  | WorkerProgressMessage
  | WorkerHashingMessage
  | WorkerSliceDoneMessage
  | WorkerErrorMessage;

// Tim 2026-06-07: real WC 2026 fixtures (72 group + 32 knockout = 104
// matches) come from `./regenerate.buildDemoMatches()`. The previous
// local 12-team round-robin stub here was generating 64 fake fixtures
// and biasing every bot toward the same top-3 winners. Deleted; the
// imported version uses A1's loadFixtures2026() + FIFA-rank-derived
// odds + per-bot "darling team" variety nudge.

/**
 * Polymarket / live-odds snapshot endpoint. Game-service exposes the
 * full per-match override map at /v1/odds/snapshot; Next.js proxies it
 * at /api/v1/odds/snapshot with a 60s edge cache. The swarm fetches
 * this once on mount and again right before each onStart so a long-
 * lived tab picks up newer Polymarket signals between batches without
 * spamming the upstream.
 *
 * Cache strategy: per-tab module-scoped TTL keyed off wall-clock. The
 * server already does s-maxage=60 so the per-tab cache and the edge
 * cache work together. We intentionally don't share across tabs; a
 * fresh tab will pay one ~50ms request to warm itself.
 */
const ODDS_SNAPSHOT_URL = "/api/v1/odds/snapshot";
const ODDS_TTL_MS = 60_000;
const ODDS_FETCH_TIMEOUT_MS = 4_000;

interface OddsSnapshot {
  readonly matches: Record<string, LiveOddsEntry & { updated_at?: number }>;
  readonly generated_at: number;
  readonly source: string;
}

interface OddsCacheEntry {
  readonly snapshot: OddsSnapshot;
  readonly fetched_at: number;
}

let oddsCache: OddsCacheEntry | null = null;

/**
 * Fetch the live-odds snapshot with a short timeout and silent failure.
 * Returns null on any non-200 / parse error / timeout; the strategy
 * falls back to the FIFA-rank-derived odds baked into MatchSpec when
 * the override map is empty or undefined.
 *
 * The TTL check is cheap: returning the cached entry without a fetch
 * keeps repeated Start presses snappy. `force = true` bypasses the
 * cache (used by the mount effect when the user explicitly lands on
 * the page).
 */
async function fetchOddsSnapshot(
  force: boolean,
): Promise<OddsSnapshot | null> {
  const now = Date.now();
  if (
    !force &&
    oddsCache &&
    now - oddsCache.fetched_at < ODDS_TTL_MS
  ) {
    return oddsCache.snapshot;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ODDS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ODDS_SNAPSHOT_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as OddsSnapshot;
    if (!json || typeof json !== "object" || !json.matches) return null;
    oddsCache = { snapshot: json, fetched_at: now };
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type OddsSourceStatus =
  | { kind: "loading" }
  | { kind: "live"; generated_at: number; matches: number }
  | { kind: "fallback" };

const INITIAL_PROGRESS: SwarmProgress = {
  phase: "idle",
  bots_generated: 0,
  picks_made: 0,
  current_match_id: null,
  merkle_roots_built: 0,
  errors: [],
  throughput: 0,
  started_at: null,
  hashing: null,
};

const INITIAL_STATS: SwarmStats = {
  best_bot_score: 0,
  bots_still_perfect: 0,
  merkle_root: null,
  federation_rank: null,
};

const CORES_FALLBACK = 4;

// Tim 2026-06-07 evening: BYO-LLM vendor cascade. Vendor → model list
// → key URL → placeholder. Used by the Strategy card.
type VendorId = "anthropic" | "openai" | "openrouter" | "google";
interface ModelOption { readonly id: string; readonly label: string }

const MODELS_BY_VENDOR: Readonly<Record<VendorId, readonly ModelOption[]>> = {
  anthropic: [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7 (most capable)" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (fast + strong)" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (cheapest)" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o (recommended)" },
    { id: "gpt-4o-mini", label: "GPT-4o mini (cheap)" },
    { id: "o1-mini", label: "o1-mini (reasoning)" },
  ],
  openrouter: [
    { id: "meta-llama/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
    { id: "deepseek/deepseek-r1", label: "DeepSeek R1 (reasoning)" },
    { id: "mistralai/mistral-large", label: "Mistral Large" },
  ],
  google: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
};

const MODEL_DEFAULTS: Readonly<Record<VendorId, string>> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  openrouter: "meta-llama/llama-3.1-405b-instruct",
  google: "gemini-2.0-flash",
};

const VENDOR_KEY_LABEL: Readonly<Record<VendorId, string>> = {
  anthropic: "Anthropic API key",
  openai: "OpenAI API key",
  openrouter: "OpenRouter API key",
  google: "Google AI Studio API key",
};

const VENDOR_KEY_PLACEHOLDER: Readonly<Record<VendorId, string>> = {
  anthropic: "sk-ant-...",
  openai: "sk-proj-...",
  openrouter: "sk-or-v1-...",
  google: "AIza...",
};

const VENDOR_KEY_URL: Readonly<Record<VendorId, string>> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  openrouter: "https://openrouter.ai/keys",
  google: "https://aistudio.google.com/apikey",
};

// Tim 2026-06-07 evening: warn the user if they kick off a loop or
// single batch at a count that will make the laptop hot. 100k is the
// threshold where chunked rAF stops feeling instant on a quad-core.
const HIGH_LOAD_BOT_COUNT = 100_000;

/**
 * Reverse-map a stored anchor_weight (0 / 0.4 / 0.75 / 1) back to its
 * AnchorMode enum value. Anything in between snaps to the closest
 * preset so the slider is robust to future tweaks of the weight
 * constants.
 */
function modeFromWeight(weight: number): AnchorMode {
  const entries = Object.entries(ANCHOR_WEIGHT_BY_MODE) as ReadonlyArray<
    [AnchorMode, number]
  >;
  let best: AnchorMode = DEFAULT_ANCHOR_MODE;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [mode, w] of entries) {
    const d = Math.abs(w - weight);
    if (d < bestDist) {
      bestDist = d;
      best = mode;
    }
  }
  return best;
}

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

/**
 * Short relative-time label for the live-odds pill: "just now",
 * "2 min ago", "1 hr ago". Capped to "1 day+ ago" because anything
 * older means the snapshot is stale enough that we shouldn't be
 * showing it as "live" in the first place.
 */
function formatRelativeTime(epochMs: number): string {
  const diff = Math.max(0, Date.now() - epochMs);
  if (diff < 30_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return "1 day+ ago";
}

/**
 * Combine per-worker hashing snapshots into one swarm-wide snapshot
 * the live panel renders.
 *
 *   - slices_done counts workers whose snapshot is null AFTER ever
 *     having reported (i.e. they've completed). We can't know that
 *     from a null alone (a worker might not have started hashing yet),
 *     so we infer from slice_index/slice_total of the latest message:
 *     workers that hit slice_total - 1 with leaves_remaining 0 are
 *     "done" with hashing.
 *   - level shows the deepest level any active worker has reached;
 *     this is the "we are X% through the tree" signal.
 *   - leaves_remaining sums across active workers so a 16-worker swarm
 *     reports total in-flight hashes.
 */
function aggregateHashing(
  perWorker: ReadonlyArray<WorkerHashingMessage | null>,
  matchCount: number,
): HashingSnapshot {
  let slicesDone = 0;
  let slicesActiveMin = matchCount;
  let level = 0;
  let totalLevels = 0;
  let leavesRemaining = 0;
  let levelSize = 0;
  let any = false;
  for (const snap of perWorker) {
    if (!snap) continue;
    any = true;
    // A worker that just finished the last leaf of the last slice
    // reports slice_index = slice_total - 1, leaves_remaining = 0,
    // total_levels = 0 (the sentinel beat). Count those as done.
    const isLastBeat =
      snap.leaves_remaining === 0 &&
      snap.total_levels === 0 &&
      snap.slice_index === snap.slice_total - 1;
    if (isLastBeat) {
      slicesDone += snap.slice_total;
    } else {
      slicesDone += snap.slice_index;
      slicesActiveMin = Math.min(slicesActiveMin, snap.slice_index);
      level = Math.max(level, snap.level);
      totalLevels = Math.max(totalLevels, snap.total_levels);
      leavesRemaining += snap.leaves_remaining;
      levelSize += snap.level_size;
    }
  }
  if (!any) {
    return {
      slices_done: 0,
      slices_total: matchCount * perWorker.length,
      level: 0,
      total_levels: 0,
      leaves_remaining: 0,
      level_size: 0,
    };
  }
  return {
    slices_done: slicesDone,
    slices_total: matchCount * perWorker.length,
    level,
    total_levels: totalLevels,
    leaves_remaining: leavesRemaining,
    level_size: levelSize,
  };
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

  // Tim 2026-06-08: gate the entire Start button on sign-in. The
  // swarm's bots are now bound to a user_id on /v1/swarm/commit and
  // the public counter only includes owned rows, so an anonymous
  // spawn is wasted work (and was inflating /v1/swarm/totals with
  // orphan rows before this gate landed). Loading state shows a
  // disabled button so the page doesn't flash sign-in CTAs on a
  // refresh of an already-authed user.
  const authState = useUser();
  const isSignedIn = authState.status === "authenticated";
  const authLoading = authState.status === "loading";

  // Tim 2026-06-08: incognito / private-browsing detection. If we are
  // in an ephemeral browsing mode, IndexedDB clears the moment the
  // last private window closes, meaning the user's bot picks vanish
  // along with any audit trail. Two cheap heuristics:
  //   1. navigator.storage.estimate(): incognito Chromium reports a
  //      quota well under 500 MB; regular sessions report tens of GB.
  //   2. localStorage.setItem smoke test: Safari private mode throws
  //      QuotaExceededError; older Firefox private windows do too.
  // False positives on tiny storage devices are possible; we surface
  // the warning rather than block, and let the user dismiss it.
  const [incognitoWarning, setIncognitoWarning] = useState<
    null | "likely" | "confirmed"
  >(null);
  const [incognitoAcknowledged, setIncognitoAcknowledged] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let likely = false;
      let confirmed = false;
      try {
        if (
          typeof navigator !== "undefined" &&
          navigator.storage?.estimate
        ) {
          const est = await navigator.storage.estimate();
          if (
            typeof est.quota === "number" &&
            est.quota > 0 &&
            est.quota < 500_000_000
          ) {
            likely = true;
          }
        }
      } catch {
        /* feature missing; fall through */
      }
      try {
        const k = "__tnm_incognito_probe__";
        window.localStorage.setItem(k, "1");
        window.localStorage.removeItem(k);
      } catch {
        // localStorage rejected the write: Safari / older Firefox private mode.
        confirmed = true;
      }
      if (cancelled) return;
      if (confirmed) setIncognitoWarning("confirmed");
      else if (likely) setIncognitoWarning("likely");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Tim 2026-06-07 evening: IndexedDB is the source of truth, Supabase
  // is an OPTIONAL replication mirror. Default off; user ticks to opt in.
  const [replicateToSupabase, setReplicateToSupabase] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseKey, setSupabaseKey] = useState("");
  const [supabaseStatus, setSupabaseStatus] = useState<
    "untested" | "ok" | "error" | "checking"
  >("untested");

  // Tim 2026-06-07 evening: vendor + model + key cascade so users can
  // bring their own LLM. Supports Anthropic, OpenAI, OpenRouter
  // (which forwards to most labs), and Google Gemini. "none" keeps
  // the free chalk-weighted heuristic.
  const [apiVendor, setApiVendor] = useState<
    "none" | "anthropic" | "openai" | "openrouter" | "google"
  >("none");
  const [apiModel, setApiModel] = useState<string>("");
  const [apiKey, setApiKey] = useState("");

  const [botCount, setBotCount] = useState(10_000);
  const [strategy, setStrategy] = useState<StrategyName>("chalk-v1");

  // Tim 2026-06-07 evening: loop mode generates the same batch size
  // again and again until the user stops. Warning popup if botCount
  // is high enough that the laptop will warm up noticeably.
  const [loopMode, setLoopMode] = useState(false);
  const [loopIterations, setLoopIterations] = useState(0);
  const stopRequestedRef = useRef<boolean>(false);

  // Tim 2026-06-07 late: rate-limit auto-commits to the central
  // /v1/swarms/<id>/summary endpoint so a tight loop of 10k-batch runs
  // doesn't hammer the game-service. The window is per-tab; the server
  // payload is idempotent on (operator_id, kickoff_at) so a coalesced
  // publish is still correct, it just covers more bots.
  //
  // Behaviour:
  //   - lastPublishAtRef holds the wall-clock ms of the last successful
  //     publish.
  //   - latestPayloadRef holds the most recent payload generated by a
  //     finished batch, waiting to publish.
  //   - publishTimerRef is the in-flight setTimeout, if any.
  //   - pendingPublishRef is the beforeunload trigger: true the instant
  //     a batch finishes with un-ACKed work, false the instant a
  //     publish resolves.
  const PUBLISH_MIN_INTERVAL_MS = 30_000;
  const lastPublishAtRef = useRef<number>(0);
  const latestPayloadRef = useRef<{
    apiKey: string;
    payload: Parameters<FederationClient["publishOperatorSummary"]>[1];
  } | null>(null);
  const publishTimerRef = useRef<number | null>(null);
  const pendingPublishRef = useRef<boolean>(false);
  // Holds the latest FederationClient so a deferred publish 30s after
  // the batch finished can still call into it.
  const federationRef = useRef<FederationClient | null>(null);

  const [progress, setProgress] = useState<SwarmProgress>(INITIAL_PROGRESS);
  const [stats, setStats] = useState<SwarmStats>(INITIAL_STATS);
  const [credentials, setCredentials] = useState<NodeCredentials | null>(null);
  /** Final swarm-completion payload, populated when the run finishes.
   *  A3 (federation.ts) consumes this from the React state in a follow-
   *  up wire-up; for now we expose it to the UI so the merkle root is
   *  shown copyable + with an explainer tooltip. */
  const [completionPayload, setCompletionPayload] =
    useState<SwarmCompletionPayload | null>(null);
  const [copiedRoot, setCopiedRoot] = useState(false);

  // A13: optional operator API key. When the user pastes a key here,
  // BrowserSwarm publishes an aggregate summary to
  // /v1/swarms/<api_key_hash>/summary after every successful batch so
  // friends viewing the user's profile get a cheap edge-cached JSON of
  // their swarm aggregates. Stored in IndexedDB, never leaves this tab.
  const [operatorApiKey, setOperatorApiKey] = useState<string>("");
  const [operatorKeySaved, setOperatorKeySaved] = useState<boolean>(false);

  // Tim 2026-06-07: persistent cumulative swarm cursor. Each press of
  // Start ADDS botCount bots starting from next_bot_index, then writes
  // back so the next press continues. Survives tab close + reopen via
  // the IndexedDB swarm_state object store.
  const [swarmTotal, setSwarmTotal] = useState<number>(0);
  const [batchesCommitted, setBatchesCommitted] = useState<number>(0);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const nextBotIndexRef = useRef<number>(0);

  // A11 Phase 2: user-anchored swarm slider. Default mode is read from
  // IndexedDB on mount; subsequent changes persist back so the slider
  // position survives a tab close. The user's bracket draft itself
  // lives in localStorage (see apps/web/lib/bracket/storage.ts) and is
  // re-snapshotted on every Start press.
  const [anchorMode, setAnchorMode] = useState<AnchorMode>(DEFAULT_ANCHOR_MODE);
  const [lastAnchorHash, setLastAnchorHash] = useState<string | null>(null);

  const persistenceRef = useRef<Persistence>(defaultPersistence());
  const workersRef = useRef<Worker[]>([]);
  const runIdRef = useRef<string>("");
  const throughputSamplesRef = useRef<Array<{ t: number; bots: number }>>([]);
  const workerProgressRef = useRef<number[]>([]);
  const sliceResultsRef = useRef<WorkerSliceDoneMessage[]>([]);
  /** Per-worker hashing snapshot: the last hashing message we got from
   *  worker i. We aggregate across these to produce the
   *  SwarmProgress.hashing snapshot. `null` = worker not hashing right
   *  now (still generating or already done). */
  const workerHashingRef = useRef<Array<WorkerHashingMessage | null>>([]);
  /** Throttle for setting hashing state on the React side. The workers
   *  are already at ~8Hz each; aggregating N workers means we don't
   *  need to update React faster than ~10Hz to feel live. */
  const lastHashingRenderRef = useRef<number>(0);

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

  // A13: load any cached operator key so the publish path lights up
  // automatically across tab reopens.
  useEffect(() => {
    let cancelled = false;
    persistenceRef.current
      .loadOperatorApiKey()
      .then((k) => {
        if (!cancelled && k) {
          setOperatorApiKey(k);
          setOperatorKeySaved(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onSaveOperatorKey = useCallback(async () => {
    const trimmed = operatorApiKey.trim();
    if (!trimmed) return;
    try {
      await persistenceRef.current.saveOperatorApiKey(trimmed);
      setOperatorKeySaved(true);
    } catch {
      // Silent: persistence is best-effort.
    }
  }, [operatorApiKey]);

  // Polymarket live-odds snapshot. Fetched once on mount and again
  // before each Start press if the cache is older than ODDS_TTL_MS.
  // Drives the "Odds source:" pill so the user can see at a glance
  // whether the swarm is running on real market odds or the FIFA-rank
  // fallback. The strategy itself reads from the module-scoped override
  // map populated via setLiveOddsByMatchId() below; the picker never
  // touches state, so the source pill is purely informational.
  const [oddsSourceStatus, setOddsSourceStatus] = useState<OddsSourceStatus>({
    kind: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snap = await fetchOddsSnapshot(true);
      if (cancelled) return;
      if (snap) {
        setLiveOddsByMatchId(snap.matches);
        setOddsSourceStatus({
          kind: "live",
          generated_at: snap.generated_at,
          matches: Object.keys(snap.matches).length,
        });
      } else {
        setLiveOddsByMatchId(undefined);
        setOddsSourceStatus({ kind: "fallback" });
      }
    })();
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
      .then((load) => {
        if (cancelled) return;
        // A6 (Tim 2026-06-07) wrapped the flat state under `.state` so
        // the loader can also signal a fixture-version wipe via
        // `reset_for_version_change`. Unpack here.
        const s = load.state;
        nextBotIndexRef.current = s.next_bot_index;
        setSwarmTotal(s.total_bots_generated);
        setBatchesCommitted(s.batches_committed);
        setLastRunAt(s.last_run_at_utc);
        // A11 Phase 2: restore the anchor weight slider.
        const mode = modeFromWeight(s.anchor_weight ?? 0);
        setAnchorMode(mode);
        setLastAnchorHash(s.last_anchor_hash ?? null);
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
    if (
      progress.phase === "generating" ||
      progress.phase === "hashing" ||
      progress.phase === "committing" ||
      progress.phase === "federating"
    )
      return;

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    runIdRef.current = runId;
    sliceResultsRef.current = [];
    throughputSamplesRef.current = [];

    const progressStartedAt = Date.now();
    setProgress({
      ...INITIAL_PROGRESS,
      phase: "preparing",
      started_at: progressStartedAt,
    });
    setStats(INITIAL_STATS);
    setCompletionPayload(null);
    setCopiedRoot(false);

    // Refresh the Polymarket live-odds snapshot if the cache is older
    // than 60s. setLiveOddsByMatchId() populates the module-scoped
    // override map that regenerate.ts → effectiveOdds() consults; the
    // strategy falls back to FIFA-rank-derived odds automatically when
    // the map is undefined or missing a match, so a fetch failure here
    // is silent and non-blocking.
    const oddsSnap = await fetchOddsSnapshot(false);
    if (oddsSnap) {
      setLiveOddsByMatchId(oddsSnap.matches);
      setOddsSourceStatus({
        kind: "live",
        generated_at: oddsSnap.generated_at,
        matches: Object.keys(oddsSnap.matches).length,
      });
    } else {
      setLiveOddsByMatchId(undefined);
      setOddsSourceStatus({ kind: "fallback" });
    }

    // Register / re-use credentials.
    const fed = new FederationClient({ dry_run: dryRun });
    federationRef.current = fed;
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
    workerHashingRef.current = new Array(cores).fill(null);
    lastHashingRenderRef.current = 0;

    // A11 Phase 2: capture the user's anchor bracket NOW so each bot
    // in this batch sees the SAME snapshot. If the user edits their
    // bracket mid-run, the next batch picks up the new snapshot. The
    // already-running batch keeps using the captured one.
    const anchorSnapshot: AnchorSnapshot | undefined =
      anchorMode === "off"
        ? undefined
        : captureAnchorSnapshot(ANCHOR_TOURNAMENT_ID, anchorMode);

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
        } else if (msg.kind === "hashing") {
          // Tim 2026-06-07: surface per-batch merkle progress so the
          // hashing phase no longer looks frozen. We store the most
          // recent message per worker, then aggregate.
          workerHashingRef.current[msg.worker_index] = msg;
          const now = performance.now();
          // Throttle React re-renders to ~10Hz regardless of how many
          // workers report. Individual workers are already at ~8Hz.
          if (now - lastHashingRenderRef.current < 100) return;
          lastHashingRenderRef.current = now;
          const snap = aggregateHashing(
            workerHashingRef.current,
            demoMatches.length,
          );
          setProgress((p) => ({
            ...p,
            phase: p.phase === "generating" ? "hashing" : p.phase,
            hashing: snap,
          }));
        } else if (msg.kind === "slice_done") {
          sliceResultsRef.current.push(msg);
          // Mark this worker as no longer hashing so the aggregate
          // doesn't include its stale snapshot.
          workerHashingRef.current[msg.worker_index] = null;
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
          anchor: anchorSnapshot,
        });
      }
      if (finished === cores) resolve();
    });

    workersRef.current = workers;
    await slicePromise;
    for (const w of workers) w.terminate();
    workersRef.current = [];

    // Combine per-worker, per-match roots into a single root per match
    // (sorted-pair sha256, same shape as everywhere else). Clear the
    // hashing snapshot now that workers are done so the UI shows the
    // combining phase cleanly.
    setProgress((p) => ({ ...p, phase: "committing", hashing: null }));

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

    // Tim 2026-06-07: roll the per-match roots up into one swarm-wide
    // merkle root. This is what we surface to the user as "your swarm's
    // proof" — it commits to every per-match root, which commits to
    // every per-worker slice root, which commits to every pick. The
    // OpenTimestamps + Bitcoin anchor in the federation layer (A3) only
    // needs THIS one hex string.
    const matchRootsOrdered = demoMatches.map(
      (m) => combinedRoots[m.match_id] ?? "",
    );
    const swarmMerkleRoot = await merkleRoot(matchRootsOrdered);

    setProgress((p) => ({
      ...p,
      merkle_roots_built: merkleBuilt,
      phase: "federating",
    }));

    // Pick the first match as the representative commit for the demo
    // and federate that. Real flow per-match is wired up by Agent A09.
    const firstMatch = demoMatches[0];
    let federationRank: number | null = null;
    if (firstMatch && creds) {
      const root = combinedRoots[firstMatch.match_id]!;
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
      merkle_root: swarmMerkleRoot,
      federation_rank: federationRank,
    });

    // A13 operator-aggregate publish. Pulls the optional operator API
    // key from IndexedDB; if absent (most browser tabs), this is a
    // silent no-op. The merkle_root we publish is the swarm-wide
    // root, kickoff_at uses the first match's kickoff as the
    // idempotency anchor, and top_k samples the top 100 sample bots
    // by chalk score.
    try {
      const operatorKey = await persistenceRef.current
        .loadOperatorApiKey()
        .catch(() => null);
      if (operatorKey) {
        // Build top_k from the sample bots we just persisted. The
        // browser only materialises ~1k sample bots per batch, so
        // this is bounded.
        const topKSource = sampleBots
          .slice()
          .sort((a, b) => (b.chalk_score ?? 0) - (a.chalk_score ?? 0))
          .slice(0, 100)
          .map((b) => ({
            bot_id: b.bot_id,
            score: 0, // pre-kickoff: no resolved matches yet
            chalk_score: b.chalk_score ?? 0,
          }));
        const newTotalEverGeneratedForA13 =
          nextBotIndexRef.current + totalBots;
        const kickoffAt = firstMatch
          ? new Date(firstMatch.kickoff_utc).getTime()
          : Date.now();
        const aliveAfterMatch = demoMatches.map((_, idx) => ({
          n: idx + 1,
          alive_count: newTotalEverGeneratedForA13, // pre-kickoff stub
        }));
        // 2026-06-07 late: rate-limited auto-commit. schedulePublish
        // coalesces back-to-back batches into one POST per 30s per
        // operator so a tight loop of 10k-batch runs doesn't hammer
        // game-service. The /v1/swarms/<id>/summary endpoint is
        // idempotent on (operator_id, kickoff_at) so a coalesced
        // publish just covers more bots.
        schedulePublish(operatorKey, {
          total_bots: newTotalEverGeneratedForA13,
          bots_alive_after_match_n: aliveAfterMatch,
          best_bot_score: Math.round(bestScore),
          top_k: topKSource,
          merkle_root: swarmMerkleRoot,
          kickoff_at: kickoffAt,
          generated_at: Date.now(),
        });
      }
    } catch {
      // Silent: operator publish is best-effort.
    }

    // Build the swarm completion payload A3 (federation.ts) will pick
    // up. Shape is the contract; A3 fills `top_N_claim` when the
    // scoring rule lands.
    const startedAt = progressStartedAt;
    const finishedAt = Date.now();
    const completion: SwarmCompletionPayload = {
      master_seed: MASTER_SEED,
      run_id: runId,
      total_bots: totalBots,
      merkle_root: swarmMerkleRoot,
      strategy,
      started_at: startedAt,
      finished_at: finishedAt,
      per_match_roots: combinedRoots,
      best_bot_score: bestScore,
    };
    setCompletionPayload(completion);

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
    const anchorHash = anchorSnapshot?.bracket_hash ?? null;
    setLastAnchorHash(anchorHash);
    await persistenceRef.current
      .saveSwarmState({
        next_bot_index: newNextIndex,
        total_bots_generated: newTotalEverGenerated,
        last_run_at_utc: runAt,
        batches_committed: newBatchesCommitted,
        anchor_weight: ANCHOR_WEIGHT_BY_MODE[anchorMode],
        last_anchor_hash: anchorHash,
      })
      .catch(() => {});

    setProgress((p) => ({
      ...p,
      phase: "done",
      bots_generated: totalBots,
      picks_made: totalPicks,
    }));
  }, [
    anchorMode,
    batchesCommitted,
    botCount,
    credentials,
    demoMatches,
    dryRun,
    progress.phase,
    strategy,
    supabaseConfig,
  ]);

  // A11 Phase 2: persist anchor weight whenever the slider changes,
  // even before the user runs another batch. The persisted value
  // survives a tab close so the slider position is restored exactly.
  const onAnchorChange = useCallback(
    async (mode: AnchorMode) => {
      setAnchorMode(mode);
      // Persist without blocking the UI; race conditions are fine
      // because the next save call (post-run) will overwrite anyway.
      try {
        const load = await persistenceRef.current.loadSwarmState();
        await persistenceRef.current.saveSwarmState({
          next_bot_index: load.state.next_bot_index,
          total_bots_generated: load.state.total_bots_generated,
          last_run_at_utc: load.state.last_run_at_utc,
          batches_committed: load.state.batches_committed,
          anchor_weight: ANCHOR_WEIGHT_BY_MODE[mode],
          last_anchor_hash: load.state.last_anchor_hash,
        });
      } catch {
        // Silent: persistence is best-effort.
      }
    },
    [],
  );

  const onStop = useCallback(() => {
    // Tim 2026-06-07 evening: also tell the loop driver to stop after
    // this iteration completes. Without this, the current batch
    // finishes and the loop immediately kicks off the next one.
    stopRequestedRef.current = true;
    for (const w of workersRef.current) w.terminate();
    workersRef.current = [];
    setProgress((p) => ({ ...p, phase: "idle" }));
  }, []);

  // Tim 2026-06-07 evening: when loopMode is on and a run finishes
  // cleanly, kick off the next iteration automatically. Bumps the
  // iteration counter so the user sees progress.
  useEffect(() => {
    if (!loopMode) return;
    if (progress.phase !== "done") return;
    if (stopRequestedRef.current) {
      stopRequestedRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      setLoopIterations((n) => n + 1);
      void onStart();
    }, 250);
    return () => window.clearTimeout(handle);
    // onStart is intentionally NOT in deps; it would re-trigger this on
    // every render. We rely on the closure capturing the latest one via
    // the ref-based pattern the component already uses internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.phase, loopMode]);

  // schedulePublish: rate-limited auto-commit to /v1/swarms/<id>/summary.
  // - First call after the 30s cooldown publishes immediately.
  // - Within the cooldown window, the payload is queued and a single
  //   timer fires at cooldown-end with whatever the latest payload is.
  // - Back-to-back batches collapse into one publish per 30s window.
  // - pendingPublishRef flips true the moment we have un-ACKed work and
  //   flips false on a successful publish; beforeunload reads it.
  const schedulePublish = useCallback(
    (
      apiKey: string,
      payload: Parameters<FederationClient["publishOperatorSummary"]>[1],
    ) => {
      latestPayloadRef.current = { apiKey, payload };
      pendingPublishRef.current = true;
      const fire = () => {
        const queued = latestPayloadRef.current;
        if (!queued) return;
        latestPayloadRef.current = null;
        publishTimerRef.current = null;
        const fedClient = federationRef.current;
        if (!fedClient) return;
        void fedClient
          .publishOperatorSummary(queued.apiKey, queued.payload)
          .then(() => {
            lastPublishAtRef.current = Date.now();
            // Only clear pending if no new payload arrived while we
            // were in-flight.
            if (!latestPayloadRef.current) {
              pendingPublishRef.current = false;
            } else {
              // A new batch finished mid-flight; reschedule.
              schedulePublish(
                latestPayloadRef.current.apiKey,
                latestPayloadRef.current.payload,
              );
            }
          })
          .catch(() => {
            // Network failure: leave pending true so beforeunload still
            // warns and the next batch's schedulePublish retries.
          });
      };
      if (publishTimerRef.current != null) {
        // Already queued; the eventual fire will pick up the latest payload.
        return;
      }
      const elapsed = Date.now() - lastPublishAtRef.current;
      if (elapsed >= PUBLISH_MIN_INTERVAL_MS) {
        fire();
      } else {
        publishTimerRef.current = window.setTimeout(
          fire,
          PUBLISH_MIN_INTERVAL_MS - elapsed,
        );
      }
    },
    [],
  );

  // beforeunload: warn the user only when there's un-ACKed batch work
  // sitting in the publish queue. Loop mode that is actively iterating
  // counts as "in flight" so we warn either way until the queue drains.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!pendingPublishRef.current) return;
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      if (publishTimerRef.current != null) {
        window.clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
      }
    };
  }, []);

  const cores = useMemo(() => workerCount(), []);
  const elapsedMs = progress.started_at ? Date.now() - progress.started_at : 0;

  // Block Start in a private / incognito browser until the user either
  // acknowledges the no-persistence risk or turns on Supabase
  // replication (which survives the window closing). Tim 2026-06-08.
  const incognitoBlocked =
    !!incognitoWarning && !incognitoAcknowledged && !replicateToSupabase;

  return (
    <section className="vt-swarm" aria-label="Browser bot swarm console">
      {incognitoWarning && (
        <div
          className="vt-swarm-incognito-warning"
          role="alert"
          aria-live="polite"
        >
          <div className="vt-swarm-incognito-warning-head">
            <strong>
              {incognitoWarning === "confirmed"
                ? "Private / incognito browser detected"
                : "Looks like a private / incognito browser"}
            </strong>
          </div>
          <p>
            Bot picks generated here are written to IndexedDB on this
            device. In a private / incognito window, the browser wipes
            IndexedDB the moment the last private window closes. Your
            bots will be lost, and if a result is ever disputed there
            will be no local record to verify the merkle root against.
          </p>
          <p>
            <strong>Recommended:</strong> close this window and open
            <code> play.tournamental.com/run </code> in a regular browser
            session, OR tick the &ldquo;Also replicate to Supabase&rdquo;
            box below before you start so the swarm survives the window
            close.
          </p>
          {replicateToSupabase ? (
            <p className="vt-swarm-incognito-cleared">
              Supabase replication is on, so your swarm will survive this
              window closing. You are good to start.
            </p>
          ) : incognitoAcknowledged ? (
            <p className="vt-swarm-incognito-cleared">
              Acknowledged. Starting will generate bots that are not
              guaranteed to survive this window closing.
            </p>
          ) : (
            <button
              type="button"
              className="vt-swarm-incognito-ack"
              onClick={() => setIncognitoAcknowledged(true)}
            >
              I understand, let me run without saving
            </button>
          )}
        </div>
      )}
      <div className="vt-swarm-grid">
        <FieldsetCard
          title="1. Storage"
          subtitle="Your swarm lives in IndexedDB on this device by default. Tick the box to also replicate to your own free Supabase project."
        >
          <div className="vt-swarm-storage-primary">
            <div className="vt-swarm-storage-badge" aria-hidden="true">
              ✓
            </div>
            <div>
              <p className="vt-swarm-storage-name">IndexedDB (this device)</p>
              <p className="vt-swarm-storage-detail">
                Default and always on. Your swarm persists across tab close,
                browser restart, and laptop reboot. Private to this browser.
              </p>
            </div>
          </div>

          <label className="vt-swarm-checkbox-row">
            <input
              type="checkbox"
              checked={replicateToSupabase}
              onChange={(e) => setReplicateToSupabase(e.target.checked)}
            />
            <span>
              <strong>Also replicate to Supabase</strong>
              <span className="vt-swarm-hint">
                {" "}
                so you can browse the swarm from a second device.
              </span>
            </span>
          </label>

          <details className="vt-swarm-details" style={{ marginTop: 12 }}>
            <summary>
              Optional: publish aggregate to your Tournamental profile
            </summary>
            <p
              className="vt-swarm-faq-detail"
              style={{ marginTop: 6, fontSize: 12, color: "#a8a8a8" }}
            >
              Paste an operator API key (issued at{" "}
              <a href="/profile/api-keys">/profile/api-keys</a>) and we
              upload an aggregate summary after every batch so anyone
              looking at your profile sees your swarm stats. Picks stay
              private until a bot survives match 80 on a perfect track.
              Key stays in this tab; only the cumulative aggregate is
              sent.
            </p>
            <input
              className="vt-swarm-input"
              type="password"
              placeholder="tnm_..."
              value={operatorApiKey}
              onChange={(e) => {
                setOperatorApiKey(e.target.value);
                setOperatorKeySaved(false);
              }}
            />
            <div className="vt-swarm-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="vt-swarm-button vt-swarm-button--ghost"
                onClick={() => void onSaveOperatorKey()}
                disabled={!operatorApiKey.trim() || operatorKeySaved}
              >
                {operatorKeySaved ? "Saved" : "Save key"}
              </button>
            </div>
          </details>

          {replicateToSupabase && (
            <>
              <label className="vt-swarm-label" htmlFor="vt-supabase-url">
                Supabase URL
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
                <summary>How to set up your free Supabase project</summary>
                <ol className="vt-swarm-faq-list">
                  <li>
                    Go to{" "}
                    <a
                      href="https://supabase.com/dashboard"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      supabase.com/dashboard
                    </a>{" "}
                    and create a free account (30 seconds, no credit card).
                  </li>
                  <li>
                    Click <strong>New project</strong>, name it
                    {" "}<code>tournamental-bots</code>, choose a region near
                    you. Wait ~1 minute for it to provision.
                  </li>
                  <li>
                    From the project dashboard, copy{" "}
                    <strong>Project URL</strong> and{" "}
                    <strong>anon public key</strong> from{" "}
                    <em>Project Settings → API</em>. Paste them above.
                  </li>
                  <li>
                    Expand the <strong>Schema SQL</strong> below and paste
                    it into the Supabase <em>SQL Editor</em> tab. Hit Run.
                    That creates the four tables we replicate to.
                  </li>
                </ol>
                <p className="vt-swarm-faq-detail">
                  We only use the public anon key. We never ask for your
                  service-role key. Replication is fire-and-forget; if your
                  Supabase quota is hit, IndexedDB keeps working unaffected.
                </p>
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
            </>
          )}
        </FieldsetCard>

        <FieldsetCard
          title="2. Strategy"
          subtitle="Free chalk-weighted heuristic by default. Bring your own LLM key for an Anthropic, OpenAI, OpenRouter, or Google model to elevate the champion bots in your swarm."
        >
          <p className="vt-swarm-odds-source vt-swarm-helper">
            {oddsSourceStatus.kind === "loading" && (
              <>Odds source: <strong>checking live feed</strong></>
            )}
            {oddsSourceStatus.kind === "live" && (
              <>
                Odds source: <strong>Polymarket live</strong>
                {" "}&middot; {formatNumber(oddsSourceStatus.matches)} matches priced
                {" "}&middot; updated {formatRelativeTime(oddsSourceStatus.generated_at)}
              </>
            )}
            {oddsSourceStatus.kind === "fallback" && (
              <>
                Odds source: <strong>FIFA rank derived</strong>
                {" "}&middot; live odds unavailable
              </>
            )}
          </p>

          <label className="vt-swarm-label" htmlFor="vt-vendor">
            LLM vendor
          </label>
          <select
            id="vt-vendor"
            className="vt-swarm-input"
            value={apiVendor}
            onChange={(e) => {
              const v = e.target.value as typeof apiVendor;
              setApiVendor(v);
              // Reset the model on vendor change so we never carry a
              // stale model id that the new vendor cannot serve.
              setApiModel(v === "none" ? "" : MODEL_DEFAULTS[v]);
              setStrategy(v === "none" ? "chalk-v1" : (v as StrategyName));
            }}
          >
            <option value="none">None (free chalk-weighted heuristic)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
            <option value="openrouter">OpenRouter (Llama, DeepSeek, Mistral, +100)</option>
            <option value="google">Google (Gemini)</option>
          </select>

          {apiVendor !== "none" && (
            <>
              <label className="vt-swarm-label" htmlFor="vt-model">
                Model
              </label>
              {apiVendor === "openrouter" ? (
                <input
                  id="vt-model"
                  className="vt-swarm-input"
                  placeholder="e.g. meta-llama/llama-3.1-70b-instruct"
                  value={apiModel}
                  onChange={(e) => setApiModel(e.target.value)}
                />
              ) : (
                <select
                  id="vt-model"
                  className="vt-swarm-input"
                  value={apiModel}
                  onChange={(e) => setApiModel(e.target.value)}
                >
                  {MODELS_BY_VENDOR[apiVendor].map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}

              <label className="vt-swarm-label" htmlFor="vt-api-key">
                {VENDOR_KEY_LABEL[apiVendor]}
                {" "}
                <span className="vt-swarm-hint">never leaves this tab</span>
              </label>
              <input
                id="vt-api-key"
                className="vt-swarm-input"
                placeholder={VENDOR_KEY_PLACEHOLDER[apiVendor]}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="vt-swarm-helper">
                Get a key at{" "}
                <a
                  href={VENDOR_KEY_URL[apiVendor]}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {VENDOR_KEY_URL[apiVendor]}
                </a>
                . Your key stays in this browser tab, we never see it.
              </p>
            </>
          )}
        </FieldsetCard>

        <FieldsetCard
          title="3. Anchor to my bracket"
          subtitle="Blend the chalk strategy with your own bracket draft. Soft / Strong / Lockstep keep the swarm trending toward your picks while perturbation still guarantees uniqueness."
        >
          <label className="vt-swarm-label" htmlFor="vt-anchor">
            Anchor weight:{" "}
            <strong>{ANCHOR_LABEL_BY_MODE[anchorMode]}</strong>
          </label>
          <select
            id="vt-anchor"
            className="vt-swarm-input"
            value={anchorMode}
            onChange={(e) => void onAnchorChange(e.target.value as AnchorMode)}
            aria-describedby="vt-anchor-help"
          >
            <option value="off">Off (pure chalk + uniqueness)</option>
            <option value="soft">Soft (40% you, 60% chalk)</option>
            <option value="strong">Strong (75% you, 25% chalk)</option>
            <option value="lockstep">Lockstep (100% you)</option>
          </select>
          <p
            id="vt-anchor-help"
            style={{
              margin: "8px 0 0",
              fontSize: 12,
              color: "#98a0b7",
              lineHeight: 1.4,
            }}
          >
            Reads your saved bracket from{" "}
            <code>/world-cup-2026</code>. Each batch you generate
            snapshots the bracket at that moment, so committed batches
            stay locked to the snapshot they used. The next batch you
            run picks up whatever you have saved at that moment.
            {lastAnchorHash && (
              <>
                {" "}Last anchor hash:{" "}
                <code style={{ color: "#f6c64f" }}>
                  {lastAnchorHash.slice(0, 16)}
                </code>
                .
              </>
            )}
          </p>
        </FieldsetCard>

        <FieldsetCard
          title="4. Swarm size"
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
          title="5. Run"
          subtitle="Workers spin up in parallel. Tab stays responsive."
        >
          <label className="vt-swarm-checkbox-row">
            <input
              type="checkbox"
              checked={loopMode}
              onChange={(e) => setLoopMode(e.target.checked)}
              disabled={
                progress.phase === "generating" ||
                progress.phase === "hashing" ||
                progress.phase === "committing" ||
                progress.phase === "federating"
              }
            />
            <span>
              <strong>∞ Keep looping</strong>
              <span className="vt-swarm-hint">
                {" "}
                generate {formatNumber(botCount)} bots, commit, repeat until I stop.
              </span>
            </span>
          </label>
          {loopMode && botCount >= HIGH_LOAD_BOT_COUNT && (
            <p className="vt-swarm-loop-warning" role="alert">
              ⚠ Loop mode at {formatNumber(botCount)} bots per batch will
              keep all your CPU cores busy continuously. Your laptop will
              warm up and other apps may feel slow. Leave it overnight
              for the best results, or drop the bot count for a lighter
              touch.
            </p>
          )}

          <button
            type="button"
            className="vt-swarm-button vt-swarm-button--primary"
            onClick={onStart}
            disabled={
              !isSignedIn ||
              authLoading ||
              incognitoBlocked ||
              progress.phase === "generating" ||
              progress.phase === "hashing" ||
              progress.phase === "committing" ||
              progress.phase === "federating"
            }
          >
            {!isSignedIn && !authLoading
              ? "Sign in to spawn bots"
              : progress.phase === "idle" || progress.phase === "done"
                ? loopMode
                  ? `∞ Start loop (${formatNumber(botCount)} per batch)`
                  : `Start swarm (${formatNumber(botCount)} bots)`
                : PHASE_LABEL[progress.phase]}
          </button>
          {/* Tim 2026-06-08: explain why Start is disabled when not
            * signed in. The deep-link drops the user into WhatsApp
            * with the word "login" pre-filled, the same flow used by
            * the magic-link expired/dead-code recovery surface. */}
          {!isSignedIn && !authLoading && (
            <p className="vt-swarm-start-blocked" role="status">
              Bots are owned by the signed-in user that spawned them, so
              your swarm rolls up into one profile across browsers and
              devices. Sign in first:{" "}
              <a
                href={whatsAppLoginDeepLink()}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#fbbf24", textDecoration: "underline" }}
              >
                Text &ldquo;login&rdquo; to Tournamental on WhatsApp
              </a>
              , or use the sign-in pill in the top-right.
            </p>
          )}
          {incognitoBlocked && isSignedIn && (
            <p className="vt-swarm-start-blocked" role="status">
              Start is disabled in a private / incognito window. Acknowledge
              the storage warning above, or enable Supabase replication, to
              run anyway.
            </p>
          )}
          {(progress.phase !== "idle" && progress.phase !== "done") && (
            <button
              type="button"
              className="vt-swarm-button vt-swarm-button--ghost"
              onClick={onStop}
            >
              {loopMode ? "Stop loop" : "Stop"}
            </button>
          )}
          {loopMode && loopIterations > 0 && (
            <p className="vt-swarm-loop-meta">
              Iterations completed this session:{" "}
              <strong>{formatNumber(loopIterations)}</strong>
            </p>
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
        <PicksLine
          picks={progress.picks_made}
          total={botCount * demoMatches.length}
        />
        {progress.phase === "hashing" && progress.hashing && (
          <SealingBanner snap={progress.hashing} />
        )}
        {progress.phase === "committing" && (
          <p className="vt-swarm-sealing-blurb">
            Combining per-match roots into a single swarm proof.
          </p>
        )}
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
        {completionPayload && (
          <MerkleRootCard
            root={completionPayload.merkle_root}
            copied={copiedRoot}
            onCopy={async () => {
              try {
                await navigator.clipboard.writeText(
                  completionPayload.merkle_root,
                );
                setCopiedRoot(true);
                setTimeout(() => setCopiedRoot(false), 2000);
              } catch {
                // No-op; the input is still selectable.
              }
            }}
          />
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

/**
 * Compact "Picks: 95,000 of 111,000 (89%)" line that always reflects
 * the current run so the user has something to look at while workers
 * grind. We show this in both generating and hashing phases — during
 * hashing, picks are fixed at 100%, but the line still anchors the
 * count above the merkle banner.
 */
function PicksLine({
  picks,
  total,
}: {
  picks: number;
  total: number;
}): JSX.Element | null {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((picks / total) * 100));
  return (
    <p
      className="vt-swarm-picks-line"
      style={{
        margin: "10px 0 4px",
        fontFamily:
          '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
        fontSize: 13,
        letterSpacing: "0.02em",
        color: "#b9b9b9",
      }}
    >
      Picks: <strong style={{ color: "#f6c64f" }}>{formatNumber(picks)}</strong>{" "}
      of {formatNumber(total)} ({pct}%)
    </p>
  );
}

/**
 * The "Sealing cryptographic proof" banner that appears once the
 * workers stop generating and start hashing. It surfaces the per-slice,
 * per-level merkle progress so the UI no longer goes quiet during the
 * 5-30s the WebCrypto SHA-256 walk takes for a million-leaf tree.
 *
 * The blurb under the headline is the "this is what makes your swarm
 * auditable" line Tim asked for.
 */
function SealingBanner({ snap }: { snap: HashingSnapshot }): JSX.Element {
  const sliceLine =
    snap.slices_total > 0
      ? `slice ${Math.min(snap.slices_done + 1, snap.slices_total)} of ${snap.slices_total}`
      : null;
  const levelLine =
    snap.total_levels > 0
      ? `level ${Math.min(snap.level + 1, snap.total_levels)} of ${snap.total_levels}`
      : null;
  const remainingLine =
    snap.leaves_remaining > 0
      ? `${formatNumber(snap.leaves_remaining)} hashes left`
      : null;
  const detailParts = [sliceLine, levelLine, remainingLine].filter(
    (s): s is string => s !== null,
  );
  return (
    <div
      className="vt-swarm-sealing"
      role="status"
      style={{
        marginTop: 10,
        padding: "12px 14px",
        border: "1px solid rgba(246, 198, 79, 0.35)",
        borderRadius: 8,
        background: "rgba(246, 198, 79, 0.06)",
      }}
    >
      <p
        className="vt-swarm-sealing-title"
        style={{
          margin: 0,
          color: "#f6c64f",
          fontFamily:
            '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
          fontSize: 13,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Sealing cryptographic proof
        {detailParts.length > 0 && (
          <span
            className="vt-swarm-sealing-detail"
            style={{
              color: "#d6d6d6",
              textTransform: "none",
              letterSpacing: "0.02em",
            }}
          >
            {": "}
            {detailParts.join(", ")}
          </span>
        )}
      </p>
      <p
        className="vt-swarm-sealing-blurb"
        style={{
          margin: "6px 0 0",
          fontSize: 12,
          color: "#a8a8a8",
          lineHeight: 1.5,
        }}
      >
        This is what makes your swarm auditable on the blockchain.
      </p>
    </div>
  );
}

/**
 * Final swarm-merkle-root display card.
 *
 * Shows the full hex root in a monospace, copyable input plus a "What
 * is this?" disclosure that explains the OpenTimestamps + Bitcoin
 * anchor. We intentionally keep the explainer collapsed so the card
 * stays compact for return users who already know the drill.
 */
function MerkleRootCard({
  root,
  copied,
  onCopy,
}: {
  root: string;
  copied: boolean;
  onCopy: () => void;
}): JSX.Element {
  return (
    <div
      className="vt-swarm-root-card"
      style={{
        marginTop: 14,
        padding: "12px 14px",
        border: "1px solid rgba(246, 198, 79, 0.4)",
        borderRadius: 8,
        background: "rgba(246, 198, 79, 0.08)",
      }}
    >
      <div
        className="vt-swarm-root-card-head"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <span
          className="vt-swarm-root-card-label"
          style={{
            color: "#f6c64f",
            fontFamily:
              '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Swarm merkle root (proof)
        </span>
        <button
          type="button"
          className="vt-swarm-button vt-swarm-button--ghost"
          onClick={onCopy}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <input
        readOnly
        className="vt-swarm-root-card-input"
        value={root}
        onFocus={(e) => e.target.select()}
        aria-label="Swarm merkle root, hex string"
        style={{
          width: "100%",
          padding: "8px 10px",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          background: "rgba(0,0,0,0.35)",
          color: "#eaeaea",
          fontFamily:
            '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
          fontSize: 12,
          letterSpacing: "0.02em",
        }}
      />
      <details className="vt-swarm-details" style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", color: "#d6d6d6", fontSize: 12 }}>
          What is this?
        </summary>
        <p style={{ marginTop: 6, fontSize: 12, color: "#a8a8a8", lineHeight: 1.5 }}>
          A single 64-character hex string that commits to every pick
          your swarm just made. Every per-match root commits to every
          per-worker slice root, which commits to every individual
          pick. This root will be anchored to{" "}
          <a
            href="https://opentimestamps.org/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#f6c64f" }}
          >
            OpenTimestamps
          </a>{" "}
          and the Bitcoin blockchain so anyone in the future can prove
          your bots were locked in BEFORE the matches kicked off. No
          retroactive editing, no rewriting history.
        </p>
      </details>
    </div>
  );
}
