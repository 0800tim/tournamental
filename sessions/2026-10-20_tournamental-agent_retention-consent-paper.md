# 2026-10-20, retention and consent decision paper

**Task**: burn round 7, `docs/design/2026-10-data-retention-and-consent.md`, writing only.
**Branch**: `docs/retention-consent-paper` (worktree, docs only).

## What it covers

Seven decisions with options and a recommendation each: register-interest retention (RI-10: 60 days after the tournament for unconverted rows), double opt-in with confirmed-only referral counting (RI-12), the `erased_identifiers` table the policy's 12-month hash promise needs, OTP audit log rotation, journald and snapshot retention, the cookie banner's "Only essential" choice that leaves analytics granted, and the policy wording pass. One table on where the Privacy Act 2020 and the GDPR differ. Sources: the DSAR runbook (PR #349), the register-interest review (PR #336), the docs/33 refresh (PR #341), `ConsentBanner.tsx`, `GtmRoot.tsx`, `Analytics.astro`, `privacy.astro`, `cookies.astro`, docs/32.

## Needs Tim

Decisions 1 and 2 before the hub form is promoted; root changes for 4 and 5; the HighLevel confirmation workflow; the policy pass.
