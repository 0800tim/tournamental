# YouTube Channel Discovery Tool — Design Spec

**Date:** 2026-05-19
**Status:** Approved — proceeding to implementation

## Problem

Tournamental needs to reach football/soccer YouTube creators who have large audiences
in the key World Cup markets. The LAUNCH-PLAYBOOK.md already has a manually curated
list of AI/tech YouTubers; this tool covers the orthogonal audience: sports creators
whose followers are the actual end-users of the platform.

Mass DMs on YouTube are against ToS and trigger spam detection. The right approach is
a qualified outreach list (ranked Sheet) with real contact emails, so outreach is
personalised and goes via email, not YouTube DMs.

## Location

`tools/youtube-discovery/` in the vtorn repo (public, Apache 2.0).
Credentials live in `.env` (gitignored). The tool itself is generic enough to be
useful to any OSS project doing creator outreach.

## File Structure

```
tools/youtube-discovery/
├── .env.example          # credential stubs with comments
├── README.md             # setup + usage
├── requirements.txt
├── discover.py           # CLI entrypoint
└── src/
    ├── youtube.py        # YouTube Data API v3 wrapper
    ├── scorer.py         # channel scoring algorithm
    ├── email_extractor.py # Playwright headless email extraction
    ├── drive.py          # Google Drive folder management
    ├── sheets.py         # Google Sheets write/update
    ├── docs.py           # Google Docs creation for pitches
    └── pitches.py        # Claude API pitch generation
```

## CLI Interface

```bash
python discover.py \
  --min-subscribers 10000 \
  --max-results 200 \
  --email-extract-top 50 \
  [--with-pitches] \
  [--pitches-top 25] \
  [--dry-run]
```

`--dry-run` prints the ranked list to stdout and skips all Drive writes — useful for
testing quota usage before committing to a full run.

## Data Flow

```
1. Parse CLI args + load .env
2. youtube.py: keyword search across 4 language sets → channel IDs
3. Deduplicate by channel_id
4. youtube.py: batch-fetch channel stats (subscribers, views, upload count, last upload)
5. scorer.py: score each channel (100-point scale)
6. Sort descending by score, filter by --min-subscribers
7. drive.py: create/find "Tournamental GTM > YouTube Outreach" folder in Drive
8. sheets.py: write master ranked Sheet ("Channels - YYYY-MM-DD")
9. email_extractor.py: Playwright pass over top N channels → fill contact_email column
10. [if --with-pitches] pitches.py: Claude generates personalised email per top M channels
11. [if --with-pitches] docs.py: saves each pitch as Google Doc in Pitches/ subfolder
12. sheets.py: backfill pitch_doc_link column
```

## Search Keywords

| Language | Keywords |
|---|---|
| EN | `football predictions`, `soccer analysis`, `World Cup 2026`, `Premier League analysis`, `Champions League analysis`, `soccer highlights`, `football commentary` |
| ES | `predicciones fútbol`, `análisis fútbol`, `Mundial 2026`, `Champions League análisis`, `fútbol highlights` |
| PT | `previsões futebol`, `análise futebol`, `Copa do Mundo 2026`, `futebol brasileiro`, `highlights futebol` |
| FR | `prédictions football`, `analyse football`, `Coupe du Monde 2026`, `Ligue 1 analyse`, `football highlights` |

Each keyword triggers a `search.list` call (type=channel, relevanceLanguage set per
language group, maxResults=50). Total API quota cost per full run: ~200–350 units,
well within the 10,000/day free quota.

## Scoring Algorithm (100 points)

| Signal | Weight | Formula |
|---|---|---|
| Subscribers (log-scaled) | 40 pts | `log10(subs) / log10(10_000_000) * 40` |
| Views-per-subscriber ratio | 30 pts | `min(views/subs / 100, 1.0) * 30` |
| Upload frequency (uploads/month) | 20 pts | `min(uploads_per_month / 4, 1.0) * 20` |
| Recency (days since last upload) | 10 pts | `max(0, (30 - days_since_last) / 30) * 10` |

