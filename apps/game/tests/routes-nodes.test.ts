/**
 * Federation endpoints , Phase 2 forward-compat surface.
 *
 *   POST /v1/nodes/register   , issue node credentials
 *   POST /v1/nodes/commit     , pre-kickoff merkle commitment
 *   POST /v1/nodes/leaderboard, post-match aggregate report
 *   GET  /v1/leaderboard?source=federated , merged top-K view
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeServer } from "./helpers.js";

describe("POST /v1/nodes/register", () => {
  const built = makeServer({ cacheTtlMs: 50 });
  let ownerKey = "";

  beforeAll(async () => {
    const { store } = await built;
    const issued = store.apiKeys.issue({
      owner_email: "ops@example.com",
      label: "node-operator",
    });
    ownerKey = issued.api_key;
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("rejects requests without an API key", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      payload: {
        owner_email: "ops@example.com",
        public_url: "https://alpha.example.com",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("issues node credentials and returns the node_id + node_key", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      headers: { authorization: `Bearer ${ownerKey}` },
      payload: {
        owner_email: "ops@example.com",
        public_url: "https://alpha.example.com",
        label: "Alpha swarm",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.node_id).toMatch(/^node_/);
    expect(body.node_key).toMatch(/^tnm_/);
    expect(body.public_url).toBe("https://alpha.example.com");
  });

  it("rejects malformed URLs with 400", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      headers: { authorization: `Bearer ${ownerKey}` },
      payload: {
        owner_email: "ops@example.com",
        public_url: "not-a-url",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/nodes/commit + /leaderboard", () => {
  const built = makeServer({ cacheTtlMs: 50 });
  let nodeId = "";
  let nodeKey = "";

  beforeAll(async () => {
    const { store, app } = await built;
    const ownerIssued = store.apiKeys.issue({
      owner_email: "ops@example.com",
      label: "node-operator",
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      headers: { authorization: `Bearer ${ownerIssued.api_key}` },
      payload: {
        owner_email: "ops@example.com",
        public_url: "https://alpha.example.com",
        label: "Alpha swarm",
      },
    });
    nodeId = res.json().node_id;
    nodeKey = res.json().node_key;
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("commit rejects without a node key", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/commit",
      payload: {
        node_id: nodeId,
        match_id: "1",
        merkle_root: "a".repeat(64),
        bot_count: 100,
        kickoff_at: Date.now() + 60_000,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("commit accepts a valid pre-kickoff payload", async () => {
    const { app, store } = await built;
    const kickoffAt = Date.now() + 60_000;
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/commit",
      headers: { authorization: `Bearer ${nodeKey}` },
      payload: {
        node_id: nodeId,
        match_id: "1",
        merkle_root: "a".repeat(64),
        bot_count: 100,
        kickoff_at: kickoffAt,
      },
    });
    expect(res.statusCode).toBe(200);
    const row = store.federatedNodes.getSnapshot(nodeId, "1");
    expect(row?.merkle_root).toBe("a".repeat(64));
    expect(row?.kickoff_at).toBe(kickoffAt);
    expect(row?.total_bots).toBe(100);
  });

  it("commit rejects merkle_root that is not 64 hex chars", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/commit",
      headers: { authorization: `Bearer ${nodeKey}` },
      payload: {
        node_id: nodeId,
        match_id: "2",
        merkle_root: "not-hex",
        bot_count: 100,
        kickoff_at: Date.now() + 60_000,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("commit rejects late submissions (kickoff in the past)", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/commit",
      headers: { authorization: `Bearer ${nodeKey}` },
      payload: {
        node_id: nodeId,
        match_id: "late_match",
        merkle_root: "b".repeat(64),
        bot_count: 100,
        kickoff_at: Date.now() - 60_000,
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("kickoff_passed");
  });

  it("commit refuses when the node_id does not belong to the auth key", async () => {
    const { app, store } = await built;
    const intruder = store.apiKeys.issue({ owner_email: "evil@example.com" });
    const otherNode = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      headers: { authorization: `Bearer ${intruder.api_key}` },
      payload: {
        owner_email: "evil@example.com",
        public_url: "https://evil.example.com",
      },
    });
    const otherKey = otherNode.json().node_key as string;
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/commit",
      headers: { authorization: `Bearer ${otherKey}` },
      payload: {
        node_id: nodeId,
        match_id: "3",
        merkle_root: "c".repeat(64),
        bot_count: 1,
        kickoff_at: Date.now() + 60_000,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("leaderboard accepts a post-match aggregate report", async () => {
    const { app, store } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/leaderboard",
      headers: { authorization: `Bearer ${nodeKey}` },
      payload: {
        node_id: nodeId,
        match_id: "1",
        total_bots: 100,
        bots_correct: 62,
        bots_still_perfect: 62,
        top_1000: [
          { bot_id: "bot_a", score: 1 },
          { bot_id: "bot_b", score: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const row = store.federatedNodes.getSnapshot(nodeId, "1");
    expect(row?.bots_correct).toBe(62);
    expect(row?.bots_still_perfect).toBe(62);
    expect(row?.merkle_root).toBe("a".repeat(64));
  });

  it("leaderboard rejects top_1000 over 1000 rows", async () => {
    const { app } = await built;
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({
      bot_id: `bot_${i}`,
      score: 1,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/nodes/leaderboard",
      headers: { authorization: `Bearer ${nodeKey}` },
      payload: {
        node_id: nodeId,
        match_id: "4",
        total_bots: 1000,
        bots_correct: 500,
        bots_still_perfect: 500,
        top_1000: tooMany,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
