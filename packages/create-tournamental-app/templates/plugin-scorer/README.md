# __PKG_DISPLAY__

A scorer plugin for Tournamental, scaffolded from
`@tournamental/create-app`.

## What this does today

Awards 10 points for every correctly predicted match outcome. That's
intentionally simple — the point of the template is to be a 50-line
starting place, not a production rule-set.

## What to edit

1. **`src/index.ts`** — the `score()` function. This is where your
   scoring logic goes. The `bracket` argument has every prediction;
   the `results.actual` map has the real outcome per match. Return a
   `PointsBreakdown`.
2. **`src/index.test.ts`** — add tests for your scoring logic. The
   plugin SDK ships a test harness too; see
   [`@tournamental/plugin-sdk/test-harness`](https://www.npmjs.com/package/@tournamental/plugin-sdk).
3. **`plugin.json`** — fill in your name, repo URL, and (optionally)
   a `dripsListRef` if you want to opt into the contributor revenue
   split. See [`docs/19`](https://github.com/0800tim/tournamental/blob/main/docs/19-open-source-and-contributor-revenue.md).

## Running locally

```bash
pnpm install
pnpm test            # vitest, should pass out of the box
pnpm typecheck       # tsc --noEmit, should pass
```

## Submitting

Open a PR against the Tournamental repo with your plugin in the
`packages/plugins/` directory. Add the `skill: scorer` label so the
reviewer agent runs the scorer-plugin checklist. See
[CONTRIBUTING.md](https://github.com/0800tim/tournamental/blob/main/CONTRIBUTING.md).

## License

Apache 2.0 (inherited from the template).
