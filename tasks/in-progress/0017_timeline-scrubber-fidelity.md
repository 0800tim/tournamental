---
id: 0017
title: Timeline scrubber + AR-FR replay file + real faces + scene fidelity
owner: agent:renderer-builder
status: in-progress
created: 2026-05-09
updated: 2026-05-09
priority: P0
labels: [renderer, ar-fr-demo, fidelity]
links:
  pr: ""
  doc: docs/04-renderer.md
---

## What

Ship four visible upgrades to the AR-FR 2022 renderer demo so it's
shareable end-to-end: manifest playback (with seek), a scrubbable
timeline, real Wikidata faces on every starter, and a proper lighting
+ pitch + sky pass.

## Why

The renderer currently stares at a live producer and shows capsule
players. To demo the AR-FR final off-line we need a deterministic
manifest replay (gzipped NDJSON) the renderer can scrub through, with
the actual 22 starters' faces and a stadium that doesn't look like a
2009 web demo.

## Acceptance

- [ ] `manifestSource(url)` in `@tournamental/spec-client` fetches plain or
      `.gz` NDJSON, parses to typed messages, sorts state frames +
      events by `t`, exposes `seek(t)` / `getCurrentState(t)` lerp.
- [ ] `<TimelineScrubber/>` renders in manifest mode with play/pause,
      speed (0.5/1/2/5/10x), goal markers, time tooltip, projected
      score readout.
- [ ] `/match/[id]` auto-uses the bundled gzipped NDJSON when the id
      starts with `fifa-wc-2022-final` and no `?src=` is set.
- [ ] Player avatars use the shared body GLB clone with real face
      billboards from the players CSV (initials fallback per spec
      docs/07).
- [ ] Lighting rig uses hemisphere + directional with PCF soft shadows;
      sky and procedural pitch grass present; ball + players cast
      shadows; pitch receives.
- [ ] `pnpm -F @vtorn/web typecheck && pnpm -F @vtorn/web test &&
      pnpm -F @tournamental/spec-client typecheck` all pass.

## Notes (rolling)

- StatsBomb player_ids in the CSV don't match the synthetic id format
  (`ARG_*` / `FRA_*`) — resolved by name match (case-fold +
  diacritics-normalised), with initials fallback.
- Full match NDJSON is gitignored. We commit a small fixture (init +
  a few state frames + the goal events) at
  `apps/web/public/data/arfr-stream/__fixture__.ndjson` for the test
  suite. Real demo URL points at the full file produced by
  `apps/statsbomb-replay`.
