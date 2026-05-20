# YouTube Channel Discovery Tool

Finds football/soccer YouTube channels across English, Spanish, Portuguese, and French markets, scores them by reach and engagement, extracts contact emails + social links via headless browser, and exports a ranked Google Sheet to Drive. Optionally generates personalised outreach emails (in the channel's primary language) as Google Docs via the local `claude` CLI on the Max Plan.

## Prerequisites

- Python 3.11+
- A Google Cloud project with these APIs enabled:
  - YouTube Data API v3
  - Google Drive API
  - Google Sheets API
  - Google Docs API
- At least one YouTube Data API v3 key (server-side, **no** HTTP-referrer restriction)
- An OAuth 2.0 Client ID of type "Desktop app" (the script authenticates as you, no service account needed)
- The `claude` CLI installed and logged in (only needed for `--with-pitches`; uses Max Plan, no API credits)

## Google Cloud Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create or select a project.
2. Enable all four APIs listed above (APIs & Services → Library).
3. Create the **YouTube API key**: Credentials → Create credentials → API key. Edit the key:
   - **Application restriction**: None (or IP-restrict to your dev box).
   - **API restriction**: Restrict key → YouTube Data API v3 only.
   - **Do not** use an HTTP-referrer restriction — the Python client sends no `Referer` header and Google will reject the request.
4. Create the **OAuth Client ID**: Credentials → Create credentials → OAuth client ID → Application type = "Desktop app". Copy the client ID and client secret into `.env`.
5. Configure the OAuth consent screen (APIs & Services → OAuth consent screen):
   - User Type: External (or Internal if you have a Workspace and want to limit to your org).
   - Add your own Google account as a Test User while the app is in "Testing" mode.

### Why OAuth instead of a service account?

Most Google Workspace orgs enforce `iam.disableServiceAccountKeyCreation`, which blocks service-account key creation entirely. User-OAuth side-steps this and is a better fit for a script you run manually anyway:

- No long-lived JSON key file on disk; refresh token is cached at `~/.config/tournamental-youtube/token.json` (chmod 600).
- The output Sheet ends up in **your** Drive automatically.
- First run prompts you to consent (browser tab, or paste-the-code flow on a headless host). Every subsequent run is silent.

## Installation

```bash
cd tools/youtube-discovery
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium
```

## Configuration

```bash
cp .env.example .env
```

Edit `.env`:

```
YOUTUBE_API_KEYS=AIza...                # OR a comma-separated pool, see below
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_DRIVE_PARENT_FOLDER_ID=          # optional: nest under a specific Drive folder
YOUTUBE_STORAGE_STATE=                  # optional: path to a Playwright storage state
```

### YouTube API key pool

Each YouTube Data API v3 key has its own 10,000-unit/day quota on the free tier. For multiple runs per day, create several keys in the Cloud Console and list them comma-separated:

```
YOUTUBE_API_KEYS=AIza...one,AIza...two,AIza...three
```

The script rotates round-robin and auto-advances to the next key on a `quotaExceeded` 403. When every key is exhausted it logs a single warning and the rest of the run skips YouTube calls gracefully.

### Logged-in YouTube scraping (optional, boosts email hit-rate)

YouTube hides the "View email address" button behind a Google login + bot-check. To unlock it:

1. Install the "Get cookies.txt LOCALLY" Chrome extension (or any Netscape cookies exporter).
2. Log into youtube.com in your normal browser.
3. With youtube.com active, click the extension → Export → "Current Site". Save as `cookies.txt`.
4. Upload `cookies.txt` to this folder.
5. Run `python auth_youtube.py --in cookies.txt`. It writes `youtube_state.json` (chmod 600), gitignored.
6. The next `discover.py` run auto-picks it up.

In practice the description-text regex catches most indie creators' emails without login, so this is a marginal boost (mostly for the big-brand channels that gate emails behind YouTube login). Description regex stays on either way.

## Usage

```bash
# Dry run -- print top 20 channels, no Drive writes
.venv/bin/python discover.py --dry-run

# Full run -- top 500 indies (10k-1M subs), active in last 60 days,
# scrape emails+socials for top 150, draft 25 pitches via Claude CLI.
.venv/bin/python discover.py \
  --max-subscribers 1000000 \
  --max-results 500 \
  --email-extract-top 150 \
  --with-pitches --pitches-top 25

# Resume from cache (no fresh YouTube search)
.venv/bin/python discover.py --use-cache

# Patch an existing Sheet with rescraped emails (use after enabling cookies)
.venv/bin/python rescrape_emails.py --sheet <spreadsheet-id> --top 150

# Regenerate pitches against an existing Sheet (active filter + Max Plan)
.venv/bin/python regen_pitches.py --sheet <spreadsheet-id> --top 25
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--min-subscribers` | 10,000 | Minimum subscriber count |
| `--max-subscribers` | 0 (no cap) | Maximum subscriber count; ~1M excludes megabrands |
| `--max-days-since-upload` | 60 | Drop channels with no upload in this many days |
| `--min-uploads-per-month` | 1.0 | Drop channels averaging below this monthly cadence |
| `--max-results` | 500 | Max channels in output Sheet |
| `--email-extract-top` | 150 | Channels to attempt email + social extraction on |
| `--with-pitches` | off | Generate Claude-drafted outreach emails via `claude` CLI |
| `--pitches-top` | 25 | Number of top channels to generate pitches for |
| `--dry-run` | off | Print results only, no Drive writes |
| `--use-cache` | off | Load from `cache/channels.json` |

## Scoring

Each channel receives a 0–100 score:

| Signal | Weight |
|---|---|
| Subscribers (log-scaled, 10M = max) | 40 pts |
| Views per subscriber (normalised to 100) | 30 pts |
| Uploads per month (4+/month = max) | 20 pts |
| Recency (uploaded within 30 days = max) | 10 pts |

## API Quota

Per full run, with rotation across N keys:

| Phase | Cost |
|---|---|
| `search.list` × ~24 keywords | 2,400 units |
| `channels.list` × ~20 batches | 20 units |
| `playlistItems.list` × ~1000 channels | ~1,000 units |
| **Total per run** | **~3,400 units** (well under 10,000 free/day) |

`--use-cache` skips all YouTube calls and goes straight to the indie/active filter + Sheet write, costing zero quota.

## Output Sheet Columns

`rank` · `channel_name` · `custom_url` · `channel_url` · `country` · `subscribers` · `subscriber_tier` · `total_views` · `views_per_sub` · `uploads_per_month` · `last_upload_date` · `days_since_last_upload` · `primary_language` · `score` · `contact_email` · `twitter` · `instagram` · `facebook` · `tiktok` · `linkedin` · `website` · `description_preview` · `pitch_doc_link` · `notes`

## Markets Covered

- **English** — global football/soccer audience
- **Spanish** — LatAm + Spain
- **Portuguese** — Brazil + Portugal
- **French** — France + Francophone Africa

## Helper scripts

- `auth_youtube.py` — convert a browser `cookies.txt` to a Playwright `youtube_state.json` for logged-in scraping
- `rescrape_emails.py` — re-extract emails + socials against an existing Sheet (without re-running search/stats)
- `regen_pitches.py` — regenerate the pitch Google Docs against an existing Sheet, filtering out inactive channels
