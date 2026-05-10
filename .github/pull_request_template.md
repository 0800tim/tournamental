<!--
  Thanks for sending a PR to Tournamental! Please fill out the sections
  below. The PR triage bot will post an automated security verdict
  (green / yellow / red) within ~5 minutes after the security workflow
  completes.

  See CONTRIBUTING.md and docs/security/01-pr-triage-process.md for the
  full review pipeline.
-->

## Summary

<!-- 1–3 sentences describing what changes and why. -->

## Motivation

<!-- Link to the doc(s), session note(s), or issue(s) this addresses. -->

## Test plan

<!-- How a reviewer can verify this works. Leave commands they can run. -->

## Screenshots / clips (if UI)

## Breaking changes

<!-- "None" if you didn't break anything. Otherwise list with migration notes. -->

## Pre-flight checklist

- [ ] I have read [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](../blob/main/CODE_OF_CONDUCT.md)
- [ ] My commits are signed off (DCO) — `git commit -s`
- [ ] I have added or updated tests for new behaviour
- [ ] I have updated docs in `docs/` where applicable
- [ ] My change does **not** add a new third-party network call without justifying it in [docs/security/03-third-party-dependency-policy.md](../blob/main/docs/security/03-third-party-dependency-policy.md)
- [ ] I have run `pnpm lint && pnpm typecheck && pnpm test` locally and they pass
