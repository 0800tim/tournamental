# `@vtorn/admin` — Tournamental admin dashboard

Internal operations console. Next.js 14 + Tailwind, dark theme by default.

- **Dev**: `pnpm --filter @vtorn/admin dev` → http://localhost:3340
- **Tests**: `pnpm --filter @vtorn/admin test`
- **E2E**: `pnpm --filter @vtorn/admin test:e2e`
- **Prod URL**: `https://admin.tournamental.com`

## Configuring auth

Admin sign-in is a WhatsApp-OTP step-up gate behind Cloudflare Access.
The legacy magic-link / log-mailer / Resend / `ADMIN_EMAILS` flow has
been removed: the only way in is a WhatsApp OTP delivered to the
hard-coded `ADMIN_PHONE_E164` and verified against the
`ADMIN_ALLOWED_USER_IDS` allowlist.

Copy `.env.example` to `.env` and set:

```bash
ADMIN_PHONE_E164=+64XXXXXXXXXX
ADMIN_ALLOWED_USER_IDS=u_be5a445cff4347f6ae6089
ADMIN_JWT_SECRET=$(openssl rand -base64 48)
ADMIN_MANAGE_JWT_SECRET=$(openssl rand -base64 48)
ADMIN_AUTH_SMS_BASE_URL=https://auth.tournamental.com
```

If either `ADMIN_PHONE_E164` or `ADMIN_ALLOWED_USER_IDS` is empty the
dashboard is locked: the login form refuses input and the request
endpoint responds 503. This is the default for a fresh checkout.

`ADMIN_MANAGE_JWT_SECRET` is used to sign admin-minted manage JWTs
issued by `/api/admin/syndicates/[slug]/impersonate`. It is deliberately
distinct from `AUTH_JWT_SECRET` (which auth-sms uses for `tnm_session`)
so a compromised admin surface cannot forge user sessions.

## RBAC

Three roles:

| Role          | Read | Ban users | Toggle flags | Revoke API keys |
| ------------- | :--: | :-------: | :----------: | :-------------: |
| `viewer`      |  yes |     no    |      no      |       no        |
| `mod`         |  yes |   yes     |      no      |       no        |
| `super-admin` |  yes |   yes     |     yes      |      yes        |

See `lib/perms.ts` for the full matrix.

## Endpoints (proxied to apps/api)

The admin app is a thin BFF. Real data lives behind `/v1/admin/*` on
`apps/api`. The BFF mints a 60-second HS256 JWT (audience
`vtorn-api-admin`) per upstream call, signed with `ADMIN_JWT_SECRET`.

When the upstream isn't available (or `ADMIN_USE_MOCKS=1`) the BFF
falls back to deterministic mock data from `lib/mocks.ts` so the UI
remains useful for design and tests.

## Audit log

Every state-changing action calls `writeAudit()` in `lib/audit.ts`,
which appends to `.admin-audit.jsonl` (override path with
`ADMIN_AUDIT_LOG_PATH`). The canonical store is the Postgres
`admin_audit_log` table from `apps/api/migrations/0001_admin_tables.sql`.

## Adding a new page

1. Create `app/<surface>/page.tsx` as a server component.
2. Call `requireAuth()` at the top.
3. If it mutates anything, write the matching API route under
   `app/api/<surface>/route.ts`, gate with `can(session.role, "...")`,
   and call `writeAudit()` after a successful upstream call.
4. Add the link to `components/Sidebar.tsx` (set `minRole` if it
   shouldn't appear for lower roles).
