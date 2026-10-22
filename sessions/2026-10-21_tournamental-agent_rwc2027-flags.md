# 2026-10-21 · Flags for the RWC 2027 unions

status: done
docs: docs/design/rwc2027-engine-readiness.md (gap 5, flags)

`apps/web/scripts/download-flags.mjs` now takes a teams file path
(default unchanged: the 2026 file) and skips flags already present.
`data/rwc-2027/teams.json` lists the 24 unions (code, name, emoji,
Commons file, licence, ranking of 1 December 2025). Ran the script
once: ten new SVGs in `apps/web/public/flags` (CHI, HKG, ITA, GEO,
ROU, FIJ, WAL, TGA, ZIM, SAM), each parsed as well-formed XML, each
reported as "Public domain" by the Commons `extmetadata` API and
recorded as such in the teams file. Largest is Fiji at 40 KB (Spain's
existing flag is 156 KB). The 13 other unions already had flags from
the 2026 set.

Licence note per CLAUDE.md: external assets, Wikimedia Commons, public
domain, compatible with Apache 2.0; source URLs in the teams file.

## Needs Tim

- IRE: the IRFU flag is the union's own mark and is not on Commons
  under a free licence. Source it from the union or approve a
  substitute (the four-province flag, or the tricolour with a note).
