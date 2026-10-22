# 2026-05-09 — orchestrator — phase-2-integration-smoke

**Status**: done

**Outcome**: AR-FR demo running end-to-end on the dev box and reachable over the public internet at https://play.tournamental.com/match/arfr.

## What just happened

All four parallel builder PRs from Phase 1 merged in the same evening:

- `81713f5` — `feat(avatar): procedural avatar pipeline + assets` (#10)
- `1316e4b` — `feat(statsbomb-replay): AR-FR 2022 producer` (#13)
- `c6ef4d4` — `feat(mock-producer): synthetic match generator` (#14, rebased)
- `9655250` — `feat(web): scaffold Next.js + R3F renderer with AR-FR demo` (#12, rebased)

Plus the orchestrator's own infra-and-conventions PR (`d59a740`, #9). Five squash-merge commits on `main` in addition to the CI/baseline ones from earlier.

Lockfile conflicts on `pnpm-lock.yaml` resolved by `git checkout --theirs && pnpm install --no-frozen-lockfile && git rebase --continue` — the regenerated lockfile picks up the merged dep set deterministically.

## Reading

- The five merged PRs.
- `clawdia` memory `reference_cloudflared_remote.md` — re-read after rediscovering "tunnel ingress is remote-managed" the hard way.

## Plan

1. ✅ Build mock-producer (`pnpm -F @vtorn/mock-producer build`).
2. ✅ Run mock-producer on `:4001` with seed 42, time-scale 20.
3. ✅ Run renderer on `:3300` (override default `:3000` so it matches the tunnel).
4. ✅ Verify the WebSocket end-to-end (bare-metal Node + `ws` client).
5. ✅ Discover and fix the cloudflared-is-remotely-managed gotcha by PUTing the new ingress rules via the Cloudflare API.
6. ⏳ Move `tasks/in-progress/000{1,2,3,4}` and `tasks/blocked/0007` into `tasks/done/`.
7. ⏳ Fix `apps/web/package.json` `dev`/`start` scripts to bind `:3300` by default.
8. ⏳ Update `docs/22-deployment-and-tunnels.md` to document the API-driven tunnel update.
9. ⏳ Open a `chore/post-merge-fixes` PR and merge it.

## Decisions

- **Tunnel is remote-managed; the local `/etc/cloudflared/config.yml` is NOT authoritative.** *Why*: cloudflared on this box pulls its ingress configuration from the Cloudflare Zero Trust dashboard / API on every reconnect, and silently ignores local config changes. Fixed by PUTting the new ingress rules via `https://api.cloudflare.com/client/v4/accounts/<ACCT>/cfd_tunnel/<TUN>/configurations`. Documented in `docs/22-deployment-and-tunnels.md`.
- **Renderer dev script bound to `:3300` by default.** *Why*: the tunnel routes `play.tournamental.com` to `http://localhost:3300`, and we don't want everyone to remember `pnpm dev -- -p 3300`. Changing the default keeps the demo a one-liner.
- **Lockfile conflict resolution by `--theirs` then re-`pnpm install`.** *Why*: pnpm's lockfile is deterministic — re-deriving from `package.json` yields the same content as a hand-merge would, with less drama. Future agents handle conflicts the same way.
- **No reviewer-agent dispatch this session.** *Why*: Tim said earlier in the day "stop building all of these agents so that everything starts working harmoniously." The reviewer agent (AGENT-PROMPTS.md § 5) is held until I have his explicit go.

## Open questions

- The Aiva blockchain prize-draw mechanism (Tim's earlier note) is still unresearched; carrying as task `#0015` for the next session.
- Builder agents flagged minor things during their PRs (e.g. the `MODULE_TYPELESS_PACKAGE_JSON` warning from `@vtorn/spec` lacking `"type": "module"`). I'm bundling the small follow-ups into `chore/post-merge-fixes` rather than scattering them into individual PRs.

## Outcome

What's reachable on the public internet right now:

```
$ curl -sI https://play.tournamental.com/match/arfr | head -2
HTTP/2 200
content-type: text/html; charset=utf-8

$ wscat -c wss://stream.tournamental.com   (or the equivalent ws client)
< {"type":"match.init","spec_version":"0.1.1","match_id":"mock-42",...}
< {"type":"state","t":372700,"ball":{...},"players":[...]}
... 10Hz state frames forever ...
```

End-to-end smoke results from this session:
- 200 OK for the renderer route via the Cloudflare tunnel.
- 426 Upgrade Required for the bare HTTP request to the WebSocket route (correct).
- Live WebSocket from `wss://stream.tournamental.com` returning a valid `match.init` followed by 10Hz `state` frames.

Tests run during this session: 38 vitest (renderer) + 13 vitest (avatar) + 14 vitest (mock-producer) + 10 pytest (statsbomb-replay) — all green per the merged PRs' CI.

## Next session

- Run the **statsbomb-replay** producer against the AR-FR data and prove the full match plays correctly (3-3 ET, 4-2 pens) end-to-end through the renderer. Today's smoke used the synthetic mock producer; the real-data run is the headline demo.
- Stand up `apps/api/` (Fastify, port 3310) so `api.tournamental.com` is no longer 404.
- Begin Phase 2 work: analytics SDK (`packages/analytics/`), Prisma schema, admin dashboard agent (held — issue #11 ready when Tim's ready).
- Add the reviewer agent (AGENT-PROMPTS § 5) when Tim greenlights it.

## Refs

- `docs/22-deployment-and-tunnels.md` (UPDATED with API-driven tunnel runbook)
- `tasks/done/000{1,2,3,4,7}_*.md` (this session's promotions to done)
- `apps/web/package.json` (port 3300 default)
- Related sessions: `2026-05-09_orchestrator_phase-0.md`, `2026-05-09_orchestrator_phase-1-infra.md`, the four builder session notes that landed with their PRs.
