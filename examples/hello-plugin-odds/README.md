# hello-plugin-odds

The thinnest possible oddsSource plugin. Returns deterministic synthetic
implied probabilities for any `matchId`. ~50 lines of TypeScript. Use as
a copy-paste template for a real bookmaker / model feed.

## What it shows

- Minimum viable [`plugin.json`](plugin.json) manifest declaring
  `provides: ["oddsSource"]`.
- The `OddsSourcePlugin` interface from
  [`@tournamental/plugin-sdk`](../../packages/plugin-sdk).
- The `OddsSample` shape the core expects back (`outcomes` keyed by
  `home_win` / `draw` / `away_win`, summing to ~1.0).
- A real vitest test that proves probabilities sum to 1, are
  deterministic per `matchId`, and vary across matches.

## Run the test

```bash
pnpm install                                          # at repo root
pnpm --filter @tournamental-plugin/example-hello-odds test
# Expect: 4 tests passing.
```

## Hacking on it

Things to do next when adapting to a real source:

- **Replace the hash** with a `fetch()` against your odds feed. Wrap
  with a 2-second timeout — the core treats slow odds sources as null
  rather than blocking a request.
- **Vig handling.** Real bookmakers ship probabilities that sum to
  >1.0 (the overround). Either pre-normalise here, or set the
  `staleness_seconds` field truthfully and let the core's blender
  weight against it.
- **Caching.** The core calls `fetchProbabilities` on the request hot
  path. If your upstream is rate-limited, wrap the call in a 5-second
  in-memory cache keyed by `matchId`.
- **Multiple markets.** Use `outcomes` keys beyond
  `home_win/draw/away_win` (e.g. `correct_score:2-1`) when your source
  carries them — the blender ignores keys it doesn't recognise.

## Where it plugs in

The core mounts oddsSource plugins in `apps/odds-ingest/src/sources/`.
Multiple sources run in parallel; the blender combines them by weight
(see [`docs/12-odds.md`](../../docs/12-odds.md) and
[`docs/29-odds-plugin.md`](../../docs/29-odds-plugin.md)).

## Vocabulary

This is a **predictions / points-based** platform. No real money. When
you write copy, marketing, or docstrings for an odds plugin, use
*wagering*, *sweepstakes*, *betting*, *predictions*, or *challenges* —
never *gambling*. See [`skills/producer-author/SKILL.md`](../../skills/producer-author/SKILL.md).

## Licence

Apache-2.0. Fork freely. Credit by listing your plugin in
[`docs/28-plugin-architecture.md`](../../docs/28-plugin-architecture.md)
when you open the PR.
