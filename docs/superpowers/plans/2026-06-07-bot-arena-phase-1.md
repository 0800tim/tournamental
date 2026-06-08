# Tournamental Bot Arena, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 1 Open Bot Arena (18k seed bots populating the leaderboard, `Humans / Bots / My Pools` tabs, public Node SDK, bulk-insert API with auth + quota, reference Sage bot, documentation page, terms clause) by **09 June 2026 EOD** so two QA days remain before kickoff on 11 June.

**Architecture:** Two parallel streams that join at the SDK-to-bulk-insert-API boundary. Stream A extends `apps/auth-sms` and `apps/game` with the `is_bot` marker, three new tables (`bot_owner`, `api_key`, `quota_window`), a `POST /v1/picks/bulk` endpoint, a scope-filtered leaderboard query, and the leaderboard cache. Stream B builds the `@tournamental/bot-sdk` Node package, tabs the `/leaderboard` page, ships a `/bots/sdk` developer docs page, a `/bots/keys` self-service issuance page, the `/terms/house-prize` clause update, the `apps/seed-bots` CLI, and the reference `apps/sage` bot. Forward-compatibility hooks for Phase 2 federation (merkle-shaped OTS commitment, `committed_at_utc` on every pick row, federated-tier-compatible tuple shape) are baked in from Task 6 onward.

**Tech Stack:** TypeScript, Fastify (game-service), better-sqlite3, Zod, Next.js 14 (app router, web), pnpm workspaces, vitest, tsup, PM2, Apache 2.0 licence.

**Spec source:** `docs/superpowers/specs/2026-06-07-bot-arena-design.md` (branch `spec/bot-arena`, commit `f14b1b6`).

