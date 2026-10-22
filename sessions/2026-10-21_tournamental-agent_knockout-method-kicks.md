# 2026-10-21 · The kicks method for rugby knockouts

status: done
docs: docs/design/rwc2027-engine-readiness.md (gap 4)

Rugby knockouts level after extra time and sudden death go to a kicking
competition. The game service's match-result schema and types now take
`method: "kicks"` beside `ft`, `et` and `pens`, and the archive label
helper renders it as "28-28 kicks". No storage change: the method column
is free text. Tests: web a11y labels (2 pass), game match-result schema
(14 pass). Nothing merged or deployed.
