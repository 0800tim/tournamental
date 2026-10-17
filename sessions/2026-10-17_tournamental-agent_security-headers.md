# 2026-10-17, security headers for apps/web

**Task**: burn round 6, add security headers to apps/web (docs/33 refresh found play and fwc2026 sent only cache-control).
**Branch**: `feat/web-security-headers` (worktree).

## What changed

- `apps/web/lib/security/headers.mjs`: one module, imported by `next.config.mjs` and by the tests, that builds the header rules. Always: nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy denying camera, microphone, geolocation, payment and USB, and a report-only CSP. On every page except the partner embed (`?embed=1`) and `/embed/*`: `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.
- `apps/web/next.config.mjs`: `headers()` returns those rules; adds the `NEXT_PUBLIC_ODDS_API_URL` origin to connect-src when set; allows `'unsafe-eval'` only outside production.
- `apps/web/__tests__/platform/security-headers.test.ts`: 15 cases: base headers, CSP directives (blob: workers, GTM bootstrap, auth-sms, odds, game, stream), framing per request shape for live, hub, archive and embed paths, and the exact `has`/`missing` rule shape.

## Verification

- vitest 15 passed; eslint clean.
- Throwaway `next dev` on 127.0.0.1:3399 in the worktree, curled with Host headers: play `/` 200 with all six headers; play `/leaderboard` (hub 302) and fwc2026 `/leaderboard` (archive 302) also carry them; `/world-cup-2026?embed=1` and `/embed/*` get the base headers and no framing headers. Server stopped by PID.
- HSTS is left to the Cloudflare zone setting on purpose.

## Needs Tim

- Merge, build, restart `tournamental-web`, then watch the browser console on the hub and the archive for CSP report-only violations for a week before promoting the policy. There is no report endpoint, so violations only show in devtools.
- Turn on HSTS at the Cloudflare zone (covers every hostname at once).
- Later: move `script-src` to a nonce so `'unsafe-inline'` can go.
