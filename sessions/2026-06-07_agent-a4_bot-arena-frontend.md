# Bot Arena frontend (Agent A4)

**Task IDs**: bot-arena-phase-1 / Tasks 15, 16, 17, 18 (+ supporting nav, hub, terms)
**Refs**: docs/superpowers/specs/2026-06-07-bot-arena-design.md §5, §10, §11
        docs/superpowers/plans/2026-06-07-bot-arena-phase-1.md

## Plan (in order)

1. `/leaderboard` becomes a tabbed surface (Humans / Bots / My Pools). New
   `LeaderboardTabs` client component owns the tabstate; reuses existing
   `<Leaderboard>` with a new `scope` prop that flows through to the data
   fetcher.
2. `<Leaderboard>` gets an optional `scope?: "humans" | "bots"` prop. The
   current visual contract is unchanged; the prop is forwarded into a
   `data-scope` attribute and (later) into the real fetch URL.
3. `/bots/sdk` editorial documentation page with eight sections per §10.
   Style consistent with `/the-bet`.
4. `/bots/keys` self-service API key issuance page + client form. Server
   API at `/api/v1/bots/keys` proxies to game-service `/v1/bots/keys/issue`
   with the session-resolved email.
5. `/bots/node` documentation page for running a federated bot node (Phase
   2 forward-compat, but the page goes live now so operators can prep).
6. `/developers` hub page linking to /bots/sdk, /bots/node, /bots/keys,
   /run (A10 owns), GitHub, NPM, MCP docs.
7. `/terms/house-prize` gets a Bots section per §11 clause.
8. `MORE_DESKTOP` nav gets a "Bot Arena" entry pointing at `/developers`.
9. Tests under `__tests__/`: `leaderboard-tabs.test.tsx`,
   `bots-sdk-page-renders.test.tsx`, `terms-bot-clause.test.tsx`.

## Constraints

- `apps/web/` only. `apps/web/app/run/` is owned by A10.
- NZ English. No em-dashes anywhere.
- Conventional Commits, signed.

## Status

In progress.
