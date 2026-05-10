# Contributing to Tournamental

> Welcome. Tournamental is **100% open source** under Apache 2.0 (code) and CC-BY-4.0 (docs). This guide is for both human contributors and code agents — the workflow is the same. By following it, you keep the project clean enough that anyone can drop in and contribute.

## TL;DR

- Read [CLAUDE.md](CLAUDE.md) for the operations protocol.
- One change per PR. Rebase, don't merge-commit.
- Conventional Commits, DCO-signed (`git commit -s`).
- Lint + typecheck + tests pass locally before push.
- A reviewer agent or human reviewer must approve before merge.
- Out-of-scope ideas go in [IDEAS.md](IDEAS.md), not in your PR.
- Session notes in `sessions/` describe what you did and why.
- Code goes through a security and spec-conformance review on every PR.

## Set up your environment

The dev server has Node 20+, pnpm 9+, Python 3.11+, ffmpeg, Redis, and Docker pre-installed. For local development on your own machine, install those plus:

```
git config commit.gpgsign true       # signed commits encouraged
git config user.signingkey <fp>      # set yours
git config core.editor <your-editor>
```

Clone and bootstrap:

```bash
git clone <repo-url> vtorn
cd vtorn
pnpm install                         # installs all workspace packages
```

Each app has its own `README.md` with run instructions specific to it.

## Workflow

### One change per PR

A PR addresses one logical change. "Add jersey-texture generator" is one PR. "Add jersey-texture generator and fix camera lerp jitter" is two PRs. Smaller PRs review faster and merge cleaner.

### Branch naming

```
feat/<short-summary>          new feature
fix/<short-summary>           bug fix
docs/<short-summary>           doc-only changes
chore/<short-summary>          tooling, config, deps
refactor/<short-summary>       code restructure without behaviour change
perf/<short-summary>           performance improvement
test/<short-summary>           test-only addition / change
```

Use lowercase, hyphens, ≤40 chars after the slash.

### Conventional Commits

Every commit message:

```
<type>(<scope>): <subject>

<optional body, wrapped at 80 cols, explaining WHY>

<optional footer with refs and breaking-change notes>

Refs: docs/<n>
Refs: sessions/<note>
Signed-off-by: Your Name <you@example.com>
```

Types: `feat | fix | docs | chore | test | refactor | perf | ci | build | style`. Subject in imperative mood, no trailing period, ≤72 chars.

DCO sign-off (`-s`) is required on every commit. Without it, CI rejects the PR.

### Pull request

Open the PR with `gh pr create --fill` (uses your last commit) or via the GitHub UI. The PR body should:

- Link to the relevant doc(s) (`Closes #123`, `Refs docs/04-renderer.md`).
- Link to your session note in `sessions/`.
- Summarise *why* (the diff shows what).
- List the files touched in 1–2 sentences.
- Note any behaviour changes that affect other agents or apps.

Do not add screenshots/videos to the body unless they directly help reviewers; link to a `sessions/` artifact instead. Keep the PR description scannable.

### Review

The CI pipeline runs first:

```
1. Lint:        pnpm lint  +  uv run ruff check (Python)
2. Type check:  pnpm typecheck  +  uv run mypy (Python, where applicable)
3. Unit tests:  pnpm test  +  uv run pytest
4. Build:       pnpm build (each affected app)
5. Spec check:  validate any emitted JSON against packages/spec types
6. Security:    gitleaks (secrets), npm audit / pip-audit (CVE),
                eslint-plugin-security (basic patterns)
7. Format:      prettier --check, black --check
```

All seven must pass. CI failures auto-comment on the PR with the failing step.

After CI is green, a reviewer (the reviewer-agent or a human contributor) runs through the checklist below. They either approve, or leave a numbered list of changes requested. The PR author addresses each, pushes new commits to the branch, CI re-runs, reviewer re-reviews. Loop until approved.

The orchestrator (or, in human-only contributor flows, a maintainer) merges. Reviewers do not merge.

