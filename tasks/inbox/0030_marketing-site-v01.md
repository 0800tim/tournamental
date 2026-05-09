---
id: 0030
title: Marketing site v0.1 (vtourn.com)
owner: unassigned
status: inbox
created: 2026-05-09
updated: 2026-05-09
priority: P1
labels: [marketing, frontend]
links:
  doc: docs/26-platform-strategy-and-syndicates.md
---

## What

Static marketing site at `apps/marketing/` (Astro), deployed on Cloudflare Pages at `vtourn.com`. Dev URL: `https://vtorn-www.aiva.nz` → `:3320`.

## Why

Today the only public surface is the renderer demo. We need a marketing site that:
- Shows the AR-FR demo as the headline hero (30s clip).
- Pitches syndicates ("run your own pool at `yourname.vtourn.com`").
- Onboards developers (SDK quickstart + `npx @vtourn/mcp`).
- Tells the open-source story (link to repo + Apache 2.0 + Drips revenue share).
- Captures email signups for the launch list.

## Acceptance

- [ ] `/`, `/how-it-works`, `/syndicates`, `/affiliates`, `/contributors`, `/start`, `/git`, `/legal` routes shipped.
- [ ] Embedded AR-FR demo clip on `/` (auto-playing muted, with controls).
- [ ] Performance: LCP < 1s on a mid-range Android; lighthouse perf ≥ 95.
- [ ] No JS framework on `/legal` and `/git` (pure static).
- [ ] Cache policy from `docs/22` applied (24h edge cache, SWR 7d on static).
- [ ] Email-capture form posts to `apps/api`'s future `/v1/leads/subscribe` (stub OK; real wiring in a follow-up).

## Notes

- Brand: VTourn (not VTorn) on every marketing surface per `docs/26`.
- Use real Argentina + France logos? Public-domain via Wikipedia. Carefully attribute.
- Use the existing avatar + body assets in any subordinate visuals.
