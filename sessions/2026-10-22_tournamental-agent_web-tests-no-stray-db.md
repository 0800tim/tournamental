# 2026-10-22 — tournamental-agent — web tests stop writing a sqlite file into the tree

**Status**: done

**PR**: fix/web-tests-no-stray-db (draft)

## Goal

Every full run of the apps/web vitest suite left an empty SQLite
database (game.db, -shm, -wal) at apps/web/apps/game/data/, untracked
and unignored.

## Reading

- apps/web/lib/syndicate/persistence.ts: `getPersistence()` defaults
  to `./apps/game/data/game.db`, relative to the working directory.
- apps/web/__tests__/s-guid-resolver.test.ts reaches that singleton
  through the syndicate store with no path set, and vitest runs with
  apps/web as the working directory.
- The production unit sets GAME_DB_PATH in apps/web/.env.production,
  so the default never applies there (checked read-only).

## Decisions

- **Fix in the vitest config, not the test**: `test.env.GAME_DB_PATH =
  ":memory:"`. *Why*: any future test that reaches the singleton gets
  the same protection, and the tests that already pass `dbPath:
  ":memory:"` explicitly are unaffected.
- **No gitignore entry**: the file should not exist, so hiding it would
  only mask a regression.

## Outcome

Confirmed the cause by running the resolver test alone on a clean tree
(the directory appeared), then with the config change (it did not).
Full suite: 138 files, 1444 tests pass, 1 known skip, no stray
directory.

## Refs

- apps/web/__tests__/REPAIR-NOTES-2026-10.md