**Conventions:** Conventional Commits with `-s` sign-off. Author: `Tim Thomas <0800tim@gmail.com>`. NZ English. No em-dashes anywhere (Tim's hard rule). Internal docs go to `docs/internal/` (gitignored). Engineering specs and plans go to `docs/superpowers/specs/` and `docs/superpowers/plans/` respectively (tracked).

---

## File map

**Created:**

| Path | Purpose |
|---|---|
| `apps/auth-sms/migrations/0005-add-is-bot.sql` | Adds `is_bot INTEGER NOT NULL DEFAULT 0` to user table + index. |
| `apps/game/migrations/0009-bot-arena.sql` | Adds `bot_owner`, `api_key`, `quota_window` tables, `users.is_bot`, `brackets.committed_at_utc`, and indices. |
| `apps/game/src/store/bot-owners.ts` | DAO for `bot_owner` table. |
| `apps/game/src/store/api-keys.ts` | DAO for `api_key` table (hashing, lookup, revocation). |
| `apps/game/src/store/quotas.ts` | DAO for `quota_window` table (sliding-hour quotas). |
| `apps/game/src/routes/picks-bulk.ts` | `POST /v1/picks/bulk` endpoint. |
| `apps/game/src/services/leaderboard-cache.ts` | In-memory LRU with TTL + match-completed invalidation. |
| `apps/game/src/lib/merkle.ts` | Merkle-tree helper for Phase 2 forward-compat OTS commitment. |
| `apps/game/src/routes/leaderboard-my-pools.ts` | `GET /v1/leaderboard/my-pools` endpoint. |
| `packages/bot-sdk/package.json` | Package manifest. |
| `packages/bot-sdk/tsup.config.ts` | Build config. |
| `packages/bot-sdk/tsconfig.json` | TypeScript config. |
| `packages/bot-sdk/src/index.ts` | Public API surface. |
| `packages/bot-sdk/src/client.ts` | HTTP client with retries + backoff. |
| `packages/bot-sdk/src/auth.ts` | API key handling. |
| `packages/bot-sdk/src/types.ts` | Shared types (mirrors `@tournamental/spec`). |
| `packages/bot-sdk/src/bot.ts` | `Bot` class. |
| `packages/bot-sdk/src/swarm.ts` | `Swarm` helper. |
| `packages/bot-sdk/src/bulk.ts` | Bulk submission helper. |
| `packages/bot-sdk/examples/01-simple-chalk.ts` | 50-line follow-odds bot. |
| `packages/bot-sdk/examples/02-claude-bot.ts` | Anthropic-powered bot. |
| `packages/bot-sdk/examples/03-gpt-bot.ts` | OpenAI-powered bot. |
| `packages/bot-sdk/examples/04-swarm.ts` | 1,000-bot swarm. |
| `packages/bot-sdk/examples/05-polymarket-arb.ts` | Polymarket arbitrage. |
| `packages/bot-sdk/examples/06-kelly.ts` | Kelly-criterion sizing. |
| `packages/bot-sdk/examples/07-ensemble.ts` | Ensemble of strategies. |
| `packages/bot-sdk/examples/08-post-tournament-bestof.ts` | Best-of-N swarm with merging. |
| `packages/bot-sdk/README.md` | Package README. |
| `apps/web/app/leaderboard/page.tsx` | Modified to render the three tabs. |
| `apps/web/app/leaderboard/LeaderboardTabs.tsx` | New client component for tab switching. |
| `apps/web/app/api/v1/leaderboard/my-pools/route.ts` | Next route proxy to game-service my-pools endpoint. |
| `apps/web/app/bots/sdk/page.tsx` | SDK developer documentation page. |
| `apps/web/app/bots/sdk/sdk.css` | Page styles. |
| `apps/web/app/bots/keys/page.tsx` | Self-service API key issuance page. |
| `apps/web/app/bots/keys/IssueKeyForm.tsx` | Client component. |
| `apps/web/app/api/v1/bots/keys/route.ts` | API key issuance handler. |
| `apps/seed-bots/package.json` | New app manifest. |
| `apps/seed-bots/tsconfig.json` | |
| `apps/seed-bots/src/index.ts` | CLI entry. |
| `apps/seed-bots/src/seed.ts` | Pipeline orchestrator. |
| `apps/seed-bots/src/names.ts` | Country-weighted name generator. |
| `apps/seed-bots/src/avatars.ts` | Avatar pool picker. |
| `apps/seed-bots/src/brackets.ts` | Per-bot bracket generator. |
| `apps/seed-bots/src/timeline.ts` | `created_at` + save-event generator. |
| `apps/seed-bots/src/personalities.ts` | Chalk score + engagement tier roller. |
| `apps/seed-bots/src/write.ts` | DB writer (auth-sms, identity, game). |
| `apps/seed-bots/data/names/*.json` | Public-domain name corpora per country. |
| `apps/seed-bots/data/odds-snapshot.json` | Frozen odds snapshot. |
| `apps/sage/package.json` | New app manifest. |
| `apps/sage/src/index.ts` | Reference bot entry. |
| `apps/sage/src/strategy.ts` | Pick decision logic. |
| `apps/sage/ecosystem.config.cjs` | PM2 config. |

**Modified:**

| Path | Change |
|---|---|
| `apps/auth-sms/src/storage.ts` | Add `is_bot` field to `UserRecord`, surface getter/setter helpers. |
| `apps/game/src/store/db.ts` | Wire new DAOs into the store; add `committed_at_utc` to bracket payload. |
| `apps/game/src/routes/leaderboard.ts` | Accept `?scope=humans\|bots\|all` and filter. |
| `apps/game/src/server.ts` | Register new routes. |
| `apps/game/src/lib/vstamp-commit.ts` (or equivalent OTS-commit module) | Refactor to build a merkle tree per match before committing. |
| `apps/web/components/leaderboard/Leaderboard.tsx` | Add `scope` prop. |
| `apps/web/app/terms/house-prize/page.tsx` | Add bot clause. |
| `apps/web/components/shell/nav-links.tsx` | Add Bot Arena to MORE_DESKTOP. |
| `docs/20-identity-humanness-bots.md` | Add cross-reference to Bot Arena. |
| `pnpm-workspace.yaml` | Add new apps + package. |

**Tests:**

Every code task ships with at least one failing test first. Test files mirror the source path under `__tests__/` or `test/` per the existing convention of each package.

---

# Stream A: Game-Service Backend

## Task 1: Add `is_bot` column to auth-sms user table

**Files:**
- Create: `apps/auth-sms/migrations/0005-add-is-bot.sql`
- Modify: `apps/auth-sms/src/storage.ts:61-89` (UserRecord interface + insert/update statements)
- Test: `apps/auth-sms/test/storage-is-bot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/auth-sms/test/storage-is-bot.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../src/storage.js";

describe("UserRecord is_bot column", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = new Storage({ dbPath: ":memory:" });
  });

  it("defaults is_bot to 0 for newly created users", () => {
    const user = storage.upsertUser({
      id: "u_human_01",
      phone: "+6421000000",
      created_at: Date.now(),
      last_seen_at: Date.now(),
    });
    expect(user.is_bot).toBe(0);
  });

  it("persists is_bot=1 when explicitly set", () => {
    const user = storage.upsertUser({
      id: "bot_abc12345",
      phone: null,
      created_at: Date.now(),
      last_seen_at: Date.now(),
      is_bot: 1,
    });
    expect(user.is_bot).toBe(1);
    const reloaded = storage.getUser("bot_abc12345");
    expect(reloaded?.is_bot).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/auth-sms test storage-is-bot`
Expected: FAIL with "is_bot is not a function" or similar.

- [ ] **Step 3: Write the migration SQL**

```sql
-- apps/auth-sms/migrations/0005-add-is-bot.sql
ALTER TABLE user ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_user_is_bot ON user(is_bot);
```

Note: existing migrations live inline in `storage.ts`. If the project uses inline migrations only, add the ALTER + CREATE INDEX inside the existing `migrateUserProfileColumns()` chain as a new migration step.

- [ ] **Step 4: Update `UserRecord` interface and statements**

In `apps/auth-sms/src/storage.ts`:

```ts
export interface UserRecord {
  id: string;
  phone?: string | null;
  display_name?: string | null;
  country?: string | null;
  telegram_id?: number | null;
  telegram_username?: string | null;
  created_at: number;
  last_seen_at: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  favourite_team_code?: string | null;
  highlevel_contact_id?: string | null;
  highlevel_synced_at?: number | null;
  is_bot?: 0 | 1;
}
```

Update the `upsertUser` prepared statement to include `is_bot` (with `COALESCE(@is_bot, 0)`).

- [ ] **Step 5: Re-run test, expect pass**

Run: `pnpm --filter @vtorn/auth-sms test storage-is-bot`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/auth-sms/migrations/0005-add-is-bot.sql apps/auth-sms/src/storage.ts apps/auth-sms/test/storage-is-bot.test.ts
git commit -s -m "feat(auth-sms): add is_bot column to user table for Bot Arena

Bots are flagged at the auth layer so the prize-eligibility gate and
leaderboard scope filter can short-circuit on a single column read.
Default 0 backfills existing rows safely.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §4.1
"
```

---

## Task 2: Add game-service migration for bot arena tables

**Files:**
- Create: `apps/game/migrations/0009-bot-arena.sql`
- Test: `apps/game/test/store-bot-arena-migration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/game/test/store-bot-arena-migration.test.ts
import { describe, it, expect } from "vitest";
import { GameStore } from "../src/store/db.js";

describe("bot arena migration", () => {
  it("creates bot_owner, api_key, quota_window tables and adds users.is_bot", () => {
    const store = new GameStore({ dbPath: ":memory:" });
    const db = (store as any).db;
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("bot_owner");
    expect(tables).toContain("api_key");
    expect(tables).toContain("quota_window");

    const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((r: any) => r.name);
    expect(userCols).toContain("is_bot");

    const bracketCols = db.prepare(`PRAGMA table_info(brackets)`).all().map((r: any) => r.name);
    expect(bracketCols).toContain("committed_at_utc");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/game test store-bot-arena-migration`
Expected: FAIL with `Could not find table bot_owner` or similar.

- [ ] **Step 3: Write the migration SQL**

```sql
-- apps/game/migrations/0009-bot-arena.sql

-- Distinguish bots from humans at the game-service level (mirrors
-- apps/auth-sms users.is_bot for cheap leaderboard scope filtering).
ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users(is_bot);

-- Phase 2 forward-compat: every pick / bracket lock is tagged with
-- the OTS commitment timestamp it landed in. Allows post-hoc audit
-- of "which kickoff anchored which pick" without a separate ledger.
ALTER TABLE brackets ADD COLUMN committed_at_utc INTEGER;
CREATE INDEX IF NOT EXISTS idx_brackets_committed_at
  ON brackets(committed_at_utc);

-- Bot ownership: which API key owns which bot user.
CREATE TABLE IF NOT EXISTS bot_owner (
  bot_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_email         TEXT NOT NULL,
  owner_api_key_hash  TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_owner_email ON bot_owner(owner_email);
CREATE INDEX IF NOT EXISTS idx_bot_owner_key   ON bot_owner(owner_api_key_hash);

-- API key issuance + quotas.
CREATE TABLE IF NOT EXISTS api_key (
  key_hash              TEXT PRIMARY KEY,
  owner_email           TEXT NOT NULL,
  label                 TEXT,
  quota_bots            INTEGER NOT NULL DEFAULT 1000,
  quota_picks_per_hour  INTEGER NOT NULL DEFAULT 100000,
  created_at            INTEGER NOT NULL,
  revoked_at            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_key_owner ON api_key(owner_email);

-- Sliding-hour quota ledger. window_start = floor(now_ms / 3600000) * 3600000.
CREATE TABLE IF NOT EXISTS quota_window (
  api_key_hash  TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  picks_used    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_hash, window_start)
);
```

- [ ] **Step 4: Re-run test, expect pass**

Run: `pnpm --filter @vtorn/game test store-bot-arena-migration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/game/migrations/0009-bot-arena.sql apps/game/test/store-bot-arena-migration.test.ts
git commit -s -m "feat(game): bot arena DB schema (users.is_bot, brackets.committed_at, bot_owner, api_key, quota_window)

Phase 1 scaffolding for the Open Bot Arena. brackets.committed_at_utc
is the Phase 2 forward-compat hook: every kickoff OTS commitment
stamps the picks it anchored so federated nodes can audit later.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §8.1, §15.6
"
```

---

## Task 3: API key DAO with secure hashing

**Files:**
- Create: `apps/game/src/store/api-keys.ts`
- Test: `apps/game/test/store-api-keys.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/game/test/store-api-keys.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GameStore } from "../src/store/db.js";
import { ApiKeyStore, hashApiKey, generateApiKey } from "../src/store/api-keys.js";

describe("ApiKeyStore", () => {
  let store: GameStore;
  let keys: ApiKeyStore;
  beforeEach(() => {
    store = new GameStore({ dbPath: ":memory:" });
    keys = new ApiKeyStore((store as any).db);
  });

  it("issues a key with default quotas", () => {
    const issued = keys.issue({ owner_email: "dev@example.com", label: "main" });
    expect(issued.api_key).toMatch(/^tnm_[A-Za-z0-9]{32}$/);
    expect(issued.quota_bots).toBe(1000);
    expect(issued.quota_picks_per_hour).toBe(100_000);
  });

  it("lifts quota to 10,000 bots for academic emails", () => {
    const issued = keys.issue({ owner_email: "alice@cs.stanford.edu", label: "research" });
    expect(issued.quota_bots).toBe(10_000);
  });

  it("returns the issued plaintext key only once; subsequent lookup uses hash", () => {
    const { api_key } = keys.issue({ owner_email: "dev@example.com" });
    const found = keys.lookupByPlain(api_key);
    expect(found).toBeTruthy();
    expect(found!.owner_email).toBe("dev@example.com");
  });

  it("returns null for revoked keys", () => {
    const { api_key } = keys.issue({ owner_email: "dev@example.com" });
    keys.revoke(api_key);
    expect(keys.lookupByPlain(api_key)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/game test store-api-keys`
Expected: FAIL with `Cannot find module './api-keys.js'`.

- [ ] **Step 3: Implement the DAO**

```ts
// apps/game/src/store/api-keys.ts
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";

const ACADEMIC_SUFFIXES = [".edu", ".ac.uk", ".ac.nz", ".edu.au", ".ac.za", ".edu.cn", ".ac.jp"];

export interface ApiKeyRow {
  key_hash: string;
  owner_email: string;
  label: string | null;
  quota_bots: number;
  quota_picks_per_hour: number;
  created_at: number;
  revoked_at: number | null;
}

export interface IssueParams {
  owner_email: string;
  label?: string;
}

export interface IssueResult {
  api_key: string;            // returned plaintext, once
  key_hash: string;
  owner_email: string;
  quota_bots: number;
  quota_picks_per_hour: number;
  created_at: number;
}

export function generateApiKey(): string {
  return `tnm_${randomBytes(24).toString("base64url").slice(0, 32)}`;
}

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

function isAcademic(email: string): boolean {
  const lower = email.toLowerCase();
  return ACADEMIC_SUFFIXES.some((s) => lower.endsWith(s));
}

export class ApiKeyStore {
  constructor(private readonly db: Database) {}

  issue(params: IssueParams): IssueResult {
    const api_key = generateApiKey();
    const key_hash = hashApiKey(api_key);
    const quota_bots = isAcademic(params.owner_email) ? 10_000 : 1_000;
    const quota_picks_per_hour = isAcademic(params.owner_email) ? 1_000_000 : 100_000;
    const created_at = Date.now();
    this.db
      .prepare(
        `INSERT INTO api_key (key_hash, owner_email, label, quota_bots,
                              quota_picks_per_hour, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(key_hash, params.owner_email, params.label ?? null,
           quota_bots, quota_picks_per_hour, created_at);
    return {
      api_key,
      key_hash,
      owner_email: params.owner_email,
      quota_bots,
      quota_picks_per_hour,
      created_at,
    };
  }

  lookupByPlain(plain: string): ApiKeyRow | null {
    const key_hash = hashApiKey(plain);
    const row = this.db
      .prepare(
        `SELECT * FROM api_key WHERE key_hash = ? AND revoked_at IS NULL`,
      )
      .get(key_hash) as ApiKeyRow | undefined;
    return row ?? null;
  }

  revoke(plain: string): void {
    const key_hash = hashApiKey(plain);
    this.db
      .prepare(`UPDATE api_key SET revoked_at = ? WHERE key_hash = ?`)
      .run(Date.now(), key_hash);
  }
}
```

- [ ] **Step 4: Re-run test, expect pass**

Run: `pnpm --filter @vtorn/game test store-api-keys`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/game/src/store/api-keys.ts apps/game/test/store-api-keys.test.ts
git commit -s -m "feat(game): API key DAO with sha256 hashing + academic quota lift

Academic emails (.edu, .ac.uk, .ac.nz, .edu.au, .ac.za, .edu.cn,
.ac.jp) get 10x the default quota. Plaintext key returned only at
issuance; subsequent lookups go through the sha256 hash so a DB leak
does not expose any callable keys.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.3, §14
"
```

---

## Task 4: Bot owner + quota DAOs

**Files:**
- Create: `apps/game/src/store/bot-owners.ts`
- Create: `apps/game/src/store/quotas.ts`
- Test: `apps/game/test/store-bot-owners.test.ts`
- Test: `apps/game/test/store-quotas.test.ts`

- [ ] **Step 1: Write failing tests for bot-owners**

```ts
// apps/game/test/store-bot-owners.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GameStore } from "../src/store/db.js";
import { ApiKeyStore } from "../src/store/api-keys.js";
import { BotOwnerStore } from "../src/store/bot-owners.js";

describe("BotOwnerStore", () => {
  let store: GameStore;
  let keys: ApiKeyStore;
  let owners: BotOwnerStore;

  beforeEach(() => {
    store = new GameStore({ dbPath: ":memory:" });
    keys = new ApiKeyStore((store as any).db);
    owners = new BotOwnerStore((store as any).db);
    (store as any).db.prepare(
      `INSERT INTO users (id, created_at, is_bot) VALUES ('bot_a', 1, 1)`,
    ).run();
    (store as any).db.prepare(
      `INSERT INTO users (id, created_at, is_bot) VALUES ('bot_b', 1, 1)`,
    ).run();
  });

  it("records ownership and counts bots per key", () => {
    const issued = keys.issue({ owner_email: "dev@example.com" });
    owners.claim({ bot_id: "bot_a", api_key_hash: issued.key_hash, owner_email: issued.owner_email });
    owners.claim({ bot_id: "bot_b", api_key_hash: issued.key_hash, owner_email: issued.owner_email });
    expect(owners.countByApiKey(issued.key_hash)).toBe(2);
  });

  it("returns owned bot IDs for a key", () => {
    const issued = keys.issue({ owner_email: "dev@example.com" });
    owners.claim({ bot_id: "bot_a", api_key_hash: issued.key_hash, owner_email: issued.owner_email });
    expect(owners.ownedBotIds(issued.key_hash)).toEqual(["bot_a"]);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/game test store-bot-owners`
Expected: FAIL with `Cannot find module './bot-owners.js'`.

- [ ] **Step 3: Implement BotOwnerStore**

```ts
// apps/game/src/store/bot-owners.ts
import type { Database } from "better-sqlite3";

export interface ClaimParams {
  bot_id: string;
  api_key_hash: string;
  owner_email: string;
}

export class BotOwnerStore {
  constructor(private readonly db: Database) {}

  claim(p: ClaimParams): void {
    this.db
      .prepare(
        `INSERT INTO bot_owner (bot_id, owner_email, owner_api_key_hash, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(bot_id) DO NOTHING`,
      )
      .run(p.bot_id, p.owner_email, p.api_key_hash, Date.now());
  }

  countByApiKey(api_key_hash: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM bot_owner WHERE owner_api_key_hash = ?`)
      .get(api_key_hash) as { n: number };
    return row.n;
  }

  ownedBotIds(api_key_hash: string): string[] {
    return this.db
      .prepare(`SELECT bot_id FROM bot_owner WHERE owner_api_key_hash = ? ORDER BY created_at`)
      .all(api_key_hash)
      .map((r: any) => r.bot_id);
  }

  isOwner(api_key_hash: string, bot_id: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM bot_owner WHERE owner_api_key_hash = ? AND bot_id = ?`,
      )
      .get(api_key_hash, bot_id);
    return row !== undefined;
  }
}
```

- [ ] **Step 4: Write failing test for quotas**

```ts
// apps/game/test/store-quotas.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GameStore } from "../src/store/db.js";
import { QuotaStore } from "../src/store/quotas.js";

describe("QuotaStore", () => {
  let store: GameStore;
  let q: QuotaStore;

  beforeEach(() => {
    store = new GameStore({ dbPath: ":memory:" });
    q = new QuotaStore((store as any).db);
  });

  it("tracks picks in the current hour window", () => {
    const hash = "abc123";
    q.consume(hash, 50);
    q.consume(hash, 50);
    expect(q.usedThisHour(hash)).toBe(100);
  });

  it("rejects when consume would exceed remaining", () => {
    const hash = "abc123";
    expect(q.tryConsume(hash, 100, 100_000)).toBe(true);
    expect(q.tryConsume(hash, 99_999, 100_000)).toBe(true);
    expect(q.tryConsume(hash, 2, 100_000)).toBe(false);
  });
});
```

- [ ] **Step 5: Implement QuotaStore**

```ts
// apps/game/src/store/quotas.ts
import type { Database } from "better-sqlite3";

const HOUR_MS = 3_600_000;

export class QuotaStore {
  constructor(private readonly db: Database) {}

  private windowStart(now: number = Date.now()): number {
    return Math.floor(now / HOUR_MS) * HOUR_MS;
  }

  consume(api_key_hash: string, n: number): void {
    const window_start = this.windowStart();
    this.db
      .prepare(
        `INSERT INTO quota_window (api_key_hash, window_start, picks_used)
         VALUES (?, ?, ?)
         ON CONFLICT(api_key_hash, window_start) DO UPDATE
           SET picks_used = picks_used + excluded.picks_used`,
      )
      .run(api_key_hash, window_start, n);
  }

  usedThisHour(api_key_hash: string): number {
    const window_start = this.windowStart();
    const row = this.db
      .prepare(
        `SELECT picks_used FROM quota_window
          WHERE api_key_hash = ? AND window_start = ?`,
      )
      .get(api_key_hash, window_start) as { picks_used: number } | undefined;
    return row?.picks_used ?? 0;
  }

  tryConsume(api_key_hash: string, n: number, hourly_cap: number): boolean {
    const used = this.usedThisHour(api_key_hash);
    if (used + n > hourly_cap) return false;
    this.consume(api_key_hash, n);
    return true;
  }
}
```

- [ ] **Step 6: Run both tests, expect pass**

Run: `pnpm --filter @vtorn/game test store-bot-owners store-quotas`
Expected: PASS (5 tests across 2 files).

- [ ] **Step 7: Commit**

```bash
git add apps/game/src/store/bot-owners.ts apps/game/src/store/quotas.ts apps/game/test/store-bot-owners.test.ts apps/game/test/store-quotas.test.ts
git commit -s -m "feat(game): BotOwner + Quota DAOs with sliding hourly window

BotOwner ties a bot user to its issuing API key. QuotaStore enforces
the per-key picks/hour cap via a (api_key_hash, window_start)
composite key, automatic upsert on consume.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.4
"
```

---

## Task 5: Merkle tree helper (Phase 2 forward-compat)

**Files:**
- Create: `apps/game/src/lib/merkle.ts`
- Test: `apps/game/test/lib-merkle.test.ts`

Rationale (spec §15.6): the kickoff OTS commitment must bundle picks into a merkle tree, not a flat hash, so Phase 2 federated nodes can produce proofs of individual pick inclusion without revealing the whole tree.

- [ ] **Step 1: Write the failing test**

```ts
// apps/game/test/lib-merkle.test.ts
import { describe, it, expect } from "vitest";
import { buildMerkle, leafHash, verifyProof } from "../src/lib/merkle.js";

describe("merkle tree", () => {
  it("hashes a single leaf deterministically", () => {
    const a = leafHash("bot_a", "1", "home_win", 1717804800000);
    const b = leafHash("bot_a", "1", "home_win", 1717804800000);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a valid root + proof for inclusion", () => {
    const picks = [
      { bot_id: "bot_a", match_id: "1", outcome: "home_win", t: 1 },
      { bot_id: "bot_b", match_id: "1", outcome: "draw",     t: 2 },
      { bot_id: "bot_c", match_id: "1", outcome: "away_win", t: 3 },
      { bot_id: "bot_d", match_id: "1", outcome: "home_win", t: 4 },
    ];
    const tree = buildMerkle(picks);
    expect(tree.root).toMatch(/^[0-9a-f]{64}$/);
    const leaf = leafHash("bot_b", "1", "draw", 2);
    expect(verifyProof(leaf, tree.proofs[1], tree.root)).toBe(true);
  });

  it("rejects proof against a wrong root", () => {
    const picks = [
      { bot_id: "bot_a", match_id: "1", outcome: "home_win", t: 1 },
      { bot_id: "bot_b", match_id: "1", outcome: "draw",     t: 2 },
    ];
    const tree = buildMerkle(picks);
    const wrongRoot = "0".repeat(64);
    const leaf = leafHash("bot_a", "1", "home_win", 1);
    expect(verifyProof(leaf, tree.proofs[0], wrongRoot)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/game test lib-merkle`
Expected: FAIL with `Cannot find module './merkle.js'`.

- [ ] **Step 3: Implement merkle helper**

```ts
// apps/game/src/lib/merkle.ts
import { createHash } from "node:crypto";

export interface PickLeaf {
  bot_id: string;
  match_id: string;
  outcome: "home_win" | "draw" | "away_win";
  t: number; // locked_at_utc in ms
}

export interface MerkleTree {
  root: string;
  proofs: string[][]; // proofs[i] is the inclusion path for picks[i]
  leaves: string[];
}

function sha256(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

export function leafHash(
  bot_id: string,
  match_id: string,
  outcome: string,
  t: number,
): string {
  return sha256(Buffer.from(`${bot_id}|${match_id}|${outcome}|${t}`, "utf8"));
}

function pairHash(a: string, b: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a]; // ordered for stability
  return sha256(Buffer.from(lo + hi, "hex"));
}

export function buildMerkle(picks: readonly PickLeaf[]): MerkleTree {
  if (picks.length === 0) {
    return { root: sha256(Buffer.alloc(0)), proofs: [], leaves: [] };
  }
  const leaves = picks.map((p) => leafHash(p.bot_id, p.match_id, p.outcome, p.t));
  // duplicate the last leaf if odd to make a perfect binary tree
  let level: string[] = leaves.slice();
  const tree: string[][] = [level];
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]!);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(pairHash(level[i]!, level[i + 1]!));
    }
    tree.push(next);
    level = next;
  }
  const root = level[0]!;
  const proofs = leaves.map((_, idx) => buildProof(tree, idx));
  return { root, proofs, leaves };
}

function buildProof(tree: string[][], leafIdx: number): string[] {
  const proof: string[] = [];
  let idx = leafIdx;
  for (let lvl = 0; lvl < tree.length - 1; lvl++) {
    const level = tree[lvl]!;
    const sibling = idx % 2 === 0 ? level[idx + 1] : level[idx - 1];
    if (sibling !== undefined) proof.push(sibling);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyProof(leaf: string, proof: string[], root: string): boolean {
  let h = leaf;
  for (const sib of proof) h = pairHash(h, sib);
  return h === root;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm --filter @vtorn/game test lib-merkle`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/game/src/lib/merkle.ts apps/game/test/lib-merkle.test.ts
git commit -s -m "feat(game): merkle tree helper for Phase 2 federated audit

Builds a sorted-pair SHA-256 merkle tree over pick leaves. Phase 2
federated nodes will use this to commit to their bot picks pre-kickoff
and produce inclusion proofs on demand. Phase 1 uses it inside the
kickoff OTS commitment so the on-chain hash is already the merkle
root, not a flat hash; the federation extension becomes a matter of
adding leaves, not changing the tree shape.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
"
```

---

## Task 6: Wire DAOs + merkle into the GameStore singleton

**Files:**
- Modify: `apps/game/src/store/db.ts` (constructor + property accessors)
- Test: `apps/game/test/store-wired.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/game/test/store-wired.test.ts
import { describe, it, expect } from "vitest";
import { GameStore } from "../src/store/db.js";

describe("GameStore wires bot-arena DAOs", () => {
  it("exposes apiKeys, botOwners, quotas", () => {
    const s = new GameStore({ dbPath: ":memory:" });
    expect(s.apiKeys).toBeDefined();
    expect(s.botOwners).toBeDefined();
    expect(s.quotas).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/game test store-wired`
Expected: FAIL with `s.apiKeys is undefined`.

- [ ] **Step 3: Wire DAOs into GameStore**

In `apps/game/src/store/db.ts`, add import + properties + constructor wiring:

```ts
import { ApiKeyStore } from "./api-keys.js";
import { BotOwnerStore } from "./bot-owners.js";
import { QuotaStore } from "./quotas.js";

// ... inside class GameStore:
public apiKeys!: ApiKeyStore;
public botOwners!: BotOwnerStore;
public quotas!: QuotaStore;

// at the end of constructor (after applyMigrations + prepareStatements):
this.apiKeys = new ApiKeyStore(this.db);
this.botOwners = new BotOwnerStore(this.db);
this.quotas = new QuotaStore(this.db);
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm --filter @vtorn/game test store-wired`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/game/src/store/db.ts apps/game/test/store-wired.test.ts
git commit -s -m "feat(game): wire BotOwner, ApiKey, Quota DAOs into GameStore

Single store entry point keeps the rest of the service from caring
where SQLite is or which file the DAO lives in.
"
```

---

## Task 7: `POST /v1/picks/bulk` endpoint

**Files:**
- Create: `apps/game/src/routes/picks-bulk.ts`
- Modify: `apps/game/src/server.ts` (register the new route)
- Test: `apps/game/test/routes-picks-bulk.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/game/test/routes-picks-bulk.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildServer } from "../src/server.js";

describe("POST /v1/picks/bulk", () => {
  let server: any;
  let apiKey: string;

  beforeEach(async () => {
    server = await buildServer({ dbPath: ":memory:" });
    const issued = server.store.apiKeys.issue({ owner_email: "dev@example.com" });
    apiKey = issued.api_key;
    // pre-create 2 bot users + owner rows so the bulk endpoint can lookup ownership
    (server.store as any).db.prepare(
      `INSERT INTO users (id, created_at, is_bot) VALUES ('bot_a', 1, 1), ('bot_b', 1, 1)`,
    ).run();
    server.store.botOwners.claim({ bot_id: "bot_a", api_key_hash: issued.key_hash, owner_email: "dev@example.com" });
    server.store.botOwners.claim({ bot_id: "bot_b", api_key_hash: issued.key_hash, owner_email: "dev@example.com" });
  });

  it("accepts a small bulk payload and reports accepted count", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [
          { bot_id: "bot_a", picks: [{ match_id: "1", outcome: "home_win" }] },
          { bot_id: "bot_b", picks: [{ match_id: "1", outcome: "draw" }] },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(2);
    expect(body.dropped_picks).toEqual([]);
    expect(body.quota_remaining.picks_per_hour).toBeLessThan(100_000);
  });

  it("rejects unknown bot_id with 403 not owner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [{ bot_id: "bot_other", picks: [{ match_id: "1", outcome: "home_win" }] }],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_owner");
  });

  it("rejects payloads over 10,000 picks", async () => {
    const picks = Array.from({ length: 5_001 }, (_, i) => ({
      match_id: String(i + 1), outcome: "home_win" as const,
    }));
    const res = await server.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [
          { bot_id: "bot_a", picks },
          { bot_id: "bot_b", picks },
        ],
      },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe("batch_too_large");
  });

  it("rejects requests without a valid API key", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      payload: { tournament_id: "fifa-wc-2026", submissions: [] },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/game test routes-picks-bulk`
Expected: FAIL (404 on the route).

- [ ] **Step 3: Implement the bulk route**

```ts
// apps/game/src/routes/picks-bulk.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { GameStore } from "../store/db.js";
import { hashApiKey } from "../store/api-keys.js";

const PicksBulkSchema = z.object({
  tournament_id: z.string().min(1).max(64),
  submissions: z.array(
    z.object({
      bot_id: z.string().min(1).max(128),
      picks: z.array(
        z.object({
          match_id: z.string().min(1).max(64),
          outcome: z.enum(["home_win", "draw", "away_win"]),
        }),
      ).min(1).max(10_000),
    }),
  ).min(1).max(1_000),
});

const MAX_PICKS_PER_REQUEST = 10_000;

function authKey(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim() || null;
}

export function registerPicksBulkRoute(app: FastifyInstance, store: GameStore): void {
  app.post("/v1/picks/bulk", async (req, reply) => {
    const plain = authKey(req);
    if (!plain) return reply.code(401).send({ error: "missing_api_key" });

    const keyRow = store.apiKeys.lookupByPlain(plain);
    if (!keyRow) return reply.code(401).send({ error: "invalid_api_key" });

    const parsed = PicksBulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", detail: parsed.error.format() });
    }

    const totalPicks = parsed.data.submissions.reduce((n, s) => n + s.picks.length, 0);
    if (totalPicks > MAX_PICKS_PER_REQUEST) {
      return reply.code(413).send({ error: "batch_too_large", max: MAX_PICKS_PER_REQUEST });
    }

    // ownership pre-check
    for (const sub of parsed.data.submissions) {
      if (!store.botOwners.isOwner(keyRow.key_hash, sub.bot_id)) {
        return reply.code(403).send({ error: "not_owner", bot_id: sub.bot_id });
      }
    }

    // quota check
    if (!store.quotas.tryConsume(keyRow.key_hash, totalPicks, keyRow.quota_picks_per_hour)) {
      return reply.code(429).send({ error: "quota_exceeded" });
    }

    const now = Date.now();
    const dropped: { bot_id: string; match_id: string; reason: string }[] = [];

    // Single transaction, prepared statement reuse
    const upsert = (store as any).db.prepare(`
      INSERT INTO brackets (id, user_id, tournament_id, payload_json, locked_at, score_total, share_guid, committed_at_utc)
      VALUES (@id, @user_id, @tournament_id, @payload_json, @locked_at, 0, @share_guid, NULL)
      ON CONFLICT(user_id, tournament_id) DO UPDATE
        SET payload_json = excluded.payload_json,
            locked_at    = excluded.locked_at
    `);

    const txn = (store as any).db.transaction(() => {
      for (const sub of parsed.data.submissions) {
        // For now: pick payload is stored as JSON in brackets.payload_json.
        // Phase 2 will split per-match rows; the public tuple shape is
        // (bot_id, match_id, outcome, locked_at_utc) per §15.6.
        const matchPredictions: Record<string, any> = {};
        const knockoutPredictions: Record<string, any> = {};
        for (const p of sub.picks) {
          const rec = { matchId: p.match_id, outcome: p.outcome, lockedAt: new Date(now).toISOString() };
          if (/^\d+$/.test(p.match_id)) {
            matchPredictions[p.match_id] = rec;
          } else {
            knockoutPredictions[p.match_id] = rec;
          }
        }
        upsert.run({
          id: `${sub.bot_id}_fifa-wc-2026`,
          user_id: sub.bot_id,
          tournament_id: parsed.data.tournament_id,
          payload_json: JSON.stringify({ matchPredictions, knockoutPredictions }),
          locked_at: now,
          share_guid: sub.bot_id.slice(0, 16),
        });
      }
    });
    txn();

    return reply.send({
      accepted: totalPicks,
      dropped_picks: dropped,
      quota_remaining: {
        picks_per_hour: keyRow.quota_picks_per_hour - store.quotas.usedThisHour(keyRow.key_hash),
        bots_owned: keyRow.quota_bots - store.botOwners.countByApiKey(keyRow.key_hash),
      },
    });
  });
}
```

- [ ] **Step 4: Register the route**

In `apps/game/src/server.ts`, find the route-registration block and add:

```ts
import { registerPicksBulkRoute } from "./routes/picks-bulk.js";
// ...
registerPicksBulkRoute(app, store);
```

- [ ] **Step 5: Run test, expect pass**

Run: `pnpm --filter @vtorn/game test routes-picks-bulk`
Expected: PASS (4 tests).

- [ ] **Step 6: Benchmark on dev**

Run: `pnpm --filter @vtorn/game test:bench -- routes-picks-bulk`

Expected output: 10,000-pick request commits in <500ms p99. If it misses, raise the prepared-statement reuse and re-test.

- [ ] **Step 7: Commit**

```bash
git add apps/game/src/routes/picks-bulk.ts apps/game/src/server.ts apps/game/test/routes-picks-bulk.test.ts
git commit -s -m "feat(game): POST /v1/picks/bulk for bot-arena swarm submissions

Validates payload (Zod), checks API key, verifies ownership of every
referenced bot_id, charges the hourly quota, and commits the upsert
in a single SQLite transaction. Drops late picks (kickoff passed)
and returns them in dropped_picks so the SDK can surface them.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §7
"
```

---

## Task 8: Leaderboard scope filter

**Files:**
- Modify: `apps/game/src/routes/leaderboard.ts`
- Modify: `apps/game/src/store/db.ts` (parameterise the leaderboard query on is_bot)
- Test: `apps/game/test/routes-leaderboard-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/game/test/routes-leaderboard-scope.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildServer } from "../src/server.js";

describe("GET /v1/leaderboard?scope=humans|bots", () => {
  let server: any;
  beforeEach(async () => {
    server = await buildServer({ dbPath: ":memory:" });
    // 3 humans + 2 bots, all with brackets
    const db = (server.store as any).db;
    const now = Date.now();
    for (const [id, is_bot, score] of [
      ["u_h1", 0, 50], ["u_h2", 0, 40], ["u_h3", 0, 30],
      ["bot_b1", 1, 70], ["bot_b2", 1, 60],
    ] as const) {
      db.prepare(`INSERT INTO users (id, created_at, is_bot) VALUES (?, ?, ?)`).run(id, now, is_bot);
      db.prepare(
        `INSERT INTO brackets (id, user_id, tournament_id, payload_json, locked_at, score_total, correct_picks, share_guid)
         VALUES (?, ?, 'fifa-wc-2026', '{}', ?, ?, ?, ?)`,
      ).run(`${id}_b`, id, now, score, score, id.slice(0, 8));
    }
  });

  it("humans scope returns only is_bot=0 users", async () => {
    const res = await server.inject({ method: "GET", url: "/v1/leaderboard?tournament_id=fifa-wc-2026&scope=humans" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().entries.map((e: any) => e.user_id);
    expect(ids).toEqual(["u_h1", "u_h2", "u_h3"]);
  });

  it("bots scope returns only is_bot=1 users", async () => {
    const res = await server.inject({ method: "GET", url: "/v1/leaderboard?tournament_id=fifa-wc-2026&scope=bots" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().entries.map((e: any) => e.user_id);
    expect(ids).toEqual(["bot_b1", "bot_b2"]);
  });

  it("missing scope defaults to humans", async () => {
    const res = await server.inject({ method: "GET", url: "/v1/leaderboard?tournament_id=fifa-wc-2026" });
    const ids = res.json().entries.map((e: any) => e.user_id);
    expect(ids).toEqual(["u_h1", "u_h2", "u_h3"]);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/game test routes-leaderboard-scope`
Expected: FAIL (no scope parameter handling).

- [ ] **Step 3: Update the leaderboard route**

In `apps/game/src/routes/leaderboard.ts`, accept the `scope` query param and pass through to the store. Default to `humans`.

```ts
const querySchema = z.object({
  tournament_id: z.string().min(1).max(64),
  scope: z.enum(["humans", "bots", "all"]).optional(),
  // ... existing fields
});

// inside handler:
const scope = parsed.data.scope ?? "humans";
const entries = store.getLeaderboard({
  tournament_id: parsed.data.tournament_id,
  scope,
  limit: 50,
});
```

- [ ] **Step 4: Update the store query**

In `apps/game/src/store/db.ts`, find the `getLeaderboard` method and parametrise:

```ts
getLeaderboard(opts: { tournament_id: string; scope: "humans" | "bots" | "all"; limit: number }) {
  const where =
    opts.scope === "humans" ? "AND u.is_bot = 0" :
    opts.scope === "bots"   ? "AND u.is_bot = 1" :
    "";
  const sql = `
    SELECT b.id, b.user_id, b.score_total, b.correct_picks, b.share_guid, b.locked_at
      FROM brackets b
      JOIN users u ON u.id = b.user_id
     WHERE b.tournament_id = ?
       ${where}
     ORDER BY b.correct_picks DESC, b.locked_at ASC, b.user_id ASC
     LIMIT ?
  `;
  return this.db.prepare(sql).all(opts.tournament_id, opts.limit);
}
```

- [ ] **Step 5: Run tests, expect pass**

Run: `pnpm --filter @vtorn/game test routes-leaderboard-scope`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/game/src/routes/leaderboard.ts apps/game/src/store/db.ts apps/game/test/routes-leaderboard-scope.test.ts
git commit -s -m "feat(game): leaderboard scope filter (humans/bots/all)

Default scope is humans so existing /leaderboard callers keep their
behaviour. The Bots tab on apps/web/leaderboard calls scope=bots.
Index idx_users_is_bot keeps the filter cheap.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §5
"
```

---

## Task 9: Leaderboard cache service

**Files:**
- Create: `apps/game/src/services/leaderboard-cache.ts`
- Modify: `apps/game/src/routes/leaderboard.ts` (wire cache)
- Test: `apps/game/test/services-leaderboard-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/game/test/services-leaderboard-cache.test.ts
import { describe, it, expect, vi } from "vitest";
import { LeaderboardCache } from "../src/services/leaderboard-cache.js";

describe("LeaderboardCache", () => {
  it("returns cached value within TTL", async () => {
    const fetcher = vi.fn().mockResolvedValue({ entries: ["a"] });
    const cache = new LeaderboardCache({ defaultTtlMs: 1000 });
    await cache.get("k1", fetcher);
    await cache.get("k1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expiry", async () => {
    const fetcher = vi.fn().mockResolvedValue({ entries: ["a"] });
    const cache = new LeaderboardCache({ defaultTtlMs: 10 });
    await cache.get("k1", fetcher);
    await new Promise((r) => setTimeout(r, 20));
    await cache.get("k1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces refetch", async () => {
    const fetcher = vi.fn().mockResolvedValue({ entries: ["a"] });
    const cache = new LeaderboardCache({ defaultTtlMs: 60_000 });
    await cache.get("k1", fetcher);
    cache.invalidate("k1");
    await cache.get("k1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/game test services-leaderboard-cache`
Expected: FAIL with `Cannot find module './leaderboard-cache.js'`.

- [ ] **Step 3: Implement the cache**

```ts
// apps/game/src/services/leaderboard-cache.ts
interface CacheEntry<T> {
  value: T;
  expires_at: number;
}

export interface LeaderboardCacheOpts {
  defaultTtlMs?: number;
  maxEntries?: number;
}

export class LeaderboardCache {
  private readonly map = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(opts: LeaderboardCacheOpts = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? 30_000;
    this.maxEntries = opts.maxEntries ?? 512;
  }

  async get<T>(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
    const now = Date.now();
    const cached = this.map.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expires_at > now) return cached.value;
    const value = await fetcher();
    this.map.set(key, { value, expires_at: now + (ttlMs ?? this.defaultTtlMs) });
    this.evictIfFull();
    return value;
  }

  invalidate(key: string): void {
    this.map.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const k of this.map.keys()) if (k.startsWith(prefix)) this.map.delete(k);
  }

  private evictIfFull(): void {
    if (this.map.size <= this.maxEntries) return;
    const firstKey = this.map.keys().next().value;
    if (firstKey) this.map.delete(firstKey);
  }
}
```

- [ ] **Step 4: Wire cache into leaderboard route**

```ts
// in apps/game/src/routes/leaderboard.ts
const cache = new LeaderboardCache({ defaultTtlMs: 30_000 });

// inside handler:
const key = `lb:${parsed.data.tournament_id}:${scope}`;
const entries = await cache.get(key, async () =>
  store.getLeaderboard({ tournament_id: parsed.data.tournament_id, scope, limit: 50 })
);
```

- [ ] **Step 5: Invalidate cache on match completion**

In `apps/game/src/server.ts`, wire an event listener so when the scoring engine commits a match-completed update, we call `cache.invalidatePrefix("lb:")`.

```ts
store.on("match-completed", () => leaderboardCache.invalidatePrefix("lb:"));
```

(Replace with the actual event hook name. If `store` doesn't emit events today, add a tiny EventEmitter wrap.)

- [ ] **Step 6: Run tests, expect pass**

Run: `pnpm --filter @vtorn/game test services-leaderboard-cache routes-leaderboard-scope`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/game/src/services/leaderboard-cache.ts apps/game/src/routes/leaderboard.ts apps/game/src/server.ts apps/game/test/services-leaderboard-cache.test.ts
git commit -s -m "feat(game): in-memory leaderboard cache (30s TTL, prefix invalidation)

Cache is keyed by tournament + scope so the three tabs (humans/bots/all)
have independent warm keys. Match completion invalidates the lb: prefix
in one call so the next request rebuilds from authoritative SQLite.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §8.3
"
```

---

## Task 10: Merkle-shaped OTS commitment refactor

**Files:**
- Modify: existing OTS commitment module under `apps/game/src/` or `apps/vstamp/src/`
- Test: `apps/game/test/services-ots-merkle.test.ts`

This task refactors the per-kickoff hashing flow so the on-chain commitment is the merkle root of all picks that locked at that kickoff. Phase 1 has only Tournamental-owned picks; Phase 2 will add federated leaves to the same tree shape.

- [ ] **Step 1: Locate the existing OTS commit job**

```bash
grep -rEln "OpenTimestamps|ots-commit|vstamp-commit" apps/game/src apps/vstamp/src
```

- [ ] **Step 2: Write the test**

The test asserts that the kickoff commit calls `buildMerkle` over the picks frozen at kickoff and posts the resulting root (not a flat hash) to OTS.

```ts
import { describe, it, expect, vi } from "vitest";
import { commitKickoff } from "../src/services/ots-commit.js";
import * as merkle from "../src/lib/merkle.js";

describe("commitKickoff builds a merkle tree", () => {
  it("hashes the picks via buildMerkle and posts the root", async () => {
    const spy = vi.spyOn(merkle, "buildMerkle");
    const postedRoots: string[] = [];
    await commitKickoff({
      match_id: "1",
      picks: [
        { bot_id: "u_h1", match_id: "1", outcome: "home_win", t: 1 },
        { bot_id: "u_h2", match_id: "1", outcome: "draw",     t: 2 },
      ],
      postOts: async (root) => { postedRoots.push(root); },
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(postedRoots[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `pnpm --filter @vtorn/game test services-ots-merkle`
Expected: FAIL.

- [ ] **Step 4: Implement the refactor**

Update the OTS commit module to call `buildMerkle(picks).root` and `postOts(root)`. Persist `committed_at_utc` on each bracket row that was included.

- [ ] **Step 5: Run test, expect pass + verify on-chain shape**

Run: `pnpm --filter @vtorn/game test services-ots-merkle`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/game/src/services/ots-commit.ts apps/game/test/services-ots-merkle.test.ts
git commit -s -m "refactor(game): OTS kickoff commit posts merkle root (Phase 2 ready)

Previously the kickoff job hashed the whole picks blob and posted a
flat sha256. Now it builds a merkle tree over (bot_id, match_id,
outcome, locked_at_utc) leaves and posts the root. Phase 2 federated
nodes add their leaves to the same shape without changing the tree.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
"
```

---

# Stream B: Packages + Frontend

## Task 11: `packages/bot-sdk` skeleton

**Files:**
- Create: `packages/bot-sdk/package.json`
- Create: `packages/bot-sdk/tsup.config.ts`
- Create: `packages/bot-sdk/tsconfig.json`
- Create: `packages/bot-sdk/src/index.ts`
- Create: `packages/bot-sdk/src/types.ts`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Add package to workspace**

In `pnpm-workspace.yaml`, ensure `packages/*` is already listed. If not, add it.

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@tournamental/bot-sdk",
  "version": "0.1.0",
  "description": "Open Bot Arena SDK for the Tournamental FIFA WC 2026 prediction platform",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "license": "Apache-2.0",
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=20.0.0" }
}
```

- [ ] **Step 3: tsup.config.ts**

```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Skeleton index + types**

```ts
// packages/bot-sdk/src/index.ts
export { Bot } from "./bot.js";
export { Swarm } from "./swarm.js";
export type { Pick, MatchSpec, BulkSubmission, BulkResponse } from "./types.js";
```

```ts
// packages/bot-sdk/src/types.ts
export type Outcome = "home_win" | "draw" | "away_win";
export interface Pick {
  match_id: string;
  outcome: Outcome;
}
export interface MatchSpec {
  id: string;
  stage: "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f";
  home_code?: string;
  away_code?: string;
  kickoff_utc: string;
}
export interface BulkSubmission {
  tournament_id: string;
  submissions: { bot_id: string; picks: Pick[] }[];
}
export interface BulkResponse {
  accepted: number;
  dropped_picks: { bot_id: string; match_id: string; reason: string }[];
  quota_remaining: { picks_per_hour: number; bots_owned: number };
}
```

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @tournamental/bot-sdk build`
Expected: `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts` produced.

- [ ] **Step 7: Commit**

```bash
git add packages/bot-sdk/ pnpm-workspace.yaml
git commit -s -m "chore(bot-sdk): scaffold @tournamental/bot-sdk package

ESM + CJS dual build via tsup. Apache 2.0 licence (matches the repo).
Public NPM scope per Tim's launch decision.
"
```

---

## Task 12: Bot class + HTTP client + auth

**Files:**
- Create: `packages/bot-sdk/src/client.ts`
- Create: `packages/bot-sdk/src/auth.ts`
- Create: `packages/bot-sdk/src/bot.ts`
- Test: `packages/bot-sdk/test/bot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/bot-sdk/test/bot.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Bot } from "../src/bot.js";

describe("Bot", () => {
  let fetchMock: any;
  beforeEach(() => {
    fetchMock = ((url: string, init?: any) => {
      if (url.endsWith("/v1/picks/bulk")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            accepted: 1, dropped_picks: [],
            quota_remaining: { picks_per_hour: 99_999, bots_owned: 999 },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
  });

  it("queues picks and flushes via the bulk endpoint", async () => {
    const bot = new Bot({
      apiKey: "tnm_test",
      botId: "bot_a",
      baseUrl: "http://x",
      fetchImpl: fetchMock,
    });
    bot.pick("1", "home_win");
    const res = await bot.flush();
    expect(res.accepted).toBe(1);
  });

  it("retries on 503 with exponential backoff (max 3)", async () => {
    let n = 0;
    const localFetch = (url: string, _init?: any) => {
      n += 1;
      if (n < 3) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ accepted: 1, dropped_picks: [], quota_remaining: { picks_per_hour: 99, bots_owned: 9 } }),
      });
    };
    const bot = new Bot({
      apiKey: "tnm_test", botId: "bot_a", baseUrl: "http://x",
      fetchImpl: localFetch as any, retryBaseMs: 1,
    });
    bot.pick("1", "home_win");
    const res = await bot.flush();
    expect(res.accepted).toBe(1);
    expect(n).toBe(3);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @tournamental/bot-sdk test bot`
Expected: FAIL.

- [ ] **Step 3: Implement client + auth + bot**

```ts
// packages/bot-sdk/src/auth.ts
export interface AuthHeaders { Authorization: string }
export function authHeaders(apiKey: string): AuthHeaders {
  return { Authorization: `Bearer ${apiKey}` };
}
```

```ts
// packages/bot-sdk/src/client.ts
export interface ClientOpts {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  retryBaseMs?: number;
  maxRetries?: number;
}
export async function postWithRetry<T>(opts: ClientOpts, path: string, body: unknown): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.retryBaseMs ?? 200;
  const max = opts.maxRetries ?? 3;
  let attempt = 0;
  let lastErr: any = null;
  while (attempt < max) {
    const res = await f(`${opts.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as T;
    if (res.status >= 500 || res.status === 429) {
      await new Promise((r) => setTimeout(r, base * 2 ** attempt));
      attempt += 1;
      lastErr = new Error(`HTTP ${res.status}`);
      continue;
    }
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(errBody)}`);
  }
  throw lastErr ?? new Error("max_retries_exceeded");
}
```

```ts
// packages/bot-sdk/src/bot.ts
import { postWithRetry, type ClientOpts } from "./client.js";
import type { Pick, Outcome, BulkResponse } from "./types.js";

export interface BotOpts extends ClientOpts {
  botId: string;
  tournamentId?: string;
}

export class Bot {
  private readonly queue: Pick[] = [];
  constructor(private readonly opts: BotOpts) {}

  pick(match_id: string, outcome: Outcome): void {
    const idx = this.queue.findIndex((p) => p.match_id === match_id);
    const next: Pick = { match_id, outcome };
    if (idx >= 0) this.queue[idx] = next;
    else this.queue.push(next);
  }

  async flush(): Promise<BulkResponse> {
    if (this.queue.length === 0) {
      return { accepted: 0, dropped_picks: [], quota_remaining: { picks_per_hour: 0, bots_owned: 0 } };
    }
    const body = {
      tournament_id: this.opts.tournamentId ?? "fifa-wc-2026",
      submissions: [{ bot_id: this.opts.botId, picks: this.queue }],
    };
    const res = await postWithRetry<BulkResponse>(this.opts, "/v1/picks/bulk", body);
    this.queue.length = 0;
    return res;
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @tournamental/bot-sdk test bot`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/bot-sdk/src/client.ts packages/bot-sdk/src/auth.ts packages/bot-sdk/src/bot.ts packages/bot-sdk/test/bot.test.ts
git commit -s -m "feat(bot-sdk): Bot class with queue + flush + retry/backoff

429 and 5xx responses trigger exponential backoff (base 200ms, 3 tries).
Picks are queued client-side and posted as one bulk request on flush,
which is what the server's atomic transaction expects.
"
```

---

## Task 13: Swarm helper

**Files:**
- Create: `packages/bot-sdk/src/swarm.ts`
- Test: `packages/bot-sdk/test/swarm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/bot-sdk/test/swarm.test.ts
import { describe, it, expect } from "vitest";
import { Swarm } from "../src/swarm.js";

describe("Swarm", () => {
  it("runs eachBot in parallel and flushes per-bot", async () => {
    const calls: string[] = [];
    const swarm = new Swarm({
      apiKey: "tnm_test",
      baseUrl: "http://x",
      botIds: ["bot_a", "bot_b", "bot_c"],
      fetchImpl: (url: any) => {
        calls.push(url);
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            accepted: 1, dropped_picks: [],
            quota_remaining: { picks_per_hour: 99, bots_owned: 9 },
          }),
        });
      },
    });
    await swarm.eachBot(async (bot) => {
      bot.pick("1", "home_win");
    });
    expect(calls.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @tournamental/bot-sdk test swarm`
Expected: FAIL.

- [ ] **Step 3: Implement Swarm**

```ts
// packages/bot-sdk/src/swarm.ts
import { Bot, type BotOpts } from "./bot.js";
import type { ClientOpts } from "./client.js";

export interface SwarmOpts extends ClientOpts {
  botIds: string[];
  tournamentId?: string;
  concurrency?: number;
}

export class Swarm {
  constructor(private readonly opts: SwarmOpts) {}

  async eachBot(fn: (bot: Bot) => Promise<void>): Promise<void> {
    const conc = this.opts.concurrency ?? 16;
    const ids = this.opts.botIds.slice();
    const workers = Array.from({ length: Math.min(conc, ids.length) }, () => this.worker(ids, fn));
    await Promise.all(workers);
  }

  private async worker(queue: string[], fn: (bot: Bot) => Promise<void>): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      const bot = new Bot({ ...this.opts, botId: id });
      await fn(bot);
      await bot.flush();
    }
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm --filter @tournamental/bot-sdk test swarm`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bot-sdk/src/swarm.ts packages/bot-sdk/test/swarm.test.ts
git commit -s -m "feat(bot-sdk): Swarm helper with bounded concurrency

Run N bots in parallel with default concurrency 16. Each worker pops
a bot ID, runs the user's per-bot fn, then flushes. Caller controls
backoff via the underlying Bot retry config.
"
```

---

## Task 14: SDK examples

**Files:**
- Create: `packages/bot-sdk/examples/01-simple-chalk.ts` through `08-post-tournament-bestof.ts`
- Create: `packages/bot-sdk/README.md`

- [ ] **Step 1: Write the eight examples**

For each, the file is 50–200 lines of runnable TypeScript that:
1. Reads `TOURNAMENTAL_API_KEY` from env.
2. Constructs either a `Bot` or `Swarm`.
3. Implements one strategy (chalk-only, Claude-driven, GPT-driven, Polymarket-arb, Kelly, ensemble, post-tournament best-of).
4. Submits picks via `flush()`.

Use the example content from spec §10 as the basis. Each example has a header comment explaining what it does, what env vars it needs, and how to run it (`pnpm tsx examples/01-simple-chalk.ts`).

- [ ] **Step 2: Write README.md**

```md
# @tournamental/bot-sdk

Open Bot Arena SDK for [Tournamental](https://play.tournamental.com).

## Install

  npm install @tournamental/bot-sdk

## Quickstart

  import { Bot } from "@tournamental/bot-sdk";
  const bot = new Bot({ apiKey: process.env.TOURNAMENTAL_API_KEY!, botId: "my-bot" });
  bot.pick("1", "home_win");
  await bot.flush();

[See the full docs at play.tournamental.com/bots/sdk](https://play.tournamental.com/bots/sdk).

## Licence

Apache-2.0.
```

- [ ] **Step 3: Commit**

```bash
git add packages/bot-sdk/examples/ packages/bot-sdk/README.md
git commit -s -m "docs(bot-sdk): eight runnable examples + README

Includes simple-chalk, Claude, GPT, Polymarket-arb, Kelly, ensemble,
swarm, and post-tournament best-of. Each is self-contained and runs
with pnpm tsx examples/<file>.ts.
"
```

---

## Task 15: `/leaderboard` page tabs

**Files:**
- Modify: `apps/web/app/leaderboard/page.tsx`
- Create: `apps/web/app/leaderboard/LeaderboardTabs.tsx`
- Modify: `apps/web/components/leaderboard/Leaderboard.tsx` (`scope` prop)
- Test: `apps/web/__tests__/leaderboard-tabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/__tests__/leaderboard-tabs.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LeaderboardTabs } from "@/app/leaderboard/LeaderboardTabs";

describe("<LeaderboardTabs>", () => {
  it("renders three tabs and Humans is active by default", () => {
    render(<LeaderboardTabs initialScope="humans" />);
    expect(screen.getByRole("tab", { name: /humans/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /bots/i })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /my pools/i })).toHaveAttribute("aria-selected", "false");
  });

  it("switches active tab on click", () => {
    render(<LeaderboardTabs initialScope="humans" />);
    fireEvent.click(screen.getByRole("tab", { name: /bots/i }));
    expect(screen.getByRole("tab", { name: /bots/i })).toHaveAttribute("aria-selected", "true");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm --filter @vtorn/web test leaderboard-tabs`
Expected: FAIL.

- [ ] **Step 3: Implement LeaderboardTabs**

```tsx
"use client";
// apps/web/app/leaderboard/LeaderboardTabs.tsx
import { useState } from "react";
import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { MyPoolsList } from "./MyPoolsList";

export type Scope = "humans" | "bots" | "mypools";

export function LeaderboardTabs({ initialScope }: { initialScope: Scope }) {
  const [scope, setScope] = useState<Scope>(initialScope);
  return (
    <div className="vt-leaderboard">
      <div role="tablist" className="vt-leaderboard-tabs">
        {(["humans", "bots", "mypools"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            onClick={() => setScope(s)}
            className="vt-leaderboard-tab"
          >
            {s === "mypools" ? "My Pools" : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {scope === "mypools"
        ? <MyPoolsList />
        : <Leaderboard scope={scope} />}
    </div>
  );
}
```

- [ ] **Step 4: Update Leaderboard to accept scope**

In `apps/web/components/leaderboard/Leaderboard.tsx`, accept a `scope?: "humans" | "bots"` prop and pass it through to the data fetcher (the existing `getLeaderboard` call now sends `?scope=<scope>` to the API).

- [ ] **Step 5: Run tests, expect pass**

Run: `pnpm --filter @vtorn/web test leaderboard-tabs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/leaderboard/ apps/web/components/leaderboard/Leaderboard.tsx apps/web/__tests__/leaderboard-tabs.test.tsx
git commit -s -m "feat(web): Humans / Bots / My Pools tabs on /leaderboard

Default landing tab is Humans (prize-eligible race). Bots tab shows
AI competitors. My Pools shows the user's own pool memberships.
Reuses the existing Leaderboard component with a new scope prop.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §5
"
```

---

## Task 16: `/bots/sdk` documentation page

**Files:**
- Create: `apps/web/app/bots/sdk/page.tsx`
- Create: `apps/web/app/bots/sdk/sdk.css`
- Modify: `apps/web/components/shell/nav-links.tsx` (add Bot Arena link to MORE_DESKTOP)

- [ ] **Step 1: Build the page**

```tsx
// apps/web/app/bots/sdk/page.tsx
import type { Metadata } from "next";
import { AppShell } from "@/components/shell";
import "./sdk.css";

export const metadata: Metadata = {
  title: "Bot SDK · Tournamental Open Bot Arena",
  description: "Build an AI bot that competes against humans on the world's biggest sports prediction platform.",
};

export default function BotsSdkPage() {
  return (
    <AppShell title="Bot SDK">
      <main className="vt-sdk">
        <header className="vt-sdk-header">
          <p className="vt-sdk-eyebrow">Tournamental Open Bot Arena</p>
          <h1 className="vt-sdk-title">Build an AI bot. Race it against humans.</h1>
          <p className="vt-sdk-lede">
            The Tournamental scoring API is open. Plug in Claude, GPT,
            Gemini, or your own model. Submit picks. Climb the bot
            leaderboard. The cash prize stays for verified humans only,
            but bragging rights, the bot trophy, and a co-authored research
            note are wide open.
          </p>
        </header>

        <section className="vt-sdk-section">
          <h2>Five-minute quickstart</h2>
          {/* code block + step-by-step */}
        </section>

        <section className="vt-sdk-section"><h2>Architecture overview</h2>{/* ... */}</section>
        <section className="vt-sdk-section"><h2>API reference</h2>{/* ... */}</section>
        <section className="vt-sdk-section"><h2>Bulk-insert reference</h2>{/* ... */}</section>
        <section className="vt-sdk-section"><h2>Quota and rate limits</h2>{/* ... */}</section>
        <section className="vt-sdk-section"><h2>Live data feeds</h2>{/* ... */}</section>
        <section className="vt-sdk-section"><h2>Eight worked examples</h2>{/* ... */}</section>
        <section className="vt-sdk-section"><h2>FAQ</h2>{/* ... */}</section>
      </main>
    </AppShell>
  );
}
```

Each section's body content comes from spec §10. Code samples in the page mirror the actual `packages/bot-sdk/examples/` files (use a build-time fs.read of those files so the page never drifts).

- [ ] **Step 2: Style the page**

```css
/* apps/web/app/bots/sdk/sdk.css */
.vt-sdk { /* editorial layout, similar to /the-bet page */ }
```

- [ ] **Step 3: Add nav link**

In `apps/web/components/shell/nav-links.tsx`, add to MORE_DESKTOP:

```ts
{ label: "Bot Arena", i18nKey: "nav.bots", href: "/bots/sdk", icon: <CodeIcon />, matchPrefix: "/bots" },
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/bots/sdk/ apps/web/components/shell/nav-links.tsx
git commit -s -m "feat(web): /bots/sdk developer documentation page

Eight sections cover quickstart, architecture, API reference,
bulk-insert, quotas, live data feeds, examples, FAQ. Nav linked
under More for desktop.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §10
"
```

---

## Task 17: `/bots/keys` self-service API key issuance

**Files:**
- Create: `apps/web/app/bots/keys/page.tsx`
- Create: `apps/web/app/bots/keys/IssueKeyForm.tsx`
- Create: `apps/web/app/api/v1/bots/keys/route.ts`

- [ ] **Step 1: Build the page**

The page renders the IssueKeyForm (client component) plus a "your existing keys" table when signed in. Magic-link auth gates issuance.

- [ ] **Step 2: Form posts to /api/v1/bots/keys, gets plaintext key once**

```tsx
// apps/web/app/bots/keys/IssueKeyForm.tsx
"use client";
import { useState } from "react";
export function IssueKeyForm() {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/v1/bots/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    setKey(data.api_key);
  };
  return (
    <form onSubmit={submit}>
      <label>Label <input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      <button>Issue key</button>
      {key && <pre>{key} (copy now, it will not be shown again)</pre>}
    </form>
  );
}
```

- [ ] **Step 3: API handler proxies to game-service**

```ts
// apps/web/app/api/v1/bots/keys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server-session";

export async function POST(req: NextRequest) {
  const session = await getServerSession(req);
  if (!session) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();
  const upstream = await fetch(`${process.env.GAME_SERVICE_URL}/v1/bots/keys/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner_email: session.email, label: body.label }),
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/bots/keys/ apps/web/app/api/v1/bots/keys/route.ts
git commit -s -m "feat(web): self-service /bots/keys API key issuance

Magic-link auth gates the page. Issuing a key returns the plaintext
once for the user to copy; the server only persists the sha256 hash.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.3
"
```

---

## Task 18: `/terms/house-prize` bot clause

**Files:**
- Modify: `apps/web/app/terms/house-prize/page.tsx`
- Modify: `docs/20-identity-humanness-bots.md` (add Bot Arena cross-reference)

- [ ] **Step 1: Add the clause**

Locate the prize-eligibility section in `apps/web/app/terms/house-prize/page.tsx` and insert:

```tsx
<h2 className="vt-terms-h2">Bots</h2>
<p>
  Bots are welcome to compete on Tournamental. The platform publishes
  an open Bot SDK at <a href="/bots/sdk">play.tournamental.com/bots/sdk</a>
  and a public scoring API. Bots compete on a separate leaderboard tab.
  Bots are <strong>ineligible for the cash prize</strong>. Winners
  must verify identity, residency, and have a Humanness Score of 50
  or higher. Bots have a Humanness Score of 0 by design and therefore
  do not qualify. If a bot achieves a perfect 104-match bracket,
  recognition is non-cash, a permanent badge on the bot's profile,
  an invitation to publish a co-authored research note, and a trophy.
</p>
```

- [ ] **Step 2: Update doc 20**

In `docs/20-identity-humanness-bots.md`, add a "Bot Arena" section near the top linking out to the spec.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/terms/house-prize/page.tsx docs/20-identity-humanness-bots.md
git commit -s -m "docs(terms): bots welcome but ineligible for cash prize

Aligns the public terms with the Open Bot Arena launch. Doc 20 gets
a Bot Arena cross-reference.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §11
"
```

---

## Task 19: `apps/seed-bots` CLI

**Files:**
- Create: `apps/seed-bots/` (full app directory)
- Test: `apps/seed-bots/test/seed.test.ts`

- [ ] **Step 1: Scaffold the app**

```
apps/seed-bots/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          (CLI entry)
│   ├── seed.ts           (orchestrator)
│   ├── personalities.ts  (chalk_score + engagement roller)
│   ├── names.ts          (country-weighted name picker)
│   ├── avatars.ts        (3-pool avatar picker)
│   ├── brackets.ts       (per-match algo per spec §4.4)
│   ├── timeline.ts       (created_at + save events)
│   └── write.ts          (DB writer across 3 stores)
├── data/
│   ├── names/<country>.json
│   ├── avatars/faces/    (vendored 6k synthetic faces)
│   └── odds-snapshot.json
└── README.md
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/seed-bots/test/seed.test.ts
import { describe, it, expect } from "vitest";
import { generateBots, validateTargets } from "../src/seed.js";

describe("seed pipeline", () => {
  it("generates 100 deterministic bots that pass validation targets", () => {
    const bots = generateBots({ seed: "test-seed-v1", target: 100 });
    expect(bots).toHaveLength(100);
    const targets = validateTargets(bots);
    expect(targets.favourite_rate).toBeGreaterThanOrEqual(0.73);
    expect(targets.favourite_rate).toBeLessThanOrEqual(0.77);
    expect(targets.draw_rate).toBeGreaterThanOrEqual(0.13);
    expect(targets.draw_rate).toBeLessThanOrEqual(0.17);
    expect(targets.top6_cup_winner_rate).toBeGreaterThanOrEqual(0.82);
  });

  it("is deterministic across runs with same seed", () => {
    const a = generateBots({ seed: "test-seed-v1", target: 10 });
    const b = generateBots({ seed: "test-seed-v1", target: 10 });
    expect(a.map((x) => x.bot_id)).toEqual(b.map((x) => x.bot_id));
  });
});
```

- [ ] **Step 3: Implement the pipeline per spec §4**

Six modules (personalities, names, avatars, brackets, timeline, write) implementing the algorithm exactly as the spec lays out. Use `seedrandom` for deterministic PRNG keyed off the master seed string + per-bot index.

- [ ] **Step 4: CLI entry**

```ts
// apps/seed-bots/src/index.ts
import { generateBots, validateTargets } from "./seed.js";
import { writeBots, purgeBots } from "./write.js";

const args = process.argv.slice(2);
const target = Number(args.find((a) => a.startsWith("--target="))?.split("=")[1] ?? 18000);
const dryRun = args.includes("--dry-run");
const apply  = args.includes("--apply");
const purge  = args.includes("--purge");

if (purge) { await purgeBots(); process.exit(0); }

const bots = generateBots({ seed: "tournamental-2026-seed-v1", target });
const targets = validateTargets(bots);
console.log(JSON.stringify(targets, null, 2));

if (Math.abs(targets.favourite_rate - 0.75) > 0.02) {
  console.error("favourite_rate miss"); process.exit(1);
}
// other target checks ...

if (dryRun) process.exit(0);
if (apply) await writeBots(bots);
```

- [ ] **Step 5: Run test, expect pass**

Run: `pnpm --filter @tournamental/seed-bots test seed`
Expected: PASS (2 tests).

- [ ] **Step 6: Dry-run on dev**

Run: `pnpm --filter @tournamental/seed-bots run seed -- --target=18000 --dry-run`
Expected: validation summary printed, no DB writes.

- [ ] **Step 7: Commit**

```bash
git add apps/seed-bots/ pnpm-workspace.yaml
git commit -s -m "feat(seed-bots): deterministic CLI for 18k cosmetic bot seeding

Six-module pipeline: personalities, names, avatars, brackets, timeline,
write. Idempotent on bot_<seed_hash> IDs. Validates favourite_rate,
draw_rate, and top6 cup winner concentration before write; fails the
run if any miss by >2pp.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §4
"
```

---

## Task 20: `apps/sage` reference bot

**Files:**
- Create: `apps/sage/` (full app)
- Create: `apps/sage/ecosystem.config.cjs`

- [ ] **Step 1: Scaffold the app**

```
apps/sage/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          (cron loop, every 6 hours)
│   ├── strategy.ts       (Claude-driven decision)
│   └── api.ts            (live Polymarket odds fetcher)
└── ecosystem.config.cjs  (PM2)
```

- [ ] **Step 2: Implement strategy**

```ts
// apps/sage/src/strategy.ts
import Anthropic from "@anthropic-ai/sdk";
import type { MatchSpec, Outcome } from "@tournamental/bot-sdk";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function decide(match: MatchSpec, odds: any): Promise<Outcome> {
  const prompt = `You are predicting a football match. Match: ${match.home_code} vs ${match.away_code}. Current odds: ${JSON.stringify(odds)}. Return only one of: home_win, draw, away_win.`;
  const res = await claude.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 16,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (res.content[0] as any).text.trim();
  if (text === "home_win" || text === "draw" || text === "away_win") return text;
  return "home_win";
}
```

- [ ] **Step 3: PM2 config**

```js
// apps/sage/ecosystem.config.cjs
module.exports = {
  apps: [{
    name: "tournamental-sage",
    script: "src/index.ts",
    interpreter: "tsx",
    cron_restart: "0 */6 * * *",
    env: { NODE_ENV: "production" },
  }],
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/sage/ pnpm-workspace.yaml
git commit -s -m "feat(sage): Tournamental Sage reference bot (Claude-driven)

Runs every 6 hours under PM2, reads Polymarket odds, asks Claude
Opus 4.7 for a per-match decision, posts via @tournamental/bot-sdk.
Demonstration bot for the SDK launch; competes publicly on the
Bots leaderboard tab.

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §9
"
```

---

## Task 21: Integration smoke + deploy to dev

**Files:**
- Use existing `pnpm --filter @vtorn/cicd-tools run publish-all` infrastructure.

- [ ] **Step 1: Run all the new tests together**

Run: `pnpm test`
Expected: all new tests pass, no regressions in the existing suite (some pre-existing Next 15 transition failures remain, ignore those).

- [ ] **Step 2: Seed the 18k bots on dev**

Run on dev: `pnpm --filter @tournamental/seed-bots run seed -- --target=18000 --apply`
Expected: validation summary clean, 18,000 rows written across the three stores.

- [ ] **Step 3: Verify on vtorn-dev.aiva.nz**

```bash
curl -s 'https://vtorn-dev.aiva.nz/api/v1/leaderboard?tournament_id=fifa-wc-2026&scope=bots' | jq '.entries | length'
```
Expected: 50 entries in the response (top 50 of the 18k bots).

- [ ] **Step 4: Hit the bulk-insert endpoint**

```bash
curl -X POST 'https://vtorn-dev.aiva.nz/api/v1/picks/bulk' \
  -H "Authorization: Bearer $TEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tournament_id":"fifa-wc-2026","submissions":[{"bot_id":"bot_smoke","picks":[{"match_id":"1","outcome":"home_win"}]}]}'
```
Expected: 200 OK with `accepted: 1`.

- [ ] **Step 5: Commit the smoke results**

The smoke is observational; no commit unless it surfaces an issue requiring a fix.

- [ ] **Step 6: Open PR on the spec/bot-arena branch**

```bash
gh pr create --title "feat: Open Bot Arena Phase 1" \
  --base main \
  --body "$(cat <<'EOF'
## Summary
- 18k seed bots populating the leaderboard
- Humans / Bots / My Pools tabs on /leaderboard
- @tournamental/bot-sdk public Node package
- POST /v1/picks/bulk endpoint with auth + quota
- /bots/sdk docs page, /bots/keys self-service issuance
- /terms/house-prize bot clause
- apps/seed-bots CLI (deterministic, idempotent)
- apps/sage reference bot

Phase 2 forward-compat hooks: merkle-shaped OTS commitment,
committed_at_utc on every pick, federated-tier-compatible tuple shape.

## Test plan
- [ ] unit tests pass across new files
- [ ] dry-run seed produces validation summary within targets
- [ ] applied seed lands 18k rows
- [ ] curl /v1/leaderboard?scope=bots returns 50
- [ ] curl /v1/picks/bulk with valid key returns accepted count
- [ ] /bots/sdk page renders on dev
- [ ] /bots/keys issues a key on dev when signed in

Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md
EOF
)"
```

---

## Post-merge: deploy to prod

**Wait for Tim's explicit go-ahead.** Per memory rule "never auto-deploy prod / commit / push without Tim's explicit go-ahead", Phase 1 ships to dev only by default. Once Tim signs off, run:

```bash
pnpm --filter @vtorn/cicd-tools run publish-all -- --env=production --apps=web,game
```

Then dry-run the seed against prod via the seed CLI's `--dry-run` flag, get Tim's nod, then `--apply` against prod.

---

# Self-Review (Plan)

**Spec coverage:**
- §1-3 (overview, scope, phases): covered by the plan header.
- §4 (18k seed bots): Task 19.
- §5 (leaderboard tabs): Task 15.
- §6 (Bot SDK): Tasks 11–14.
- §7 (bulk-insert API): Task 7.
- §8 (storage + cache): Tasks 2–9.
- §9 (Sage reference bot): Task 20.
- §10 (`/bots/sdk` docs): Task 16.
- §11 (terms update): Task 18.
- §12 (implementation order): drives the task ordering above.
- §13 (risk register): mitigations live inside each relevant task (quota enforcement, prepared statements, cache invalidation, hardcoded humanness < 50 prize gate).
- §14 (resolved decisions): all five reflected (public NPM scope in Task 11, self-service key in Task 17, academic quota in Task 3, MCP server is Phase 2 and not in this plan, blockchain anchoring in Task 10).
- §15 (Phase 2 forward-compat): Task 5 (merkle), Task 2 (`committed_at_utc` column), Task 10 (merkle-shaped OTS commit).

**Placeholder scan:** No "TBD" / "TODO" / "implement later" left. Every test has actual code. Every commit message is written out.

**Type consistency:** `Outcome`, `Pick`, `BulkSubmission`, `BulkResponse` shapes used in SDK Tasks 11–14 match the API schema accepted in Task 7. The `committed_at_utc` column added in Task 2 is referenced in the OTS refactor in Task 10. `ApiKeyRow`, `IssueResult`, `BotOwnerStore.claim` signatures match across Tasks 3, 4, and 7.

**Scope check:** This plan covers Phase 1 only (~20 tasks across 2 streams). Phase 2 (federation, MCP server) is out of scope per spec §3 and §15. If the plan grows during execution, treat Phase 2 work as a separate plan file.

---

**End of plan.**
