# sessions/

> Short markdown notes — one per agent-session — that document **what was decided and why** during a working session. Not a logbook; not a journal. The minimum that a future contributor (or future-you) needs to understand what just happened.

Older sessions auto-archive into `sessions/archive/<YYYY>/` after 30 days. Archive is `git mv` and committed in a `chore: archive sessions older than 30d` PR every month.

## Filename convention

```
sessions/<YYYY-MM-DD>_<agent-name>_<short-task>.md
```

Examples:
- `sessions/2026-05-09_orchestrator_phase-0.md`
- `sessions/2026-05-10_statsbomb-replay-builder_initial-event-mapping.md`
- `sessions/2026-05-12_renderer-builder_lerp-jitter-fix.md`

`<agent-name>` is your assigned role from [AGENT-PROMPTS.md](../AGENT-PROMPTS.md) or your GitHub handle for human contributors.

## Template

Copy this and fill it in at the start of your session. Update during work; finalise before sign-off.

```markdown
# <YYYY-MM-DD> — <agent-name> — <short-task>

**Status**: in-progress | done | blocked

**PR**: <link or "not yet">

## Goal

One sentence. What this session is supposed to produce.

## Reading

What I read before starting:
- docs/<n>-<name>.md — why
- packages/spec/src/index.ts — why
- previous session: <link>

## Plan

5–10 lines. Numbered list of steps I'll take.

## Decisions

Key decisions made during the session, with one line of context each. Format:

- **<topic>**: <decision>. *Why*: <reason>.

Example:
- **Coord-system flip handling in StatsBomb mapper**: applied at parse time, not at emit time. *Why*: avoids re-flipping during state-frame interpolation.

## Open questions

Anything I'd ask the orchestrator if I could. They review session notes daily.

## Outcome

(Filled in at sign-off.)

What landed:
- <component / file> — <one-line summary>

What's left:
- <thing> — <why deferred or why blocked>

Tests: <pass / fail counts>; new tests added: <count>.

## Refs

- docs/<n>
- IDEAS.md additions: <list>
- Related sessions: <links>
```

## What goes in / what doesn't

**Belongs in a session note**:
- The non-obvious choice you made (e.g. "used Hungarian assignment for player-ID inference because StatsBomb 360 frames don't carry player IDs").
- The thing you tried that didn't work (so future-you doesn't repeat it).
- The question you couldn't answer that needs the orchestrator.
- The IDEAS.md entry you parked.

**Doesn't belong**:
- A blow-by-blow diary ("then I edited line 42, then I ran tests, then I…"). The diff and the commit log already say that.
- Personal status ("I'm tired, finishing tomorrow"). Just mark `status: in-progress` and push.
- Anything sensitive (secrets, customer data, internal product strategy). The repo is open source.

## Why this exists

Two reasons, both load-bearing:

1. **Context recovery**. Anyone — you next week, a different agent, a new contributor — needs to be able to read the last few session notes and know where the project is. The docs answer "what is the design?"; the session notes answer "what just happened?"
2. **PR review quality**. The reviewer reads the linked session note alongside the diff. If your *why* is in the note, the reviewer can focus on *correctness* instead of guessing intent.

The discipline is small (5 minutes at start, 5 minutes at sign-off) and the payoff compounds across the project's life.

## Archival

Run from the repo root:

```bash
# In a chore: archive PR
mkdir -p sessions/archive/$(date +%Y)
find sessions -maxdepth 1 -name "*.md" -mtime +30 -not -name README.md \
  -exec git mv {} sessions/archive/$(date +%Y)/ \;
git commit -sm "chore: archive sessions older than 30d"
```

Archived notes stay searchable and linkable; they just don't clutter the active directory.
