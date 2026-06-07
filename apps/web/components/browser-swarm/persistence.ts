/**
 * IndexedDB persistence for the browser swarm.
 *
 * Default storage when the user hasn't connected a Supabase project.
 * Schema mirrors the central server tables so a future export-to-supabase
 * flow is a straight `INSERT INTO ... SELECT *` rather than a shape
 * migration:
 *
 *   - bot:          { bot_id, seed, strategy, chalk_score, created_at }
 *   - bot_pick:     { bot_id, match_id, outcome, chalk_score, locked_at_utc, committed_at_utc }
 *   - commit_log:   { match_id, merkle_root, bot_count, kickoff_at_utc, committed_at_utc, central_ack_at_utc }
 *   - node_creds:   { node_id, node_secret, operator_email, central_base_url, registered_at_utc }
 *
 * IndexedDB is the only storage that survives a page refresh in the
 * pure-browser setup. We don't try to be clever about it: write each
 * record as a separate row keyed by its natural key, then let the
 * federation layer read-and-roll-up at commit time.
 */

import type {
  BotPick,
  BotRecord,
  CommitLogRow,
  NodeCredentials,
} from "./types";

const DB_NAME = "tournamental-browser-swarm";
const DB_VERSION = 3; // bumped from 2 → 3 (added STORE_DEVICE).

/**
 * Fixture-content version. Bump whenever the match catalogue or the
 * MASTER_SEED shipped in `regenerate.ts` changes in a way that would
 * make previously-stored bots regenerate to different brackets.
 *
 * On load, if the stored version differs from this constant, we
 * `reset()` the swarm stores. This is the "Tim hit 111k fake-fixture
 * bots and wants them wiped" mechanic (2026-06-07).
 *
 * Tim's hard rule: when this bumps, surface a one-line toast on the
 * /run page so users see WHY their count went back to 0.
 */
export const SWARM_FIXTURE_VERSION = "v2-fifa-2026-real-fixtures";

const STORE_BOT = "bot";
const STORE_PICK = "bot_pick";
const STORE_COMMIT = "commit_log";
const STORE_CREDS = "node_creds";
// Tim 2026-06-07: persistent counter for cumulative swarm across button
// presses + tab reopens. Single row keyed "swarm" with next_bot_index +
// total_bots_generated + last_committed_at + fixture_version.
const STORE_SWARM_STATE = "swarm_state";
// Tim 2026-06-07: stable per-browser identity so the server can
// aggregate this device's swarm under the user's profile. Single row
// keyed "self" with { device_id, label, created_at, last_seen_at }.
const STORE_DEVICE = "device";

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error("IndexedDB not available in this environment"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOT)) {
        db.createObjectStore(STORE_BOT, { keyPath: "bot_id" });
      }
      if (!db.objectStoreNames.contains(STORE_PICK)) {
        const picks = db.createObjectStore(STORE_PICK, {
          keyPath: ["bot_id", "match_id"],
        });
        picks.createIndex("by_match", "match_id", { unique: false });
        picks.createIndex("by_bot", "bot_id", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_COMMIT)) {
        db.createObjectStore(STORE_COMMIT, { keyPath: "match_id" });
      }
      if (!db.objectStoreNames.contains(STORE_CREDS)) {
        db.createObjectStore(STORE_CREDS, { keyPath: "node_id" });
      }
      if (!db.objectStoreNames.contains(STORE_SWARM_STATE)) {
        db.createObjectStore(STORE_SWARM_STATE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_DEVICE)) {
        db.createObjectStore(STORE_DEVICE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function writeMany<T>(
  storeName: string,
  rows: readonly T[],
): Promise<void> {
  if (rows.length === 0) return;
  if (!isIndexedDBAvailable()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      for (const row of rows) {
        store.put(row);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
    });
  } finally {
    db.close();
  }
}

async function readAll<T>(storeName: string): Promise<T[]> {
  if (!isIndexedDBAvailable()) return [];
  const db = await openDb();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    });
  } finally {
    db.close();
  }
}

async function clearStore(storeName: string): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"));
    });
  } finally {
    db.close();
  }
}

export interface SwarmState {
  /** Index of the next bot to generate (0 on a fresh DB). Each run
   * starts from here and writes back next_bot_index = previous + run_size. */
  next_bot_index: number;
  /** Cumulative count of bots ever generated in this swarm. Mirrors
   * next_bot_index but kept separately for clarity in UI. */
  total_bots_generated: number;
  /** ISO timestamp of last successful batch persist. */
  last_run_at_utc: string | null;
  /** Total committed batches (post-kickoff merkle roots posted). */
  batches_committed: number;
  /**
   * The SWARM_FIXTURE_VERSION the stored bots are valid for. When the
   * code-side constant moves on (real-fixture bump, MASTER_SEED bump,
   * leaf-format change) any older stored state is auto-wiped on load.
   * Empty string on a fresh DB; loadSwarmState() handles the version
   * check before returning. Tim 2026-06-07.
   */
  fixture_version: string;
  /**
   * User-anchored swarm slider weight in [0, 1]. Default 0 = pure
   * chalk + uniqueness; 0.4 = soft, 0.75 = strong, 1.0 = lockstep.
   * Persisted across tab close so the slider position survives. A11
   * Phase 2, 2026-06-07.
   */
  anchor_weight: number;
  /**
   * SHA256-ish hash of the user's bracket as captured at the most
   * recent batch generation time. Recorded so the UI can show "this
   * batch was anchored to bracket version <hash>". Each NEW batch
   * captures whatever bracket is live at that moment; committed
   * batches stay locked to the snapshot they used.
   */
  last_anchor_hash: string | null;
}

