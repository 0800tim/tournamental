# 2026-10-22 — tournamental-agent — archive session notes older than 30 days

**Status**: done

**PR**: chore/archive-sessions (draft)

## Goal

Make the archival rule in sessions/README.md true for the first time: 104 of
the 133 notes in sessions/ were older than 30 days and nothing had ever moved
them.

## Reading

- sessions/README.md, the Archival section: `git mv` into sessions/archive/<YYYY>/,
  committed as `chore: archive sessions older than 30d`, monthly.
- CLAUDE.md "Memory and context": notes over 30 days old move to sessions/archive/.
- infra/deploy/lib/changed-apps.ts: sessions/** is ignored by the deploy
  classifier, so the move rebuilds nothing.

## Decisions

- **Age from the filename, not mtime**: the README recipe used `find -mtime +30`,
  which on a fresh clone sees every file as new. The script reads the
  `YYYY-MM-DD` prefix instead and leaves undated files alone. *Why*: the
  result must be the same on every checkout.
- **Script, not a one-off command**: `scripts/archive-sessions.sh` with
  `--dry-run` and a `DAYS` override, so the monthly chore is one command.
  The README's Archival section now points at it.
- **No link repair needed**: no markdown link anywhere in the repo points at a
  note older than the cutoff (checked docs, apps, infra and sessions/ itself;
  the 36 mentions inside sessions/ are plain text, not links). Three marketing
  blog posts mention `sessions/2026-05-*` paths as examples in prose and were
  left as written.
- **Cutoff on 22 October 2026 is 22 September**: the newest note that moved is
  dated 12 August; the oldest that stays is dated 16 October. No open PR
  touches any of the moved files.

## Outcome

What landed:
- scripts/archive-sessions.sh: the move, dry-run and cutoff override.
- sessions/README.md: Archival section rewritten around the script.
- 104 notes moved to sessions/archive/2026/ in the second commit.

Checks: dry run matched the hand count (104); the script was exercised in a
throwaway git repo (edge day stays, older moves, per-year folders, already
archived notes, README and daily/ untouched); `bash -n` clean. No vitest
suite applies to a file move.

What's left:
- Nothing for Tim beyond merging. Run the script again in late November.

## Refs

- sessions/README.md
- CLAUDE.md, Memory and context
