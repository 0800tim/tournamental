# 2026-10-20, independent code review of the 17 October draft PRs

**Task**: burn round 7, read-only review of the runtime changes in #335, #336, #343, #345 and #348.
**Branch**: `docs/draft-pr-code-review` (worktree, docs only). The review was done by a fresh agent with no part in writing those PRs; findings only, no code changed on their branches by this PR.

## Result

`docs/reviews/2026-10-draft-pr-code-review.md`: 1 high, 5 medium, 19 low. The ones that matter: the SEC-WEB-01 Origin guard and `ARCHIVE_BLOCKED_API` both test the raw path, so a locale prefix (`/es/api/v1/...`) skips them and the middleware rewrite delivers the request to the route with method and body intact (#335, #336); a `final` match id maps to stage `final`, not `f`, so a hand-settled final would vanish from the archive list (#343); the framing rule in #345 blanks every in-iframe click inside the partner embed, which today lands on the archive host; the report-only CSP omits the Telegram login origins (#345). #348 is sound apart from a conflict with #343 and four hygiene items.

## Follow-up

The fixes are small and are being applied on the branches themselves as separate commits (same day), each with a test, and the review records what was found before the fixes.

## Needs Tim

The hold on #345 lifts once the archive-host exemption is in (done the same day) and the live-mode embed navigation plan is agreed: links inside the partner iframe need `target="_top"` or to carry `?embed=1` before the framing rule is enforced in live mode.
