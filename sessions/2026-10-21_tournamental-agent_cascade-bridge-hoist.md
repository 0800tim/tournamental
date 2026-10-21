# 2026-10-21 · One bracket-to-cascade helper

status: done
source: IDEAS.md (2026-05-11, share-landing)

`bracketToCascadeInput` lived twice: `apps/web/lib/bracket/cascade-bridge.ts`
(nine importers) and a private copy in the game service's share-page
summariser. The two had converged on the same rules (orders only for
complete groups, best thirds from the user's picks, knockouts left to
the cascade), so the helper now lives in `@tournamental/bracket-engine`
(`src/bridge.ts`, exported from the index and built by tsup). The web
module re-exports it so its importers are unchanged; the game service
imports it and drops the copy. An optional `nowIso` pins the
`updated_at_utc` fallback so tests do not read the clock.

Tests: engine 98 pass (5 new in `test/bridge.test.ts`), engine and game
typechecks clean. No behaviour change intended. Nothing merged or
deployed.
