---
status: in-progress
agent: marketing
task: First run of the YouTube discovery tool, blocked on YouTube Data API v3 daily quota; cleared the way for a clean retry after quota reset.
---

# First run of YouTube discovery tool

## What happened

- Tim provided OAuth client ID/secret + YouTube API key + Anthropic key + Drive parent folder ID in `.env`.
- Tim hit the `iam.disableServiceAccountKeyCreation` org policy when trying to create a service-account key. Refactored `src/drive.py` to use the user-OAuth Desktop-app flow instead. No more service-account JSON; refresh token cached at `~/.config/tournamental-youtube/token.json` (chmod 600).
- Initial dry-run found 954 channels and printed a top-20 that looks right (ESPN FC, Tifo Football, Liverpool FC, Premier League official, Bundesliga official). YouTube API key works server-side.
- Drive / Sheets / Docs APIs needed enabling in the Google Cloud project after OAuth was set up. Tim did this.
- OAuth flow completed (URL-paste pattern, since Google deprecated the OOB flow in 2022 and the dev box is headless). Authenticated as `info@growthspurt.agency`.
- First non-dry-run attempt **blew through today's YouTube Data API v3 quota** (10,000 units/day on free tier). Root cause: `fetch_last_upload_dates` made one 100-unit `search.list` call per channel × 954 channels = ~95,000 units attempted. Quota silently capped at 10k, the rest failed quietly.
- A retry with `--use-cache` ran into a second bug: cache logic still re-called `fetch_channel_stats` even when the cache was hit, which meant the empty-result run *overwrote the good cache with empty data*.
- Net visible result: empty Drive Sheet at `https://docs.google.com/spreadsheets/d/1d4Ch0_8zPpUu3d5gEBu2ggegi7RvBk8ogABdGWn94ao/edit`. Tim can delete this; tomorrow's run will create a fresh dated one.

## Bugs fixed in this session

1. **`fetch_last_upload_dates` was 100× too expensive.** Switched from `search.list(channelId=, order=date)` (100 units each) to `playlistItems.list(playlistId=channel.uploads_playlist_id)` (1 unit each). The uploads playlist ID is already returned by `channels.list` so no extra call needed. 1000-channel run now costs ~1000 units for last-upload data instead of ~100,000.
2. **`--use-cache` was a no-op for fetch.** Cache loaded but stats were re-fetched anyway. Refactored `discover.py` to split the fetch path into `_fresh_fetch()` and skip it entirely when cache contains usable data (any non-zero subscriber count).
3. **`save_cache` would overwrite a good cache with an empty one** when a quota-failed run produced 0 channels. Now guarded: only save when the run produced at least one channel with non-zero subs.

Total quota cost after fixes (approximate, for a 1000-channel run):
- `search.list` × 24 keywords = 2,400 units
- `channels.list` × ~20 batches = 20 units
- `playlistItems.list` × ~1000 channels = 1,000 units
- **Total: ~3,400 units** (vs 10,000/day free quota)

## Next steps

- **YouTube quota resets at 07:00 UTC on 2026-05-20** (= 19:00 NZST same day).
- After reset, re-run `python discover.py --email-extract-top 50 --with-pitches --pitches-top 25`. With the fixes this is a single ~10-minute end-to-end run (4 min fetch + 4 min email scrape + 2 min pitches).
- Output Sheet will land in Tim's Drive under `Tournamental GTM / YouTube Outreach / Channels - 2026-05-20`.
- Pitch Google Docs in the `Pitches/` subfolder.
- Once the Sheet exists, send the top 20 personalised emails using the templates in `docs/59-football-audience-outreach-playbook.md` §1d.

## Files touched

- `tools/youtube-discovery/src/drive.py` — OAuth Desktop-app flow with refresh-token caching + headless console flow.
- `tools/youtube-discovery/src/youtube.py` — `fetch_last_upload_dates` rewritten to use `playlistItems.list`; `fetch_channel_stats` now returns `uploads_playlist_id`.
- `tools/youtube-discovery/discover.py` — `_fresh_fetch()` helper; `--use-cache` now skips re-fetch; safer cache save; env check no longer requires Drive creds for `--dry-run`.
- `tools/youtube-discovery/.env.example` — OAuth client ID/secret instead of service-account JSON, with rationale.
- `tools/youtube-discovery/README.md` — Prereqs, Cloud setup, and explanation of why OAuth instead of service account.
