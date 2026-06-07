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
const DB_VERSION = 1;

const STORE_BOT = "bot";
const STORE_PICK = "bot_pick";
const STORE_COMMIT = "commit_log";
const STORE_CREDS = "node_creds";

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

export interface Persistence {
  saveBots(bots: readonly BotRecord[]): Promise<void>;
  savePicks(picks: readonly BotPick[]): Promise<void>;
  saveCommit(row: CommitLogRow): Promise<void>;
  saveCredentials(creds: NodeCredentials): Promise<void>;
  loadCredentials(): Promise<NodeCredentials | null>;
  countBots(): Promise<number>;
  countPicks(): Promise<number>;
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
  async reset() {
    await clearStore(STORE_BOT);
    await clearStore(STORE_PICK);
    await clearStore(STORE_COMMIT);
    // Deliberately preserve credentials so a returning user keeps their node_id.
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
  async reset() {},
};

export function defaultPersistence(): Persistence {
  return isIndexedDBAvailable() ? indexedDbPersistence : noopPersistence;
}
