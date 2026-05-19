# YouTube Channel Discovery Tool

Finds football/soccer YouTube channels across English, Spanish, Portuguese, and French markets, scores them by reach and engagement, extracts contact emails via headless browser, and exports a ranked Google Sheet to Drive. Optionally generates personalised outreach emails as Google Docs using Claude.

## Prerequisites

- Python 3.11+
- A Google Cloud project with these APIs enabled:
  - YouTube Data API v3
  - Google Drive API
  - Google Sheets API
  - Google Docs API
- A Google service account with a JSON key downloaded
- The service account granted Editor access to your target Drive folder (or to "My Drive")
- An Anthropic API key (only needed for `--with-pitches`)

## Google Cloud Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create or select a project.
2. Enable all four APIs listed above (APIs & Services → Library).
3. Create a service account (IAM & Admin → Service Accounts → Create).
4. Download a JSON key for the service account.
5. Share your target Drive folder (or root Drive) with the service account email (e.g. `discovery@my-project.iam.gserviceaccount.com`) as Editor.

## Installation

```bash
cd tools/youtube-discovery
pip install -r requirements.txt
playwright install chromium
```

## Configuration

```bash
cp .env.example .env
```

Edit `.env`:

```
YOUTUBE_API_KEY=AIza...
GOOGLE_SERVICE_ACCOUNT_JSON=/absolute/path/to/service-account.json
ANTHROPIC_API_KEY=sk-ant-...          # only for --with-pitches
GOOGLE_DRIVE_PARENT_FOLDER_ID=        # optional: ID of a folder to nest under
```

The tool creates this folder tree in Drive automatically:

```
Tournamental GTM/
  YouTube Outreach/
    Channels - YYYY-MM-DD.xlsx   ← Google Sheet
    Pitches/
      <Channel Name> - Pitch.gdoc
```

## Usage

```bash
# Dry run — print top 20 channels to stdout, no Drive writes
python discover.py --dry-run

# Full run — default settings (min 10k subs, top 200 channels, extract emails for top 50)
python discover.py

# Larger run with pitch generation
python discover.py \
  --min-subscribers 50000 \
  --max-results 300 \
  --email-extract-top 100 \
  --with-pitches \
  --pitches-top 30

# Resume from cached channel list (saves YouTube API quota)
python discover.py --use-cache
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--min-subscribers` | 10,000 | Minimum subscriber count |
| `--max-results` | 200 | Max channels in output Sheet |
| `--email-extract-top` | 50 | Channels to attempt email extraction on |
| `--with-pitches` | off | Generate Claude-drafted outreach emails |
| `--pitches-top` | 25 | Channels to generate pitches for |
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

Each full run uses approximately 200–350 YouTube Data API v3 quota units (free tier: 10,000/day). Use `--use-cache` on repeated runs to avoid re-querying.

## Output Sheet Columns

`rank` · `channel_name` · `channel_url` · `subscribers` · `total_views` · `views_per_sub` · `uploads_per_month` · `last_upload_date` · `primary_language` · `contact_email` · `score` · `pitch_doc_link` · `notes`

## Markets Covered

- **English** — global football/soccer audience
- **Spanish** — LatAm + Spain
- **Portuguese** — Brazil + Portugal
- **French** — France + Francophone Africa
