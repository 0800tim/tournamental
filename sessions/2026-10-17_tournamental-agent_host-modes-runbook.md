---
status: done
agent: tournamental-agent
date: 2026-10-17
task: Write docs/runbooks/tournament-host-modes.md from the code (burn board, round 5)
refs: docs/runbooks/tournament-host-modes.md, docs/22-deployment-and-tunnels.md
---

# Host-modes runbook

Written by reading registry.ts, middleware.ts, lib/archive/server.ts
and context.tsx, app/layout.tsx, the shell components, the hub and
archive pages and the register-interest route at main e1e0eac9. Every
middleware step is listed in evaluation order. The curl checks in the
runbook were run against the live process on the box and printed the
documented results (hub rewrite 200, hub fallback 302 to the archive,
archive blocked path 302 home, archive POST 403, alias 301).

Covers: the three pieces, what each mode reads, the playbook for
taking RWC 2027 live (with the FWC-specific labels and OG defaults
that still need hand edits, and the register-interest 409 once no
tournament is upcoming), archiving a finished tournament, checks, and
gotchas. DNS and tunnel steps point at docs/22 only, per the board.

Draft PR, not merged.
