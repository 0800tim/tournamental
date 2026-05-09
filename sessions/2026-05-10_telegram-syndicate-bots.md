# 2026-05-10 — Telegram syndicate bots

**Task**: build the Telegram bot infrastructure for VTourn syndicates per docs/13-telegram-bot-and-auth.md and the push-trigger spec in docs/30-gamification-and-affiliate-spine.md.

**Branch**: `feat/telegram-syndicate-bots`

**Status**: ready-for-review

## Plan

1. New workspace `apps/tournament-bot/` using grammY + Fastify webhook on :3350.
2. Main bot (`bots/main.ts`) handling `/start`, `/picks`, `/odds`, `/leaderboard`, `/syndicate`, `/help`.
3. Per-syndicate flow via deep-link param (Option A): `t.me/VTournBot?start=syn_<slug>`.
4. Push fan-out helpers for market-move, lock-mult expiry, kickoff, goal, affiliate CTA — all gated by per-user prefs, push cap (3/day), quiet hours, geo (affiliate only).
5. SQLite storage (`tg.db`) for chat-id/user-id mapping, syndicate metadata, push prefs.
6. Vitest suite (30+ tests) covering commands, push policy, rate-limit, geo gate.
7. README runbook: BotFather flow, webhook curl, DNS/tunnel ingress for `bot.vtourn.com → :3350`.

## Decisions

- **grammY** over Telegraf — TS-first, lighter, modern.
- **Fastify** for the webhook server (matches `apps/api`).
- **better-sqlite3** for storage — synchronous, fast, zero-config.
- **Option A only for v0**: deep-link param drives syndicate context. Option B (fresh bot via BotFather) parked in IDEAS.md as follow-up.
- **Quiet hours default**: 22:00–08:00 in user TZ (Pacific/Auckland fallback).
- **Push cap**: 3/day default; bypassable via `notify_match_day` flag (per-match-window override) — keeps doc 30 cap logic intact.
- **Affiliate CTAs**: blocked-country list (NZ, AU, plus FR/UK conditional) per doc 30 § geo-gating.

## Open questions for Tim

1. Bot username preference: `@VTournBot`, `@VTourn2026`, `@SimSportsBot` (the doc 13 working name)?
2. Confirm Option A first; ship Option B fresh-per-syndicate bots only after the syndicate count justifies the BotFather toil.
3. Should the main bot post to a `@VTournAnnounce` channel for tournament-wide updates? Doc 13 says yes; this PR doesn't ship that yet.

## Outcome

- 71 vitest tests pass (`pnpm --filter @vtourn/tournament-bot test`).
- Typecheck clean (`pnpm --filter @vtourn/tournament-bot typecheck`).
- TS build emits ESM to `dist/` (`pnpm --filter @vtourn/tournament-bot build`).
- README is a step-by-step BotFather + tunnel runbook.
- IDEAS.md gets four new entries (Option B fresh bots, inline-keyboard pick flow, announcements channel, group-leaderboard mode).

## Next steps

After PR merge:
- Wire `bot.vtourn.com → :3350` into Cloudflare tunnel (see README §3).
- Register the bot via BotFather (manual; see README §1).
- Hook `apps/api` event bus to the push helpers — currently they're
  importable but no producer is wired in yet. Doc-30 sprint Day 4 ("Push
  notification triggers") closes this loop.
