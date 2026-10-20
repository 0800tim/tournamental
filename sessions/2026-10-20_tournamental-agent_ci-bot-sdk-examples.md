# 2026-10-20, CI Node job: bot-sdk example typecheck

**Task**: burn round 7, fix the two workspace typecheck errors that have failed the CI Node job on main since June.
**Branch**: `fix/ci-bot-sdk-examples` (worktree, from main).

## Cause

`packages/bot-sdk/examples/02-claude-bot.ts` and `03-gpt-bot.ts` `await import("@anthropic-ai/sdk")` and `await import("openai")` inside a `.catch(() => null)`, by design: the SDKs are optional peers the reader installs. A literal specifier still makes tsc resolve the module, so `pnpm typecheck` fails with TS2307 twice and the whole Node job goes red, which also hides the result of every other check (Dependabot PRs included).

## Fix

Types only: the specifier moves into a `const`, so the dynamic import is untyped (`Promise<any>`) and the existing cast and runtime catch are unchanged. No SDK was installed, nothing was run, no API calls. `tsc -p tsconfig.json --noEmit` in the package exits 0 under `systemd-run --user --scope -p MemoryMax=3G`.

## Needs Tim

Merge, then watch one CI run on main go green. Separately, the Node 22 bump in `ci.yml` (`node-version: 20` today) is Tim's call; it gates undici 8 (#347) and is unrelated to this fix.