/**
 * Stable per-browser identity. Mirrors the server-side aggregate
 * contract: every device's swarm uploads under this `device_id` so
 * the user profile can roll up "1.1M bots across 3 devices, 200k
 * still alive after match 23". See docs/internal/multi-device-
 * aggregate-contract.md for the JSON envelope the federation layer
 * builds from this + SwarmState. Tim 2026-06-07.
 */
export interface DeviceIdentity {
  /** UUID-v4 string generated on first launch and never rotated. */
  device_id: string;
  /** Optional human label ("Tim's MacBook", "iPhone"). Defaults to
   * navigator.userAgent-derived short string. User-editable. */
  label: string;
  /** ISO timestamp of first launch. */
  created_at_utc: string;
  /** ISO timestamp of most recent /run page load. The server uses
   * this to mark a device offline if no heartbeat in N hours. */
  last_seen_at_utc: string;
}

function generateDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID. Not as good
  // entropy but the device_id only needs to be unique per user.
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += hex[Math.floor(Math.random() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) out += "-";
  }
  return out;
}

function shortPlatformLabel(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Browser";
}

/** Returned by loadSwarmState so the caller knows whether the load
 * dropped a stale fixture-version's data. Tim 2026-06-07. */
export interface SwarmStateLoad {
  state: SwarmState;
  /** True on the first load after a fixture-version bump; the /run
   * page surfaces a "Swarm reset because picks are now coming from
   * real FIFA 2026 fixtures" toast. */
  reset_for_version_change: boolean;
  /** The version we're now on. */
  current_fixture_version: string;
}

export interface Persistence {
  saveBots(bots: readonly BotRecord[]): Promise<void>;
  savePicks(picks: readonly BotPick[]): Promise<void>;
  saveCommit(row: CommitLogRow): Promise<void>;
  saveCredentials(creds: NodeCredentials): Promise<void>;
  loadCredentials(): Promise<NodeCredentials | null>;
  countBots(): Promise<number>;
  countPicks(): Promise<number>;
  /**
   * Read the persistent swarm cursor. On a fresh DB returns zeros.
   * If the stored fixture_version differs from SWARM_FIXTURE_VERSION,
   * calls reset() (preserving credentials + device identity) and
   * returns `reset_for_version_change: true` so the UI can toast.
   */
  loadSwarmState(): Promise<SwarmStateLoad>;
  /** Persist the swarm cursor after a successful run. Always stamps
   * the current SWARM_FIXTURE_VERSION onto the row. */
  saveSwarmState(state: Omit<SwarmState, "fixture_version">): Promise<void>;
  /**
   * Load (or create on first launch) this device's identity. Stable
   * across sessions; uploaded to the server alongside every swarm
   * commit so the user profile can aggregate across devices.
   */
  loadDeviceIdentity(): Promise<DeviceIdentity>;
  /** Update last_seen_at_utc (and optionally a renamed label). */
  touchDeviceIdentity(args?: { label?: string }): Promise<DeviceIdentity>;
  reset(): Promise<void>;
}

