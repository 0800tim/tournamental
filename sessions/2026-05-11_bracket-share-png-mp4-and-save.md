# Bracket share PNG + MP4 + Lock→Save rename

date: 2026-05-11
agent: viral-share-builder
branch: feat/bracket-share-png-mp4-and-save-rename
status: complete

## Goal

Tim wants viral loops. Three deliverables:

1. Canvas-rendered share PNG (1080×1350 portrait, 1200×630 landscape OG, 1080×1080 square) — uses team flags as the visual language, champion biggest, knockout-path below.
2. 6-second animated MP4 generator using local ffmpeg + per-frame canvas rendering (no API spend). Instagram 1080×1350, TikTok 9:16, Twitter landscape.
3. HTTP share endpoint exposing `.png`, `.mp4`, `og.png` per bracket id.
4. "Lock" → "Save" / "Share" copy sweep across user-facing surfaces. Keep `lockedAt` internal field names — they're semantically correct (server-side freeze on kickoff).

## Plan

1. Add `@napi-rs/canvas` to `@vtorn/social-cards`.
2. Add a NEW renderer module (`render-canvas.ts`) — keep existing satori path intact so other cards (goal-clip, leaderboard etc.) continue working.
3. Rewrite `bracket-prediction.ts` to also offer a canvas renderer using the new shape Tim specified: champion-centric portrait with knockout-path flags. Keep the legacy `bracketPredictionCard` satori builder so existing tests + non-bracket OG flow keep working.
4. Add `video/bracket-reveal.ts` — spawns ffmpeg, pipes PNG frames. Test by reading back with ffprobe.
5. Add `/api/share/bracket/[bracketId]/route.ts` and friends to apps/web (handles .png, .mp4, og.png variants via filename suffix).
6. Sweep "lock" copy. Internal `lockedAt` / `lockoutEnforced` stay.

## Decisions

- Footer wordmark: "Tournament·al" per Tim's rebrand, primary `tournamental.com` URL.
- Visual: dark navy bg (`#0a0e1a`) with a radial-gradient glow from the champion's kit primary, baked at render time.
- "MY CHAMPION" pill in gold (`#f5c542`) — pure CSS-ish text on canvas, no JPEG-style assets.
- Knockout path renders one row per stage (R16, QF, SF, [TP], F) with the user's pick as a flag chip.
- MP4 timing curve: keep frames easy — linear fade-in plus an exponential ease on the final champion zoom. 24fps × 6s = 144 frames, ~6MB H.264 yuv420p.
- For tests where ffmpeg isn't available, mock `child_process.spawn` so the encoding step is bypassed.

## Lock→Save replacement map

| Before                                        | After                                          |
|-----------------------------------------------|------------------------------------------------|
| Tab "Lock + share"                            | "Save + share"                                 |
| "Lock the rest before…"                       | "Save before…"                                 |
| "Top lock multipliers"                        | "Top stage multipliers"                        |
| Button "Lock it in"                           | "Save pick"                                    |
| Button "Lock final" (single primary CTA)      | "Save + share"                                 |
| "104 of 104 picks committed"                  | "saved"                                        |
| "kickoff lockout" UI banner                   | "Match has kicked off — pick already in"       |
| "Lock-in odds" / "Locked-in odds" chip        | "Odds when you picked"                         |
| "Bracket Locked" pill in share card           | "Bracket Saved"                                |
| "Lock yours before kickoff"                   | "Save yours before kickoff"                    |
| "0 picks locked yet"                          | "0 brackets saved yet"                         |
| "Locking now snapshots these odds…"           | "Saving now snapshots these odds…"             |
| "Locked-in" / "Locked-out"                    | "Saved" / "Match kicked off"                   |

Internal/data terms kept: `lockedAt` field, `lockoutEnforced`, `lockMultiplier()` function name (export name unchanged), `oddsAtLock`, `is-locked` CSS class — all server-side / data-shape and not user-visible copy. Function and CSS renames are a follow-up refactor not in this PR's scope.

## Outcome

- Canvas PNG renderer shipped in three sizes (1080×1350 / 1200×630 / 1080×1080). Sample artifacts in `/tmp/bracket-share-{portrait,landscape,square}.png` rendered cleanly with the champion flag biggest, glow ring kit-coloured, "MY CHAMPION" gold pill, country name in caps, knockout path stacked beneath, and the `Tournament·al` footer wordmark.
- Animated MP4 generator shipped (Instagram 1080×1350, TikTok 1080×1920, Twitter 1200×630). Real ffmpeg test produces a 6.0s yuv420p MP4 with `+faststart` at ~321 KB. Frame timeline: 0-1s wordmark fade, 1-2.5s handle, 2.5-4s R16 flags fan in, 4-5s QF/SF/Final settle, 5-6s champion zoom + gold pill + caption.
- HTTP endpoints live at `/v1/share/bracket/[bracket](.png|.mp4)` plus the OG sibling at `/v1/share/bracket/[bracket]/og.png`. End-to-end verified against `next start` on port 13311 — 200s, correct content-types, 24h on-disk MP4 cache (cache-miss 44s, cache-hit 37ms with `x-vtorn-cache: hit` header).
- `/world-cup-2026/share/[bracketId]/page.tsx` upgraded: OG metadata now points at the new `/v1/share/bracket/.../og.png` route; description rewritten to "Save yours before kickoff"; share-page body lists portrait PNG, square PNG, Instagram MP4, TikTok MP4 download links.
- Lock → Save sweep: ~35 user-facing string replacements across 12 files (HowItWorks, LeaderboardPreview, UpcomingMatches, landing/page, world-cup-2026/page, profile, LockSummary, BracketBuilder, BracketTree, MatchPickPopup, PredictTab, LeaderboardEntryOverlay, share/[bracketId]/page, api/og/bracket/route). Five test fixtures updated to match the new copy (PillTabs, match-pick-popup, per-match-prediction unit, per-match-prediction.e2e, full-bracket-cascade.e2e). Internal field names (`lockedAt`, `oddsAtLock`, `lockMultiplier`, `LockSummary`, `mpp-locked-banner`) intentionally left alone — they are server-side semantics not user copy, per Tim's brief.
- Build: marked `@napi-rs/canvas` + `@resvg/resvg-js` (plus the platform-specific `-linux-x64-gnu` siblings) as webpack server-side externals so the native `.node` skia binding loads via `require()` at runtime instead of being chunked into the route bundle.

## Tests

- `pnpm --filter @vtorn/social-cards test` — 100 / 100 green (was 80; +20 new tests: 12 PNG card + 8 MP4 video).
- `pnpm --filter @vtorn/web test` — 593 / 593 green.
- `pnpm --filter @vtorn/web typecheck` — clean.
- `pnpm --filter @vtorn/web build` — clean.
- Workspace `pnpm -r typecheck` — clean (only pre-existing marketing.astro lint hints, unrelated).

## Follow-ups for a later session

- Rename `LockSummary` component + file to `SaveSummary`, `bracket-lock-section` → `bracket-save-section` CSS, etc. — pure refactor, no behavioural change, gated on this PR landing first to keep the diff readable.
- Replace `inputFromSearchParams` with a real bracket-store lookup once the game-service has a public `/v1/brackets/:id` read endpoint. Until then the share URL itself is the source of truth — works for every viral post because the data travels with the URL.
- Cache MP4 renders to durable storage (S3 / Cloudflare R2) instead of `/tmp/` so the cache survives restarts across replicas.
- Add commentary audio overlay to the 6-second reveal MP4 (currently silent) — gated on commentary-pipeline track.
