# Archive — 2026-05-09 chunky-prototype

> Tim asked to preserve the first chunky cube-stub AR-FR demo for a build-process video blog. This doc + the live archive URL keep that prototype around.

## What "chunky" means

The state of the renderer immediately after the four parallel-builder PRs merged (`#10`, `#12`, `#13`, `#14`) and before PR `#31` (the fidelity upgrade) landed:

- Players were procedural capsules + jersey textures, not GLB bodies.
- No Wikidata face billboards.
- Flat directional lighting, no shadows, no sky, no ACES tonemapping.
- No timeline scrubber — strict streaming WebSocket.
- No manifest mode — couldn't seek.
- The "chunky cube teleport" Tim described in his 2026-05-09 review.

## Where it lives

- **Git tag**: `archive/2026-05-09-chunky-prototype` → commit `fbfac4c` (the post-merge-fixes commit, last main commit before PR #31).
- **Worktree on dev**: `/home/clawdbot/clawdia/projects/vtorn-prototype-chunky/` (detached HEAD at the tag).
- **Live URL**: `https://vtorn-prototype.aiva.nz/match/fifa-wc-2022-final-arg-fra-2022-12-18`. Cloudflared ingress → `localhost:3400`. The live AR-FR producer on `:4001` is shared with the HD demo; both renderers consume the same WS feed.

## Restoring locally

```bash
git checkout archive/2026-05-09-chunky-prototype
pnpm install
pnpm -F @vtorn/web dev    # serves on :3000 in this commit
# In another terminal: pnpm -F @vtorn/mock-producer build && node apps/mock-producer/dist/cli.js --seed=42 --time-scale=10 --out=ws --port=4001
# Then visit http://localhost:3000/match/<id>
```

## Restoring as a parallel live URL

```bash
git worktree add /tmp/vtorn-chunky archive/2026-05-09-chunky-prototype
cd /tmp/vtorn-chunky && pnpm install
cd apps/web
NEXT_PUBLIC_VTORN_WS_URL=wss://vtorn-stream.aiva.nz pnpm next dev -p 3400
# Add a tunnel ingress (per docs/22) for vtorn-prototype.aiva.nz → :3400.
```

## What lands after this archive

The HD upgrade in `#31` (b7f9a42 squash-merged as `b7f9a42`):
- Manifest mode in `@vtorn/spec-client` — fetch full `.ndjson(.gz)`, decompress in-browser, expose `seek(t_ms)` + `getStateAt(t_ms)`.
- `<TimelineScrubber/>` UI — drag any minute, score updates, goal markers, play/pause, 0.5x/1x/2x/5x/10x speed.
- `<BillboardFace/>` from `@vtorn/avatar` for every starter, populated from `data/wc2022-final-players.csv` (Wikidata Q-numbers → Wikimedia Commons thumbnails).
- Body GLB clone per player (Mixamo skeleton ready) replacing the capsule.
- drei `<Sky/>` + hemisphere + directional + `PCFSoftShadowMap` + ACES tonemapping.
- Procedural striped grass texture on the pitch.
- 62 vitest tests across 7 files.

## Why we keep both

1. **Tim's video blog** — captures the build journey end-to-end.
2. **A/B perf comparison** — the chunky version is a useful baseline for "is the new fancy stuff making things slower."
3. **Open-source storytelling** — a clean narrative for blog posts, tweets, and the marketing site `/why` page.

When this version's no longer useful for storytelling we'll prune the worktree (`git worktree remove /home/clawdbot/clawdia/projects/vtorn-prototype-chunky`) and remove the tunnel ingress.

## Refs

- Tag: `archive/2026-05-09-chunky-prototype` → `fbfac4c`
- HD-upgrade PR: #31 (b7f9a42)
- `docs/22-deployment-and-tunnels.md` — tunnel ingress runbook
