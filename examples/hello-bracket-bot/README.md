# hello-bracket-bot

A minimal Node script that builds a randomised World Cup 2026 bracket,
signs it with a personal API key, and submits it to the live game
service. Useful as a starting point for:

- Bots that play their own brackets and post the results.
- Backfill scripts that seed historic predictions.
- Load tests against the public submission endpoint.
- Anyone curious how the bracket cascade resolves.

Total: ~80 lines of code, zero dependencies beyond `node:fetch`.

## Run it

```bash
# 1. Mint a personal API key at https://play.tournamental.com/profile/api-keys
#    and export it
export TOURNAMENTAL_API_KEY=tnm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 2. Run
node examples/hello-bracket-bot/index.mjs
```

Output:

```
[hello-bracket-bot] fetching 48-team field…
[hello-bracket-bot] resolved 48 teams, 8 groups
[hello-bracket-bot] picked random group winners + runners-up
[hello-bracket-bot] cascading through R32 → R16 → QF → SF → Final
[hello-bracket-bot] champion: BRA  runner-up: ARG  third-place: FRA
[hello-bracket-bot] submitting to game.tournamental.com…
[hello-bracket-bot] saved as bracket d64a707a-…  shareable at https://play.tournamental.com/s/d64a707a-…
```

## What it shows

1. **Public read tier** — `GET /v1/teams` and `GET /v1/fixtures/2026` need
   no auth, return JSON, edge-cached.
2. **Personal API key tier** — `POST /v1/bracket` requires
   `Authorization: Bearer tnm_live_…`. Keys are minted at
   `/profile/api-keys`; the server stores a scrypt hash, never the
   plaintext. See [docs/54-personal-api-keys.md](../../docs/54-personal-api-keys.md).
3. **Bracket cascade** — picking 8 group winners + 8 runners-up
   deterministically resolves the entire knockout tree via the
   `@tournamental/bracket-engine` package. The example does this in
   plain JS, but a real bot can `import { cascade } from
   "@tournamental/bracket-engine"`.

## Hacking on it

Things this script doesn't do, that you could add:

- Read odds from `odds.tournamental.com` and bias picks toward favourites.
- Pull the user's prior brackets to seed picks consistently with their style.
- Listen for live match results via the WebSocket stream at
  `wss://stream.tournamental.com`, watch your score change in real time.
- Cross-post the resulting `/s/<guid>` share URL to Discord or Telegram.

Each of these is a separate `examples/` folder waiting to be written.
PRs welcome. See [examples/README.md](../README.md).

## License

Apache 2.0, same as the rest of the repo.
