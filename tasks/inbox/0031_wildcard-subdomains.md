---
id: 0031
title: Wildcard *.vtourn.com tunnel ingress + slug resolution
owner: unassigned
status: inbox
created: 2026-05-09
updated: 2026-05-09
priority: P1
labels: [infra, syndicates]
links:
  doc: docs/26-platform-strategy-and-syndicates.md
---

## What

DNS + tunnel + app-side host routing so `<anything>.vtourn.com` lands on the app and resolves to a syndicate.

## Why

The whole syndicate model rides on this. Without wildcard subdomains, every host has to point users at `app.vtourn.com/syndicate/jason` — way less brandable than `jason.vtourn.com`.

## Acceptance

- [ ] Cloudflare DNS `*.vtourn.com CNAME app.vtourn.com (proxied)`.
- [ ] Tunnel ingress accepts `*.vtourn.com` and forwards to the app.
- [ ] App reads `Host:` (or `X-Forwarded-Host:`) and resolves to a syndicate via `syndicate_aliases` lookup.
- [ ] Reserved words protected (per `docs/26`): `www`, `app`, `api`, `admin`, `dev`, `preview`, `auth`, `static`, `cdn`, `dashboard`, `help`, `docs`, `blog`.
- [ ] Fuzzy match (Levenshtein ≤ 2): single match → redirect with notice; multiple → disambiguation page; none → "claim this name" page.
- [ ] Slug normalisation: lowercase, `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?`, length 3-63.

## Notes

- Test fuzzy resolver with a property-based test using a fixed slug fixture.
- DNS wildcard requires Cloudflare Pro plan? — Tim to confirm. If free plan blocks, add per-slug A records as a fallback.
