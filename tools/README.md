# `tools/` — repo automation

Small typed utilities that maintain repo hygiene without a human in the
loop. Owned by the orchestrator; reviewed on every PR like any other
workspace package.

## `daily-report.ts` — daily progress-report generator

Walks the repo every night and writes a markdown summary to
`sessions/daily/<YYYY-MM-DD>.md`. The orchestrator can hand-edit
freely afterwards; the script is idempotent and appends an
`## Update appended at <HH:MM> UTC` block on subsequent runs.

### What it captures

| Field             | Source                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| Commit list       | `git log --since=<date>T00:00:00Z --until=<date>T23:59:59Z`                   |
| Commit-type mix   | Conventional Commit prefix regex over the subjects (`feat`, `fix`, `docs`, …) |
| Apps inventory    | `apps/*/package.json` — name, description, port grepped from start/dev script |
| Packages          | `packages/*/package.json` — name + description                                |
| Test counts       | `pnpm test --run --reporter=basic 2>/dev/null \| tail -3`                     |
| Open pull requests| `gh pr list --json number,title,createdAt,state` (best-effort)                |
| Service ports     | Regex over `--port`, `-p`, `PORT=` patterns in app dev/start scripts          |

If `gh` isn't installed or `pnpm test` fails, the script records a
warning in the report and carries on — it never blocks cron.

### Run it

From the repo root:

```bash
# Today's report, written to sessions/daily/YYYY-MM-DD.md
pnpm daily-report

# Specific date
pnpm daily-report -- --date=2026-05-10

# Preview to stdout, do not write a file
pnpm daily-report -- --date=2026-05-10 --dry-run

# Skip the (slow) workspace test pass
pnpm daily-report -- --date=2026-05-10 --skip-tests
```

Or from anywhere:

```bash
pnpm --filter @vtorn/tools run daily-report -- --date=2026-05-10
```

### Cron

The cron wrapper is `tools/daily-report-cron.sh`. It runs the
generator, then commits, pushes, and opens a PR for the orchestrator
to review/merge. Recommended cron line — runs at 08:00 UTC,
summarising the previous calendar day:

```cron
0 8 * * * /home/clawdbot/clawdia/projects/vtorn/tools/daily-report-cron.sh \
  >> /var/log/vtorn-daily-report.log 2>&1
```

The wrapper:

1. `git fetch + rebase main`.
2. Generates the markdown via `pnpm --filter @vtorn/tools run daily-report`.
3. Commits to `daily-report/<date>` with author `0800tim@gmail.com`,
   conventional subject `docs(daily): <date> progress report`,
   signed-off (`-s`).
4. Pushes and opens a PR via `gh` (no-ops if `gh` isn't installed).

### Tests

```bash
pnpm --filter @vtorn/tools test
```

Covers:

- Conventional Commit subject parsing (`feat(scope): …`, scopeless,
  unstructured, breaking-change marker).
- Type-count aggregation over a synthetic git log.
- Port extraction across the patterns in our actual `package.json`s
  (Next.js `-p NNNN`, Astro `--port NNNN`, env-style `PORT=NNNN`).
- CLI argument handling (`--date`, `--dry-run`, `--skip-tests`,
  malformed dates).
- Render output structure — front-matter, headline numbers, every
  expected section heading.
- **Idempotency**: re-running for the same date appends an
  `## Update appended at` block instead of overwriting.

### Constraints

- Pure Node TS, no runtime deps beyond `tsx` for execution.
- The script never commits — `daily-report-cron.sh` owns the git
  surface so a developer can `--dry-run` safely.
- NZ English in all prose (matches the rest of the repo).