A channel with 1M subs, strong engagement (50 views/sub), weekly uploads, and a
video last week scores ~83/100. A 100K channel with the same cadence scores ~68.
A 10M channel that hasn't uploaded in 3 months scores lower than an active 500K
channel — intentional, dead channels are useless for outreach.

## Google Sheet Output

**Filename:** `Channels - YYYY-MM-DD`
**Location:** `Tournamental GTM / YouTube Outreach /`

| Column | Notes |
|---|---|
| rank | 1-based, by score |
| channel_name | |
| channel_url | `https://youtube.com/channel/{id}` |
| subscribers | raw integer |
| total_views | raw integer |
| views_per_sub | float, 2dp |
| uploads_per_month | float, 1dp (estimated from total uploads ÷ channel age) |
| last_upload_date | ISO 8601 |
| primary_language | detected from search query that found it |
| contact_email | blank until email extraction runs |
| score | float, 1dp |
| pitch_doc_link | blank unless --with-pitches |
| notes | blank; for human use |

## Google Drive Folder Structure

```
Tournamental GTM/
  YouTube Outreach/
    Channels - 2026-05-19    (Google Sheet)
    Pitches/                 (only created with --with-pitches)
      [Channel Name] - Pitch (Google Doc, one per top-M channels)
```

If `GOOGLE_DRIVE_PARENT_FOLDER_ID` is set in `.env`, "Tournamental GTM" is created
inside that folder. Otherwise it goes in Drive root.

## Email Extraction

Uses Playwright (headless Chromium) to:
1. Navigate to `https://www.youtube.com/channel/{id}/about`
2. Wait for the "View email address" button
3. Click it (YouTube shows the email after a click, no CAPTCHA for logged-out users)
4. Extract the revealed text

If the button is absent or the email field is empty: marks contact_email as
`(none found)`. Timeout per channel: 8 seconds. Runs sequentially to avoid
rate-limiting; ~3–5 seconds per channel → 50 channels ≈ 4 minutes.

## Pitch Generation (--with-pitches)

Calls `claude-haiku-4-5` (cheap, fast) with a prompt that includes:
- Channel name, subscriber count, detected language, recent upload topics (from
  video titles fetched via `search.list?channelId=...&maxResults=5`)
- The Tournamental pitch angle: syndicate pages, World Cup 2026, open-source,
  Drips Network contributor revenue

Output: a ~200-word personalised email in English (even for non-EN channels — most
large creators understand English pitch emails). Saved as a Google Doc.

## Credentials (.env)

```
YOUTUBE_API_KEY=                    # YouTube Data API v3
GOOGLE_SERVICE_ACCOUNT_JSON=        # path to service account JSON file
ANTHROPIC_API_KEY=                  # only needed for --with-pitches
GOOGLE_DRIVE_PARENT_FOLDER_ID=      # optional; defaults to Drive root
```

Google auth uses a **service account** with Drive and Sheets API enabled. The service
account email must be granted "Editor" access to the target Drive folder (or the
whole Drive if using root). Instructions in README.md.

## Error Handling

| Scenario | Behaviour |
|---|---|
| YouTube quota exceeded mid-run | Checkpoint to `./cache/channels.json`; re-run resumes from cache |
| Email extraction timeout | Mark `(none found)`, continue |
| Drive API transient error | Retry 3× with exponential backoff (1s, 2s, 4s) |
| No results for a keyword | Log warning, continue |
| Claude API error in pitch gen | Log warning, skip that channel's Doc |

## Dependencies

```
google-api-python-client   # already installed on the host
google-auth-httplib2
google-auth-oauthlib
playwright
anthropic                  # only for --with-pitches
click
python-dotenv
```

## What This Is Not

- Not a mass-DM tool. Outreach happens outside this tool, via email.
- Not a real-time monitor. Run it once per week before a campaign wave.
- Not a replacement for the LAUNCH-PLAYBOOK.md Tier 1 creator list (AI YouTubers).
  That list is manually curated and remains the primary day-1 outreach target.
  This tool covers the complementary sports-audience creator pool.
