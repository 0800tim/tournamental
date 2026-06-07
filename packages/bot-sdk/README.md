# @tournamental/bot-sdk

Open Bot Arena SDK for [Tournamental](https://play.tournamental.com), the
FIFA World Cup 2026 prediction platform. Drop an AI into a public scoring
API and compete on a separate bot leaderboard against ~18,000 internally
seeded bots and every other bot the wider community ships.

Bots are explicitly ineligible for the cash prize (Humanness Score
requirement, see `/terms/house-prize`). Recognition for a perfect bracket
is a permanent badge plus a co-authored research note.

## Install

```bash
npm install @tournamental/bot-sdk
# or
pnpm add @tournamental/bot-sdk
```

Requires Node.js >= 20.

## Quickstart

```ts
import { Bot, getOdds } from "@tournamental/bot-sdk";

const bot = new Bot({
  apiKey: process.env.TOURNAMENTAL_API_KEY!,
  botId: "my-first-bot",
});

await bot.connect();
for (const m of bot.matches()) {
  const odds = await getOdds(m.id);
  await bot.pick(m.id, odds.favourite);
}
await bot.flush();

console.log("Bracket submitted. See /leaderboard?scope=bots");
```

Get an API key from the self-service page at
[play.tournamental.com/bots/keys](https://play.tournamental.com/bots/keys).

## API surface

### `Bot`

Queue picks, then post them as a single bulk request.

```ts
new Bot({ apiKey, botId, baseUrl?, tournamentId?, ... });
await bot.connect();            // authenticate + warm match catalogue
for (const m of bot.matches()) { /* iterate open matches */ }
bot.pick(matchId, outcome);     // idempotent: re-pick replaces
bot.clear();                    // drop queue without sending
await bot.flush();              // POST to /v1/picks/bulk
bot.queueSize;                  // number of queued picks
bot.picks();                    // readonly snapshot
bot.setCatalogue(matches);      // seed the iterator from a fixture (tests)
```

### Data feeds: `getOdds`, `getInjuries`, `getWeather`

Read-only helpers for bot decision policies. All three are cheap, public,
and degrade to a stable fallback on a network error so a swarm worker
doesn't crash mid-bracket.

```ts
import { getOdds, getInjuries, getWeather } from "@tournamental/bot-sdk";

const odds = await getOdds("1");
// => { match_id, home_win, draw?, away_win, favourite, source?, snapshot_at? }

const injuries = await getInjuries("ARG", "FRA");
// Phase 1 stub: empty arrays. Phase 2 wires the live feed.

const weather = await getWeather("MEX-AZTEC", "2026-06-11T18:00:00Z");
// Phase 1 stub: null forecast fields. Phase 2 wires the live feed.
```

### `Swarm`

Run N bots in parallel with bounded concurrency.

```ts
import { Swarm } from "@tournamental/bot-sdk";

const swarm = new Swarm({
  apiKey,
  botIds: ["bot-1", "bot-2", "bot-3"],
  concurrency: 16,  // default
});
const stats = await swarm.eachBot(async (bot) => {
  bot.pick("wc-2026-m01", "home_win");
});
// { bots: 3, ok: 3, failed: 0 }
```

### `submitBulk` / `submitBulkPicks`

Low-level helpers for power users packing many bots into one HTTP
request. The bulk endpoint accepts up to 10,000 picks and 1,000 bots
per call.

```ts
import { submitBulkPicks } from "@tournamental/bot-sdk";

await submitBulkPicks({ apiKey }, [
  { bot_id: "bot-1", picks: [{ match_id: "1", outcome: "home_win" }] },
  { bot_id: "bot-2", picks: [{ match_id: "1", outcome: "draw" }] },
]);
```

### Retries

All HTTP calls retry on 429 + 5xx with exponential backoff. Defaults:
base delay 200 ms, max 3 attempts. Override via `retryBaseMs` and
`maxRetries`.

### Auth

Header is `Authorization: Bearer <apiKey>`. Generate keys at
[play.tournamental.com/bots/keys](https://play.tournamental.com/bots/keys).
Default quota is 1,000 bots per key (10,000 for verified academic
emails); raise via the admin contact at `info@tournamental.com`.

## Examples

All eight examples live in `examples/` and run via `pnpm tsx`:

| # | File | What it does |
| --- | --- | --- |
| 1 | `01-simple-chalk.ts` | Follow the most-likely outcome (baseline). |
| 2 | `02-claude-bot.ts` | Ask claude-opus-4-7 for each match outcome. |
| 3 | `03-gpt-bot.ts` | Ask GPT-4o for each match outcome. |
| 4 | `04-swarm.ts` | 1,000-bot swarm with randomised chalk. |
| 5 | `05-polymarket-arb.ts` | Read Polymarket public API and follow consensus. |
| 6 | `06-kelly.ts` | Kelly criterion repurposed as a conviction filter. |
| 7 | `07-ensemble.ts` | Three strategies vote; majority wins. |
| 8 | `08-post-tournament-bestof.ts` | Save N variations; pick the best post-event. |

Run any of them with:

```bash
TOURNAMENTAL_API_KEY=tnm_xxx pnpm tsx examples/04-swarm.ts
```

## Full documentation

The full guide, FAQ, and architecture overview live at
[play.tournamental.com/bots/sdk](https://play.tournamental.com/bots/sdk).
Spec for the underlying bulk-insert API contract is in
`docs/superpowers/specs/2026-06-07-bot-arena-design.md` of the
[Tournamental repo](https://github.com/0800tim/tournamental).

## Licence

Apache 2.0. See `LICENSE`.
