# Bracket share PNG + MP4 + Lock→Save rename

date: 2026-05-11
agent: viral-share-builder
branch: feat/bracket-share-png-mp4-and-save-rename
status: in-progress

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

## Next steps

- Implement, test, push, open PR.
