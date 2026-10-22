# 2026-05-09 — renderer-builder — timeline + fidelity

**Status:** in-progress
**Branch:** `feat/timeline-scrubber-and-fidelity`
**Refs:** `tasks/in-progress/0017_timeline-scrubber-fidelity.md`, docs/04, docs/07

## Plan

Ship four visible improvements to the AR-FR 2022 demo renderer:

1. **`@vtorn/spec-client` manifest mode** — `manifestSource(url)` that fetches a
   gzipped or plain NDJSON dump, parses every line, sorts state frames + events
   by `t`, exposes `seek(t_ms)` / `getCurrentState(t_ms)` with lerping between
   bracketing frames. Backward-compatible with WS callers.
2. **Timeline scrubber UI** — `<TimelineScrubber>` over the canvas with play /
   pause, speed selector (0.5/1/2/5/10x), goal markers, time tooltip, projected
   score readout. Auto-mounts in manifest mode on `/match/[id]`. The route
   defaults to `/data/arfr-stream/fifa-wc-2022-final-arg-fra-2022-12-18.ndjson.gz`
   when match_id starts with `fifa-wc-2022-final` and no explicit src is set.
3. **Real face billboards** — replace the capsule body with a clone of
   `loadSharedBody()`, drop a `<BillboardFace>` above each player, build the
   face URL map at scene mount from `/data/wc2022-final-players.csv`, fall back
   to initials when no entry. Real jersey number from `player.number`.
4. **Scene fidelity** — hemisphere + directional lighting with PCF soft
   shadows, drei `<Sky>` for backdrop, procedural striped pitch grass, ball +
   players cast shadows / pitch receives. Optional bloom only if frame budget
   holds (no PR-blocking unless free).

## Open questions

- Synthetic `ARG_*` / `FRA_*` ids vs StatsBomb `player_id` numbers in the CSV:
  resolve face URLs by *name match* (case-fold + diacritics-normalised) rather
  than by id. Players whose name doesn't match fall back to initials.
- The full-match NDJSON is ~5.2 MB gzipped. We commit a small fixture for
  tests instead of the full file (which is gitignored).

## Notes / decisions

- New `manifestSource(url)` uses `DecompressionStream("gzip")` in browsers when
  the URL ends in `.gz`. In Node tests we feed it a raw NDJSON string via a
  test-only `manifestSourceFromText()` helper.
- The store gains a *manifest mode* that exposes `seek(t)` / `setPlaybackRate`
  / `setPlaying` without breaking WS-mode consumers — added as fields on a new
  `manifest` slice on `MatchStore`.
- Face URLs: we produce an HTTP-safe map by name. Wikidata Commons URLs are
  hot-linked at `?width=256` per CSV — that's plenty for billboard faces.
- We're prioritising visible polish over post-processing because perf budget
  on a 2022 mid-range Android is the gate.

## Caveats

- Touched `packages/avatar/src/billboard-face.tsx` to swap one
  `@ts-expect-error` → `@ts-ignore` so the consuming web package can
  typecheck without flagging the directive as unused. Behaviour
  unchanged. The package's own `pnpm -F @vtorn/avatar typecheck`
  still passes; this is a tiny ergonomics fix to unblock typecheck
  in the consumer.
- Pre-existing `pnpm -F @vtorn/web build` failure on `/_not-found` /
  `/_error` prerender (`useContext null`) is reproduced on the
  baseline `main` commit (`9655250`), so it's not introduced by this
  change. Brief gates push on typecheck + test, not build, so we
  proceed.

## Sign-off (end of session)

- Lint: passing (`pnpm -F @vtorn/web lint`).
- `pnpm -F @vtorn/web typecheck` ✓
- `pnpm -F @vtorn/web test` ✓ (62 tests pass)
- `pnpm -F @vtorn/spec-client typecheck` ✓
- `pnpm -F @vtorn/avatar typecheck` ✓
- Branch pushed to `feat/timeline-scrubber-and-fidelity`.
- PR opened (link TBD).
