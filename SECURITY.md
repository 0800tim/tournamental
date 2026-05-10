# Security policy

> VTourn is open source. We take security seriously and we want you to feel safe disclosing problems to us.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Use one of these private channels:

- Preferred: open a [private security advisory](https://github.com/0800tim/vtorn/security/advisories/new) on GitHub. This routes directly to the maintainers and lets us collaborate on a fix in a private fork.
- Email: `security@vtourn.com`. PGP key fingerprint pending publication; for high-sensitivity reports we will respond within 24h with a key.

Please include:

1. A description of the issue and its impact.
2. Steps to reproduce, including the affected commit / version.
3. Any proof-of-concept code (please be considerate — no live exploits against our production users).
4. Your name and a contact handle (we will publicly thank you in `CHANGELOG.md` after the fix unless you prefer otherwise).

## What's in scope

- Anything in this repository's source code, including the apps under `apps/`, packages under `packages/`, and infrastructure scripts under `infra/`.
- Our deployed surfaces under `*.vtourn.com` and `*.aiva.nz` (dev).
- Our smart contracts (when they ship — see [docs/21-onchain-pool-and-oracle.md](docs/21-onchain-pool-and-oracle.md)). For contracts we additionally run a formal external audit before mainnet.

## What's out of scope

- Third-party services we depend on (e.g. Polymarket, the Cloudflare tunnel). Report those upstream.
- Social-engineering attacks against our maintainers or community.
- Denial-of-service via unreasonable traffic. Please don't.
- Issues that require physical access to a contributor's device.
- Findings against test fixtures inside `sessions/`, `docs/`, or `*.test.ts` files (those are intentionally synthetic).

## Response SLA

- **Acknowledge**: within 24 hours of receipt.
- **Triage** (severity assigned + a plan): within 72 hours.
- **Fix or mitigate**: within 7 days for HIGH and CRITICAL severity. MEDIUM within 30 days. LOW on a best-effort basis.

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
- For HIGH+ findings: a brief post on `vtourn.com/blog` describing the issue, fix, and what changed in our pipeline to prevent recurrence.

## Bug bounty

VTourn does not currently run a paid bounty programme. We will acknowledge contributors publicly and prioritise their next-day responses. If you'd like to advocate for a paid programme, please open a [discussion](https://github.com/0800tim/vtorn/discussions).

## Hall of fame

Researchers who have responsibly disclosed issues will be listed here, in `CHANGELOG.md`, and in any post-mortem we publish.

## How we test ourselves

Every PR runs an automated security pipeline — see [docs/security/](docs/security/) for the full architecture:

- `gitleaks` (secret scanning)
- `OSV-Scanner` (dependency vulnerabilities)
- `semgrep` (static analysis: OWASP top 10 + JS/TS rules + secrets)
- License audit (allowlist-only)
- Network-host allowlist (greenfield third-party calls flagged)
- Secret-scope audit (env vars must be in `.env.example`)
- Prompt-injection canary (for any change to prompt or content files)
- CODEOWNERS gating on sensitive paths
- An autonomous PR triage bot that scores risk 0–100 and routes to humans

A scheduled `security-watchdog` workflow re-scans the repo daily and weekly, files findings into a tracked store, and pages on-call for HIGH and CRITICAL severity. See [docs/security/05-security-watchdog.md](docs/security/05-security-watchdog.md).
