---
status: complete
task: Fix match calendar to group/order by the viewer's local timezone
docs: docs/04-renderer.md (calendar surface), task #150
---

# Calendar local-timezone fix

## Problem

The full-list match calendar (`/world-cup-2026/calendar`) grouped its day
headers in the **venue** timezone. An NZ (GMT+12) viewer saw the opener under
"Thursday, 11 June 2026" (Mexico GMT-6 local) when, in their own time, the
13:00 GMT-6 kickoff is 07:00 GMT+12 on **Friday, 12 June 2026**. The per-row
"your time" was already correct; only the day header was wrong.

A second, compounding issue: rows were sorted by FIFA match number, which
groups by group (Group A's three matchdays span the whole group stage before
Group B starts). That scattered the same calendar date down the page as many
fragmented day headers (101 groups for 104 matches; "Friday 12 June" appeared
repeatedly).

## Fix

1. `apps/web/app/world-cup-2026/calendar/CalendarList.tsx` — day-header
   grouping now resolves the viewer's browser timezone client-side
   (`Intl.DateTimeFormat().resolvedOptions().timeZone`) via useState+useEffect.
   SSR and the first client paint keep the venue-tz fallback so the grouped
   DOM structure matches and React does not throw a hydration mismatch; after
   mount the list re-groups in local time.
2. `apps/web/app/world-cup-2026/calendar/build-rows.ts` — sort rows by
   `kickoff_utc` (tie-break on match number) instead of match number, so the
   calendar reads top-to-bottom by date with one header per match day.

## Verification

Verified on play-dev in a Pacific/Auckland browser:
- Day groups: 101 -> 33 (one per real match day), zero duplicate headers.
- Chronological: Fri 12 Jun -> Sat 13 -> ... -> Mon 20 Jul (final).
- Opener correctly under "Friday, 12 June 2026".
- Clean hydration (no mismatch errors).

## Deploy

Committed to main (7d0e07c) and deployed web to production via
`pnpm --filter @vtorn/cicd-tools run publish-all -- --env=production --apps=web`.
