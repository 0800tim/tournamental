/**
 * Vitest setup file (referenced from vitest.config.ts).
 *
 * SEC-BRK-09: production code only honours the `X-User-Id` dev
 * fallback when `GAME_DEV_AUTH=1` (we dropped the
 * `NODE_ENV !== "production"` shortcut). Tests rely on the header
 * fallback for every authenticated route, so we opt in here once
 * per process. Individual tests that need to exercise the
 * production identity path override `GAME_DEV_AUTH` in their own
 * `beforeAll` and restore it in `afterAll` (see user-api-keys.test.ts).
 */

process.env.GAME_DEV_AUTH = "1";
