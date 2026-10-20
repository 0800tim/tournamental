# 2026-10-20, admin Customer 360: masked PII with an audited reveal

**Task**: burn round 7, mask phone and email in the admin console by default and audit every reveal with IP and user agent (docs/33 item from PR #341).
**Branch**: `fix/admin-customer360-pii` (worktree, from main).

## What changed

- `apps/admin/lib/pii.ts`: `maskEmail`, `maskPhone` (wraps `maskAdminPhone`), `maskPii`, and `requestContext(headers)` for the client IP (first `x-forwarded-for` hop, then `cf-connecting-ip`) and user agent. Both masks are idempotent so the page and the component can each apply them.
- `apps/admin/lib/audit.ts`: `writeAudit(session, write, ctx?)` records `ip` and `ua` when given; existing callers unchanged. The log path is read at call time so tests can point it at a temp file.
- `app/api/users/[id]/reveal/route.ts` and `app/api/highlevel/contacts/[id]/reveal/route.ts`: `POST { kind }`, session and `users.read` checks, write `pii.reveal` with the target, the field, IP and user agent, then return the value. Reads only; the HighLevel route re-reads the recent-contacts snapshot.
- `components/RevealPii.tsx`: masked text plus Show (labelled "this is logged"), Hide, and an error line that says the attempt was still logged.
- `users/[id]/page.tsx` masks the CRM contact before it crosses into the client component; `Customer360Tabs.tsx` masks again and renders `RevealPii`; the HighLevel page masks its contact column and reveals through the HighLevel route.

## Tests

`__tests__/lib/pii.test.ts`, `audit-context.test.ts`, `reveal-routes.test.ts`, `__tests__/components/RevealPii.test.tsx`, and the existing `customer360Tabs.test.tsx` updated to expect the mask. 31 pass. One case in `customer360Tabs.test.tsx` ("delete confirm requires typing the userId") fails on untouched main too (checked in a throwaway worktree) and is not touched here. eslint and tsc clean on the changed files. No HighLevel calls; fixtures use invented addresses.

## Not covered, for Tim

The users list (`UsersTable.tsx`) still shows the email column, and it is also a search key; masking there needs a decision on search. The user page header line shows `u.email`. Both are one-line changes once decided.
