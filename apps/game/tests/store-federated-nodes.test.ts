/**
 * FederatedNodeStore , Phase 2 federation registry + per-match
 * aggregate snapshots.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.2
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GameStore } from "../src/store/db.js";
import {
  FederatedNodeStore,
  type FederatedNodeRow,
} from "../src/store/federated-nodes.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

let store: GameStore;
let nodes: FederatedNodeStore;

beforeEach(() => {
  store = new GameStore({ dbPath: ":memory:", migrationsDir: MIGRATIONS_DIR });
  nodes = new FederatedNodeStore(store.db);
});

afterEach(() => store.close());

describe("FederatedNodeStore , registry", () => {
  it("registers a node and returns the row", () => {
    const row = nodes.register({
      node_id: "n_alpha",
      owner_email: "ops@example.com",
      owner_api_key_hash: "hash_alpha",
      public_url: "https://alpha.example.com",
      label: "Alpha Lab swarm",
      now: 1000,
    });
    expect(row.node_id).toBe("n_alpha");
    expect(row.public_url).toBe("https://alpha.example.com");
    expect(row.registered_at).toBe(1000);
  });

  it("getByNodeId returns null on miss", () => {
    expect(nodes.getByNodeId("nope")).toBeNull();
  });

  it("touch updates last_seen_at without changing other fields", () => {
    nodes.register({
      node_id: "n_alpha",
      owner_email: "ops@example.com",
      owner_api_key_hash: "hash_alpha",
      public_url: "https://alpha.example.com",
      now: 1000,
    });
    nodes.touch("n_alpha", 2500);
    const row = nodes.getByNodeId("n_alpha") as FederatedNodeRow;
    expect(row.last_seen_at).toBe(2500);
    expect(row.public_url).toBe("https://alpha.example.com");
  });

  it("getByApiKeyHash returns nodes owned by that key", () => {
    nodes.register({
      node_id: "n_alpha",
      owner_email: "ops@example.com",
      owner_api_key_hash: "hash_one",
      public_url: "https://a.example.com",
      now: 1000,
    });
    nodes.register({
      node_id: "n_beta",
      owner_email: "ops@example.com",
      owner_api_key_hash: "hash_one",
      public_url: "https://b.example.com",
      now: 1100,
    });
    nodes.register({
      node_id: "n_gamma",
      owner_email: "other@example.com",
      owner_api_key_hash: "hash_two",
      public_url: "https://c.example.com",
      now: 1200,
    });
    expect(nodes.getByApiKeyHash("hash_one").map((r) => r.node_id)).toEqual([
      "n_alpha",
      "n_beta",
    ]);
    expect(nodes.getByApiKeyHash("hash_two").map((r) => r.node_id)).toEqual([
      "n_gamma",
    ]);
  });
});

describe("FederatedNodeStore , snapshots", () => {
  beforeEach(() => {
    nodes.register({
      node_id: "n_alpha",
      owner_email: "ops@example.com",
      owner_api_key_hash: "hash_alpha",
      public_url: "https://alpha.example.com",
      now: 1000,
    });
  });

  it("commits a pre-kickoff merkle root", () => {
    nodes.commit({
      node_id: "n_alpha",
      match_id: "1",
      merkle_root: "a".repeat(64),
      kickoff_at: 5000,
      bot_count: 12_345,
      now: 1500,
    });
    const row = nodes.getSnapshot("n_alpha", "1");
    expect(row?.merkle_root).toBe("a".repeat(64));
    expect(row?.kickoff_at).toBe(5000);
    expect(row?.total_bots).toBe(12_345);
    expect(row?.bots_correct).toBeNull();
    expect(row?.submitted_at).toBe(1500);
  });

  it("records a post-match leaderboard report", () => {
    nodes.commit({
      node_id: "n_alpha",
      match_id: "1",
      merkle_root: "a".repeat(64),
      kickoff_at: 5000,
      bot_count: 1000,
      now: 1500,
    });
    nodes.reportLeaderboard({
      node_id: "n_alpha",
      match_id: "1",
      total_bots: 1000,
      bots_correct: 612,
      bots_still_perfect: 612,
      top: [
        { bot_id: "bot_a", score: 1 },
        { bot_id: "bot_b", score: 1 },
      ],
      now: 6000,
    });
    const row = nodes.getSnapshot("n_alpha", "1");
    expect(row?.bots_correct).toBe(612);
    expect(row?.bots_still_perfect).toBe(612);
    expect(row?.merkle_root).toBe("a".repeat(64));
    expect(JSON.parse(row!.top_json_blob!)).toHaveLength(2);
  });

  it("reportLeaderboard without prior commit still works (Phase 2 late join)", () => {
    nodes.reportLeaderboard({
      node_id: "n_alpha",
      match_id: "2",
      total_bots: 500,
      bots_correct: 300,
      bots_still_perfect: 300,
      top: [],
      now: 7000,
    });
    const row = nodes.getSnapshot("n_alpha", "2");
    expect(row?.total_bots).toBe(500);
    expect(row?.merkle_root).toBeNull();
  });

  it("listSnapshotsForMatch returns rows from every node", () => {
    nodes.register({
      node_id: "n_beta",
      owner_email: "ops@example.com",
      owner_api_key_hash: "hash_beta",
      public_url: "https://beta.example.com",
      now: 1000,
    });
    nodes.reportLeaderboard({
      node_id: "n_alpha",
      match_id: "1",
      total_bots: 10,
      bots_correct: 5,
      bots_still_perfect: 5,
      top: [{ bot_id: "bot_a", score: 1 }],
      now: 6000,
    });
    nodes.reportLeaderboard({
      node_id: "n_beta",
      match_id: "1",
      total_bots: 20,
      bots_correct: 11,
      bots_still_perfect: 11,
      top: [{ bot_id: "bot_x", score: 1 }],
      now: 6100,
    });
    const rows = nodes.listSnapshotsForMatch("1");
    expect(rows.map((r) => r.node_id).sort()).toEqual(["n_alpha", "n_beta"]);
  });
});
