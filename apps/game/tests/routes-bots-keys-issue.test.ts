/**
 * POST /v1/bots/keys/issue , service-to-service issuance endpoint.
 *
 * The Next.js web proxy uses this to mint Bot Arena keys for
 * non-Supabase auth users (SMS-OTP, Telegram) , the existing
 * /v1/me/api-keys flow requires a Supabase JWT and would no-op for
 * those users.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeServer } from "./helpers.js";

const SHARED_SECRET = "test-shared-secret-90909";

describe("POST /v1/bots/keys/issue", () => {
  const previousEnv = process.env.GAME_BOT_KEYS_SHARED_SECRET;
  const built = makeServer({ cacheTtlMs: 50 });

  beforeAll(() => {
    process.env.GAME_BOT_KEYS_SHARED_SECRET = SHARED_SECRET;
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
    if (previousEnv === undefined) {
      delete process.env.GAME_BOT_KEYS_SHARED_SECRET;
    } else {
      process.env.GAME_BOT_KEYS_SHARED_SECRET = previousEnv;
    }
  });

  it("issues a key when the shared secret matches", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bots/keys/issue",
      headers: {
        "x-bot-keys-shared-secret": SHARED_SECRET,
        "content-type": "application/json",
      },
      payload: { owner_email: "tim@example.com", label: "primary" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.api_key).toBe("string");
    expect(body.api_key).toMatch(/^tnm_/);
    expect(typeof body.key_hash).toBe("string");
    expect(body.owner_email).toBe("tim@example.com");
    expect(body.label).toBe("primary");
    expect(body.quota_bots).toBe(1000);
    expect(body.quota_picks_per_hour).toBe(100_000);
    expect(typeof body.created_at).toBe("number");
  });

  it("lifts quotas for academic emails (.edu)", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bots/keys/issue",
      headers: {
        "x-bot-keys-shared-secret": SHARED_SECRET,
        "content-type": "application/json",
      },
      payload: { owner_email: "researcher@mit.edu" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.quota_bots).toBe(10_000);
    expect(body.quota_picks_per_hour).toBe(1_000_000);
  });

  it("lifts quotas for .ac.uk / .ac.nz / .edu.au / .ac.za", async () => {
    const { app } = await built;
    const domains = [
      "ac.uk",
      "ac.nz",
      "edu.au",
      "ac.za",
    ];
    for (const d of domains) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/bots/keys/issue",
        headers: {
          "x-bot-keys-shared-secret": SHARED_SECRET,
          "content-type": "application/json",
        },
        payload: { owner_email: `dev@uni.${d}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.quota_bots).toBe(10_000);
    }
  });

  it("rejects with 401 when the shared secret is missing", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bots/keys/issue",
      headers: { "content-type": "application/json" },
      payload: { owner_email: "tim@example.com", label: "x" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("missing_secret");
  });

  it("rejects with 401 when the shared secret does not match", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bots/keys/issue",
      headers: {
        "x-bot-keys-shared-secret": "wrong-value-90909",
        "content-type": "application/json",
      },
      payload: { owner_email: "tim@example.com", label: "x" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_secret");
  });

  it("rejects with 400 when owner_email is missing", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bots/keys/issue",
      headers: {
        "x-bot-keys-shared-secret": SHARED_SECRET,
        "content-type": "application/json",
      },
      payload: { label: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_email");
  });

  it("rejects with 400 when owner_email is malformed", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bots/keys/issue",
      headers: {
        "x-bot-keys-shared-secret": SHARED_SECRET,
        "content-type": "application/json",
      },
      payload: { owner_email: "not-an-email", label: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_email");
  });

  it("rejects with 400 when label is too long", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bots/keys/issue",
      headers: {
        "x-bot-keys-shared-secret": SHARED_SECRET,
        "content-type": "application/json",
      },
      payload: {
        owner_email: "tim@example.com",
        label: "x".repeat(200),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("label_too_long");
  });

  it("the freshly minted key authenticates against /v1/picks/bulk", async () => {
    const { app, store } = await built;
    const mintRes = await app.inject({
      method: "POST",
      url: "/v1/bots/keys/issue",
      headers: {
        "x-bot-keys-shared-secret": SHARED_SECRET,
        "content-type": "application/json",
      },
      payload: { owner_email: "smoke@example.com", label: "smoke" },
    });
    expect(mintRes.statusCode).toBe(200);
    const apiKey = mintRes.json().api_key as string;
    expect(apiKey).toMatch(/^tnm_/);
    // Claim a bot id under this key so the /v1/picks/bulk ownership
    // check passes.
    store.db
      .prepare(`INSERT INTO users (id, created_at, is_bot) VALUES (?, 1, 1)`)
      .run("smoke-bot-1");
    const keyRow = store.apiKeys.lookupByPlain(apiKey);
    expect(keyRow).not.toBeNull();
    store.botOwners.claim({
      bot_id: "smoke-bot-1",
      api_key_hash: keyRow!.key_hash,
      owner_email: "smoke@example.com",
    });
    const bulk = await app.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [
          {
            bot_id: "smoke-bot-1",
            picks: [{ match_id: "1", outcome: "home_win" }],
          },
        ],
      },
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().accepted).toBe(1);
  });
});

describe("POST /v1/bots/keys/issue (secret not configured)", () => {
  const previousEnv = process.env.GAME_BOT_KEYS_SHARED_SECRET;
  const built = makeServer({ cacheTtlMs: 50 });

  beforeAll(() => {
    delete process.env.GAME_BOT_KEYS_SHARED_SECRET;
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
    if (previousEnv !== undefined) {
      process.env.GAME_BOT_KEYS_SHARED_SECRET = previousEnv;
    }
  });

  it("refuses with 503 when the secret env var is unset", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bots/keys/issue",
      headers: {
        "x-bot-keys-shared-secret": "anything",
        "content-type": "application/json",
      },
      payload: { owner_email: "tim@example.com", label: "x" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("issuance_disabled");
  });
});
