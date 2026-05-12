# examples/

Minimal, runnable examples for new contributors and AI agents.

Each example is a self-contained directory with a `README.md`, a single
entry point, and (ideally) one acceptance test. None depend on each
other — fork the one closest to what you want to build.

## What's here

| Folder | Build by hacking on… | Run with |
| --- | --- | --- |
| [`hello-mcp-tool/`](hello-mcp-tool/) | One new tool on the Tournamental MCP server. Adds `/v1/me/lucky-flag`. | `pnpm --filter @tournamental/example-hello-mcp-tool start` |
| [`hello-syndicate-page/`](hello-syndicate-page/) | A static branded syndicate page that pulls live leaderboard data from `game.tournamental.com`. | `cd examples/hello-syndicate-page && pnpm dev` |
| [`hello-affiliate-route/`](hello-affiliate-route/) | One new affiliate-router partner manifest, geo-gated, with a click audit log. | See its README. |
| [`hello-bracket-bot/`](hello-bracket-bot/) | A Node script that points at the public REST API + signs a bracket with a personal API key (`tnm_live_...`). | `node examples/hello-bracket-bot/index.mjs` |
| [`hello-plugin-scorer/`](hello-plugin-scorer/) | A `scorer` plugin awarding 10pt per correct outcome. The thinnest scorer reference. | `pnpm --filter @tournamental-plugin/example-hello-scorer test` |
| [`hello-plugin-odds/`](hello-plugin-odds/) | An `oddsSource` plugin returning deterministic synthetic implied probabilities. Template for a real odds feed. | `pnpm --filter @tournamental-plugin/example-hello-odds test` |
| [`hello-producer/`](hello-producer/) | A standalone Node WebSocket producer streaming a 90-min match (with scripted goals) into the renderer. | `pnpm --filter @tournamental/example-hello-producer start` |

## Run any example end-to-end in under 5 minutes

1. `pnpm install` at the repo root (installs every workspace).
2. `cd examples/<name>/`.
3. Read its README. Most need zero env config to run against the public
   prod API. The ones that hit private endpoints (MCP write tier, admin
   tools) say so in their README and link to the relevant `.env`
   snippet.
4. `pnpm dev` or follow the example's specific command.

## Submitting your own example

PRs welcome. The bar:

- One folder, one purpose, under 200 lines of code total.
- A `package.json` with `private: true` (these are not published).
- A `README.md` with: what it shows, how to run, one screenshot or
  curl-output sample.
- Cross-link from this README's table.
- Open the PR with the label **`example`** so the reviewer agent picks
  it up on the example-PR pipeline rather than the full repo CI.

If you wrote your example by pointing a coding agent at the repo with
the [AGENTS.md](../AGENTS.md) instructions, please mention which agent
in the PR body — we are tracking which agents produce mergeable
examples to improve our prompts.

## License

Each example inherits the repo's Apache 2.0 license unless its folder
contains its own `LICENSE` file.
