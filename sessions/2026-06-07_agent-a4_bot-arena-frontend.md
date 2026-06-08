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

Complete (Phase 1 frontend). 5 commits on branch `feat/bot-arena-launch`.

## Outcome

- `/leaderboard` now ships with three audience tabs (Humans default,
  Bots, My Pools); roving-tabindex + arrow-key nav; `<Leaderboard>`
  carries a `scope` prop that flows into `data-scope` and the future
  fetch URL.
- `/bots/sdk` editorial doc page with eight TOC-anchored sections per
  spec §10, FAQ accordion, code samples for quickstart + bulk insert
  + live data feeds.
- `/bots/keys` server-component-gated issuance page + client form +
  `/api/v1/bots/keys` proxy to game-service `/v1/bots/keys/issue`.
  Server stores only the SHA-256 hash; plaintext key shown once.
- `/bots/node` federated bot-node operator guide (Phase 2 forward-
  compat; ships now so prospective operators can prep).
- `/developers` hub linking to /bots/sdk, /bots/keys, /bots/node,
  /run (A10), GitHub, NPM, MCP server.
- `/terms/house-prize` gets section 4a "Bots" anchored at #bots per
  spec §11 clause (welcome to compete, ineligible for cash, non-cash
  recognition).
- `MORE_DESKTOP` nav gets a Bot Arena entry pointing at /developers.
- 16 new unit tests (3 files) + 9 pre-existing Leaderboard tests all
  pass; typecheck clean on every touched file.

## Files touched

Added:
- apps/web/app/leaderboard/LeaderboardTabs.tsx
- apps/web/app/bots/sdk/{page.tsx,sdk.css}
- apps/web/app/bots/keys/{page.tsx,IssueKeyForm.tsx,keys.css}
- apps/web/app/api/v1/bots/keys/route.ts
- apps/web/app/bots/node/page.tsx
- apps/web/app/developers/{page.tsx,developers.css}
- apps/web/__tests__/leaderboard-tabs.test.tsx
- apps/web/__tests__/bots-sdk-page-renders.test.tsx
- apps/web/__tests__/terms-bot-clause.test.tsx
- sessions/2026-06-07_agent-a4_bot-arena-frontend.md

Modified:
- apps/web/app/leaderboard/{page.tsx,leaderboard.css}
- apps/web/components/leaderboard/Leaderboard.tsx
- apps/web/components/shell/nav-links.tsx
- apps/web/app/terms/house-prize/page.tsx

## Blockers

None for Phase 1 ship. The `/api/v1/bots/keys` proxy needs
`GAME_SERVICE_URL` configured in the deployment environment and the
upstream `/v1/bots/keys/issue` endpoint live (Stream A / Tasks 3 + 6
of the plan); the proxy returns a clean 503 with a configuration-
mismatch error message otherwise so it fails closed during the
launch dry-run.
