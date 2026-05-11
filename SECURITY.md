# Security policy

> Tournamental is open source under **Apache License 2.0**. We take security seriously and we want you to feel safe disclosing problems to us.

## Reporting a vulnerability

**Do not open a public GitHub issue, pull request, or discussion for security problems.**

Use one of these private channels:

- Preferred: open a [private security advisory](https://github.com/0800tim/tournamental/security/advisories/new) on GitHub. This routes directly to the maintainers and lets us collaborate on a fix in a private fork.
- Email: `0800tim@gmail.com` with subject line starting `[tournamental-security]`. PGP key fingerprint pending publication; for high-sensitivity reports we will respond within 24 hours with a key.
- Backup email: `security@tournamental.com` (forwards to the same inbox; the gmail address is the source of truth while we are pre-launch).

Please include:

1. A description of the issue and its impact.
2. Steps to reproduce, including the affected commit or deployed version.
3. Any proof-of-concept code (please be considerate, no live exploits against production users).
4. Your name and a contact handle (we will publicly thank you in `CHANGELOG.md` after the fix unless you prefer otherwise).

## What's in scope

- Anything in this repository's source code, including the apps under `apps/`, packages under `packages/`, and infrastructure scripts under `infra/`.
- Our deployed surfaces under `*.tournamental.com`.
- Our published npm packages under the `@tournamental` scope.
- Our smart contracts (when they ship, see [docs/21-onchain-sweepstakes-oracle.md](docs/21-onchain-sweepstakes-oracle.md)). Contracts additionally pass a formal external audit before mainnet.

## What's out of scope

- Third-party services we depend on (see "Sub-processors" below). Report those upstream.
- Social-engineering attacks against our maintainers or community.
- Denial-of-service via unreasonable traffic volume, slowloris-style stalls, or other resource exhaustion attacks that any internet-facing service is expected to weather. Please don't.
- Brute-force attempts against test accounts, demo data, or rate-limited public endpoints. Use your own account for proof-of-concept.
- Issues that require physical access to a contributor's device.
- Missing security headers on marketing-only pages with no auth surface (we will accept the report but it likely scores Info).
- Findings against test fixtures inside `sessions/`, `docs/`, or `*.test.ts` files (those are intentionally synthetic).
- Reports generated solely by automated scanners with no triage or impact analysis attached.

## Response SLA and disclosure window

- **Acknowledge**: within 24 hours of receipt.
- **Triage** (severity assigned + a plan): within 72 hours.
- **Fix or mitigate**: within 7 days for HIGH and CRITICAL severity. MEDIUM within 30 days. LOW on a best-effort basis.
- **Public disclosure**: **90 days** from initial report, or sooner if a fix has shipped and we have agreed a co-ordinated disclosure date with the reporter. If we need an extension we will ask in writing and explain why; the reporter has the final call.

## Severity rubric

We use the [CVSS v3.1](https://www.first.org/cvss/v3.1/) base scoring as a starting point, then adjust for the realistic exposure of our public surfaces.

| Severity  | Examples                                                                |
| --------- | ----------------------------------------------------------------------- |
| Critical  | Unauthenticated RCE; database compromise; auth bypass on `/auth-sms`.    |
| High      | Authenticated privilege escalation; bypass of identity provider linking. |
| Medium    | Reflected XSS in marketing site; CSRF on admin endpoints with weak gates. |
| Low       | Information disclosure with limited utility; rate-limit gaps.            |
| Info      | Best-practice deviations with no exploitable consequence.                |

## Disclosure

We follow **coordinated disclosure**. After a fix lands, we publish:

- A GitHub Security Advisory on the affected repo.
- A `CHANGELOG.md` entry crediting the reporter (unless you opt out).
- For HIGH+ findings: a brief post on the [engineering log](https://tournamental.com/engineering) describing the issue, fix, and what changed in our pipeline to prevent recurrence.

## Bug bounty

Tournamental does not run a traditional cash bounty programme. Instead, valid disclosures are scored against the contributor revenue ledger and **paid in streaming USDC from the Tournamental Drips Network treasury**, per [docs/19-open-source-and-contributor-revenue.md](docs/19-open-source-and-contributor-revenue.md).

- Critical disclosures earn a meaningful one-off score bump on top of the regular contributor pool.
- High disclosures earn a smaller bump.
- Medium and Low earn standard contributor credit.
- Info earns a public thank-you; no score impact.

To receive payout, register your GitHub username + an Ethereum address per the contributor onboarding in doc 19. You may also opt out of payment entirely and we will still credit you in the security advisory and changelog.

## Sub-processors and dependencies

Tournamental's production surfaces rely on the following sub-processors. We surface this list so security researchers understand the data-flow boundary before reporting. Vulnerabilities in these services themselves should be reported upstream to the relevant vendor.

- **Supabase** (managed Postgres + auth) -- user records, sessions, predictions, leaderboards.
- **Cloudflare** (DNS, CDN, Workers, Tunnel, WAF) -- public edge for every Tournamental surface.
- **Aiva SMS** (SMS + WhatsApp gateway) -- OTP delivery for the auth flow.
- **GoHighLevel** (CRM) -- syndicate signups, marketing automation.
- **npm registry** -- distribution channel for the `@tournamental/*` packages.
- **GitHub** -- source hosting, issues, discussions, releases, advisories.
- **Drips Network** (Ethereum mainnet + L2) -- on-chain contributor revenue treasury.
- **Polymarket** (data, read-only) -- prediction-market odds used for difficulty scoring.
- **StatsBomb Open Data** (read-only) -- historical match data used for the replay demos.

## Hall of fame

Researchers who have responsibly disclosed issues will be listed here, in `CHANGELOG.md`, and in any post-mortem we publish.

## How we test ourselves

Every PR runs an automated security pipeline, see [docs/security/](docs/security/) for the full architecture:

- `gitleaks` (secret scanning)
- `OSV-Scanner` (dependency vulnerabilities)
- `semgrep` (static analysis: OWASP top 10 + JS/TS rules + secrets)
- License audit (allowlist-only)
- Network-host allowlist (greenfield third-party calls flagged)
- Secret-scope audit (env vars must be in `.env.example`)
- Prompt-injection canary (for any change to prompt or content files)
- CODEOWNERS gating on sensitive paths
- An autonomous PR triage bot that scores risk 0 to 100 and routes to humans

A scheduled `security-watchdog` workflow re-scans the repo daily and weekly, files findings into a tracked store, and pages on-call for HIGH and CRITICAL severity. See [docs/security/05-security-watchdog.md](docs/security/05-security-watchdog.md).
