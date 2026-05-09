---
id: 0034
title: '@vtourn/sdk' npm package v0.1.0
owner: unassigned
status: inbox
created: 2026-05-09
updated: 2026-05-09
priority: P2
labels: [sdk, developer-experience]
links:
  doc: docs/26-platform-strategy-and-syndicates.md
---

## What

`packages/sdk/` workspace package, publishable on npm as `@vtourn/sdk`. Wraps the public API + spec types + a thin R3F binding so third-party devs can integrate VTourn predictions and live match streams into their own product without depending on the full monorepo.

## Why

Per `docs/26` — VTourn becomes a platform when others can build on top of it. The SDK is the developer entry point; without it, integrators have to read the API docs and wire it themselves.

## Acceptance

- [ ] `packages/sdk/` exports: `VTourn` client, `useMatchStream` React hook, `MatchScene` R3F component.
- [ ] `pk_*` (publishable) and `sk_*` (secret) auth modes; `sk_*` server-side only enforced by runtime check.
- [ ] Published to npm on every tagged release via CI.
- [ ] README with quickstart + examples.
- [ ] Unit tests; example app at `apps/sdk-example/`.
- [ ] Bundle size budget: ≤ 80KB minified+gzipped for the JS-only bundle, ≤ 200KB for the R3F bundle.
- [ ] Types-first: `.d.ts` is canonical.

## Notes

- Reserve `@vtourn` org on npm before this lands — orchestrator/Tim coordination.
- SemVer carefully: every public-API change is a MAJOR if the type changes; PATCH/MINOR for additive.