### Reviewer checklist

```
Build & test:
[ ] CI green
[ ] New code has tests; tests exercise the change, not just smoke pass

Spec conformance:
[ ] All emitted messages validate against packages/spec
[ ] No spec changes (those are orchestrator-only)
[ ] Coordinate-system conventions match doc 02

Security:
[ ] No secrets in diff (gitleaks)
[ ] External code attributed and licence-compatible
[ ] Input validation on new HTTP / WS endpoints
[ ] No unsafe deserialisation, eval, or Function constructor
[ ] Authentication boundaries respected (no bypass paths)

Code quality:
[ ] No leftover debug prints or commented-out code
[ ] Reasonable function sizes; no >500-line new files
[ ] Names follow project conventions

Documentation:
[ ] Public-behaviour change → docs/*.md updated in the same PR
[ ] Session note in sessions/ summarises the work

Commit hygiene:
[ ] Conventional Commits with DCO sign-off
[ ] No merge commits — rebase only
```

## Sessions and ideas

Every working session writes a note at `sessions/<YYYY-MM-DD>_<your-name>_<short-task>.md`. See [`sessions/README.md`](sessions/README.md) for the template.

Out-of-scope ideas go to [IDEAS.md](IDEAS.md). Don't expand a PR scope mid-session.

## Spec changes

The JSON message spec ([docs/02-spec.md](docs/02-spec.md), [`packages/spec/`](packages/spec/)) is the contract every other component depends on. **Do not modify it in a regular PR.** If you discover that the spec is missing something:

1. Open an issue describing the missing capability and link to the doc(s) where the gap appears.
2. The orchestrator (or maintainer) escalates to the design author.
3. A spec change ships as its own PR with a version bump (semver: minor for additive, major for breaking) and synchronised updates to docs/02-spec.md.
4. After the spec PR merges, your downstream PR consuming the new shape can land.

## Smart contract changes

Any PR touching `contracts/` (Solidity) requires:

- Slither static analysis pass.
- Foundry test suite run with 100% line coverage on changed files.
- A note in the session about the audit implications.
- For mainnet-bound changes: full external audit before deployment per [doc 21](docs/21-onchain-sweepstakes-oracle.md).

## Security disclosures

If you discover a security issue (not just a bug):

- **Do not open a public issue.**
- Email `security@tournamental.com` (TBD — reserve before launch) or DM the maintainers via Telegram.
- Include a clear reproducer.
- We commit to acknowledging within 48 hours and patching within 14 days for high-severity issues.

We will publicly credit the reporter unless they prefer to remain anonymous, and (once Tournamental Holdings has revenue) issue a bounty proportional to severity from the strategic-reserve fund per [doc 19](docs/19-open-source-and-contributor-revenue.md).

## Contributor revenue share

Code contributors who opt in receive a streaming USDC share of platform revenue via the Drips Network, per [doc 19](docs/19-open-source-and-contributor-revenue.md). To opt in:

1. Register your GitHub username + an Ethereum address at `tournamental.com/contributors/register` (URL active once Tournamental Foundation is incorporated).
2. After your PR merges, your contribution is auto-scored by `apps/contribution-scorer/` and you appear on the next quarterly score sheet at `payouts/<YYYY>-q<N>.md`.
3. Drip List updates quarterly; payouts are continuous after the update lands on-chain.

You can contribute without registering — many contributors prefer not to receive payments for tax / personal / philosophical reasons. Apache 2.0 either way.

## Code of conduct

Be kind. Assume good faith. Critique code, not people. Disagreements are resolved by reference to the docs first, then by the orchestrator's call.

We follow the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Violations: contact a maintainer; persistent violations result in PR-rights or ban.

## Questions

- Design questions: open an issue tagged `design`. The orchestrator triages weekly.
- Implementation questions: ask in the PR or in your session note. Reviewer agents pick them up during review.
- Strategic / business questions: tag `strategy` and `cc @maintainers`.