export const indexedDbPersistence: Persistence = {
  async saveBots(bots) {
    await writeMany(STORE_BOT, bots);
  },
  async savePicks(picks) {
    await writeMany(STORE_PICK, picks);
  },
  async saveCommit(row) {
    await writeMany(STORE_COMMIT, [row]);
  },
  async saveCredentials(creds) {
    await writeMany(STORE_CREDS, [creds]);
  },
  async loadCredentials() {
    const all = await readAll<NodeCredentials>(STORE_CREDS);
    return all[0] ?? null;
  },
  async countBots() {
    const all = await readAll<BotRecord>(STORE_BOT);
    return all.length;
  },
  async countPicks() {
    const all = await readAll<BotPick>(STORE_PICK);
    return all.length;
  },
  async loadSwarmState() {
    const empty: SwarmState = {
      next_bot_index: 0,
      total_bots_generated: 0,
      last_run_at_utc: null,
      batches_committed: 0,
      fixture_version: SWARM_FIXTURE_VERSION,
      anchor_weight: 0,
      last_anchor_hash: null,
    };
    if (!isIndexedDBAvailable()) {
      return {
        state: empty,
        reset_for_version_change: false,
        current_fixture_version: SWARM_FIXTURE_VERSION,
      };
    }
    const db = await openDb();
    let row: any;
    try {
      row = await new Promise<any>((resolve, reject) => {
        const tx = db.transaction(STORE_SWARM_STATE, "readonly");
        const req = tx.objectStore(STORE_SWARM_STATE).get("swarm");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
      });
    } finally {
      db.close();
    }
    if (!row) {
      return {
        state: empty,
        reset_for_version_change: false,
        current_fixture_version: SWARM_FIXTURE_VERSION,
      };
    }
    // If the stored state is from a previous fixture version, drop
    // bot / pick / commit data. Device identity + credentials stay so
    // the next swarm still uploads under the same device_id (the
    // server treats it as the same device starting a new swarm).
    if ((row.fixture_version ?? "") !== SWARM_FIXTURE_VERSION) {
      await clearStore(STORE_BOT);
      await clearStore(STORE_PICK);
      await clearStore(STORE_COMMIT);
      await clearStore(STORE_SWARM_STATE);
      return {
        state: empty,
        reset_for_version_change: true,
        current_fixture_version: SWARM_FIXTURE_VERSION,
      };
    }
    return {
      state: {
        next_bot_index: row.next_bot_index ?? 0,
        total_bots_generated: row.total_bots_generated ?? 0,
        last_run_at_utc: row.last_run_at_utc ?? null,
        batches_committed: row.batches_committed ?? 0,
        fixture_version: row.fixture_version,
        anchor_weight: typeof row.anchor_weight === "number" ? row.anchor_weight : 0,
        last_anchor_hash:
          typeof row.last_anchor_hash === "string" ? row.last_anchor_hash : null,
      },
      reset_for_version_change: false,
      current_fixture_version: SWARM_FIXTURE_VERSION,
    };
  },
  async saveSwarmState(state) {
    await writeMany(STORE_SWARM_STATE, [
      { key: "swarm", ...state, fixture_version: SWARM_FIXTURE_VERSION },
    ]);
  },
  async loadDeviceIdentity() {
    const now = new Date().toISOString();
    if (!isIndexedDBAvailable()) {
      return {
        device_id: "no-storage",
        label: shortPlatformLabel(),
        created_at_utc: now,
        last_seen_at_utc: now,
      };
    }
    const db = await openDb();
    let row: any;
    try {
      row = await new Promise<any>((resolve, reject) => {
        const tx = db.transaction(STORE_DEVICE, "readonly");
        const req = tx.objectStore(STORE_DEVICE).get("self");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
      });
    } finally {
      db.close();
    }
    if (row && typeof row.device_id === "string" && row.device_id) {
      return {
        device_id: row.device_id,
        label: row.label ?? shortPlatformLabel(),
        created_at_utc: row.created_at_utc ?? now,
        last_seen_at_utc: row.last_seen_at_utc ?? now,
      };
    }
    // First launch: mint a fresh device_id and persist.
    const fresh: DeviceIdentity = {
      device_id: generateDeviceId(),
      label: shortPlatformLabel(),
      created_at_utc: now,
      last_seen_at_utc: now,
    };
    await writeMany(STORE_DEVICE, [{ key: "self", ...fresh }]);
    return fresh;
  },
  async touchDeviceIdentity(args) {
    const existing = await this.loadDeviceIdentity();
    const next: DeviceIdentity = {
      ...existing,
      label: args?.label ?? existing.label,
      last_seen_at_utc: new Date().toISOString(),
    };
    await writeMany(STORE_DEVICE, [{ key: "self", ...next }]);
    return next;
  },
  async reset() {
    await clearStore(STORE_BOT);
    await clearStore(STORE_PICK);
    await clearStore(STORE_COMMIT);
    await clearStore(STORE_SWARM_STATE);
    // Deliberately preserve credentials AND device identity so a
    // returning user keeps their device_id and the server keeps
    // aggregating under the same key.
  },
};

/**
 * No-op persistence used in environments without IndexedDB (server
 * rendering, SSR, tests). The swarm will still run; nothing survives a
 * refresh.
 */
export const noopPersistence: Persistence = {
  async saveBots() {},
  async savePicks() {},
  async saveCommit() {},
  async saveCredentials() {},
  async loadCredentials() {
    return null;
  },
  async countBots() {
    return 0;
  },
  async countPicks() {
    return 0;
  },
  async loadSwarmState() {
    return {
      state: {
        next_bot_index: 0,
        total_bots_generated: 0,
        last_run_at_utc: null,
        batches_committed: 0,
        fixture_version: SWARM_FIXTURE_VERSION,
        anchor_weight: 0,
        last_anchor_hash: null,
      },
      reset_for_version_change: false,
      current_fixture_version: SWARM_FIXTURE_VERSION,
    };
  },
  async saveSwarmState() {},
  async loadDeviceIdentity() {
    const now = new Date().toISOString();
    return {
      device_id: "no-storage",
      label: shortPlatformLabel(),
      created_at_utc: now,
      last_seen_at_utc: now,
    };
  },
  async touchDeviceIdentity() {
    const now = new Date().toISOString();
    return {
      device_id: "no-storage",
      label: shortPlatformLabel(),
      created_at_utc: now,
      last_seen_at_utc: now,
    };
  },
  async reset() {},
};

export function defaultPersistence(): Persistence {
  return isIndexedDBAvailable() ? indexedDbPersistence : noopPersistence;
}
