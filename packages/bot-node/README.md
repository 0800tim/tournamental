# @tournamental/bot-node

Federated Tournamental bot node. Run your own bot swarm on your own
infrastructure, commit cryptographic merkle roots to the central server
before each kickoff, and report aggregate leaderboards once matches resolve.

Open source, Apache 2.0. Designed for swarm sizes from 100 to 1,000,000+ bots
on a single 32-core box.

> Phase 1 ships for FIFA World Cup 2026 launch on 11 June 2026. See
> [`docs/superpowers/specs/2026-06-07-bot-arena-design.md`](../../docs/superpowers/specs/2026-06-07-bot-arena-design.md)
> for the full design, including the federated protocol in section 15.

## 5-minute quickstart

```bash
# 1. install
npm i -g @tournamental/bot-node

# 2. register with the central server (one-time)
tournamental-bot-node register --email=you@example.com --label=swarm-01

# 3. generate 100k bots locally
tournamental-bot-node generate --bots=100000 --strategy=chalk

# 4. commit merkle roots for upcoming matches
tournamental-bot-node commit

# 5. score after each match resolves
tournamental-bot-node score --match-id=wc26-m37 --outcome=home_win

# 6. expose stats + audit proofs over HTTP
tournamental-bot-node serve   # listens on :4080
```

For a zero-network smoke test:

```bash
tournamental-bot-node --bots=100 --strategy=chalk --dry-run
```

This generates 100 bots against the bundled demo catalogue and prints the
resulting merkle root without contacting the central server.

## Docker

```bash
docker compose up -d
# then:
docker compose exec bot-node tournamental-bot-node register --email=you@example.com
docker compose exec bot-node tournamental-bot-node generate --bots=100000
docker compose exec bot-node tournamental-bot-node commit
```

Persistent state lives in `./data/bot-node.db` (mounted into the container).

## Environment variables

| Variable                   | Default                          | Purpose                                                   |
| -------------------------- | -------------------------------- | --------------------------------------------------------- |
| `TOURNAMENTAL_NODE_DB`     | `./data/bot-node.db`             | Path to the SQLite database.                              |
| `TOURNAMENTAL_CENTRAL_URL` | `https://api.tournamental.com`   | Central server base URL.                                  |
| `TOURNAMENTAL_MATCHES`     | (uses demo catalogue if unset)   | Optional path to a `MatchSpec[]` JSON file for offline.   |
| `PORT`                     | `4080`                           | HTTP server port.                                         |
| `HOST`                     | `0.0.0.0`                        | HTTP server bind host.                                    |
| `LOG_LEVEL`                | `info`                           | Fastify log level.                                        |

## Performance tuning

The default settings are tuned for swarm sizes up to ~1M bots on a 32-core
40GB box:

- SQLite is opened in WAL mode with `synchronous = NORMAL`. Durability is
  bounded by the cadence of merkle commits to the central server, which is
  the authoritative ledger.
- Bulk inserts use a single prepared statement inside a transaction per
  batch (`batchSize` defaults to 5,000 bots).
- Picks are stored with `(bot_id, match_id)` as the primary key so the
  upsert path is a single B-tree lookup.

To push toward 10M bots:

- Move `data/` to NVMe.
- Raise `batchSize` to 25,000 (smaller transactions, more concurrent
  throughput on modern SSDs).
- Run the generate step inside `screen` or `tmux`; the CLI prints progress
  every 25k bots.

## Strategies

The default strategy is `chalk-v1`: each bot blends the published implied
odds toward the favourite by its own `chalk_score` (deterministically drawn
from `[0.65, 0.90]` per bot). To plug in your own strategy, implement the
`Strategy` interface and import the library form:

```ts
import { generateBots, Storage, type Strategy } from "@tournamental/bot-node";

const claudeStrategy: Strategy = {
  name: "claude-v1",
  decide(match, ctx) {
    // call your model; return { outcome: 'home_win' | 'draw' | 'away_win' }
  },
};

const storage = new Storage({ path: "./data/bot-node.db" });
generateBots(storage, matches, { count: 10_000, strategy: claudeStrategy });
```

## Audit verification

Every commit produces a merkle root that is published to the central
server before kickoff, anchored to a Bitcoin block via OpenTimestamps, and
re-published in the public leaderboard. To verify any single pick:

```bash
# operator side, served by the node
curl http://localhost:4080/v1/proof/<match_id>/<bot_id>
```

The response includes the pick, the merkle path, the root, and the
`commit_log` row. A third-party verifier can replay the path with the same
sorted-pair sha256 rules used here and compare the root to the central
server's record.

If the node tampers with the local DB after the fact, the merkle proof
fails. If the central server tampers with the leaderboard, the OTS-anchored
root provides an independent timestamp. This is the "trust-minimised"
property described in spec §15.4.

## Library API

```ts
import {
  Storage,
  generateBots,
  commitMatch,
  scoreMatch,
  registerNode,
  CentralClient,
  createServer,
  chalkStrategy,
} from "@tournamental/bot-node";
```

See `src/index.ts` for the full type surface.

## Operator etiquette

- Pick a label that identifies you publicly. Cheating (post-hoc selective
  reporting, late commits) gets you delisted from the federated leaderboard
  for the rest of the tournament.
- Keep your `node_secret` out of git. The node only ever uses it to sign
  POSTs to the central server.
- If your node falls behind on commits, that match is recorded but excluded
  from leaderboard scoring. The deadline is the kickoff timestamp on the
  match spec, not a soft window.

## Development

```bash
pnpm --filter @tournamental/bot-node install
pnpm --filter @tournamental/bot-node build
pnpm --filter @tournamental/bot-node test
```

## Updating to a new release

Tournamental publishes strategy and protocol updates regularly. Running an
out-of-date bot-node still posts to the leaderboard, but your picks will trail
real-world signal. The most recent release, **v0.2.0**, fixes a calibration bug
where chalk-blended group matches resolved to all-draws and the cup-winner
cascade favoured longshots. Full changelog at
`https://github.com/0800tim/tournamental/releases`.

### Check the current version

```bash
docker exec tournamental-bot-node tournamental-bot-node --version
```

### Update via Docker (preferred)

Pull the new image and recreate the container in place. The named-volume bot
data is preserved across the upgrade (the SQLite DBs survive container
recreate).

```bash
cd path/to/your/docker-compose-dir
docker compose pull
docker compose up -d --force-recreate
```

### Update via npm (if you embedded the SDK directly)

```bash
npm install @tournamental/bot-node@latest
# or pin a specific version:
npm install @tournamental/bot-node@0.2.0
```

### Verify the update worked

- Hit the node's `/stats` endpoint and confirm the version field reflects the
  new release. If your build doesn't expose `version` on `/stats` yet, rely on
  the CLI `--version` output instead.
- Open a sample bot's bracket on
  `play.tournamental.com/run/bots/<index>` and confirm group matches no longer
  all resolve to `Draw`, and the cup-winner pick is not a tournament longshot.

### Versioning policy

- Tournamental uses semver.
- `0.x.x` is pre-1.0. Strategy and protocol semantics may change with a minor
  bump, so `0.1 → 0.2` is a breaking strategy change.
- Pin major + minor in production: `@tournamental/bot-node@^0.2.0`.
- Subscribe to GitHub releases at
  `https://github.com/0800tim/tournamental/releases` for changelogs.

### Got bots running on an old version?

Previously-generated bot brackets stay on the leaderboard. The commits are
immutable, so nothing you already published gets rewritten. Only new batches go
through the new strategy. Recommended sequence: stop the swarm, update,
restart. No bot-history loss.

## Licence

Apache 2.0. See `LICENSE`. Submit issues and PRs at
`https://github.com/0800tim/tournamental`.
