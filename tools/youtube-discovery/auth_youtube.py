#!/usr/bin/env python3
"""Convert a browser cookie export into a Playwright storage_state.json
for logged-in YouTube scraping.

YouTube hides "Email" / business contact info behind a Google login + a
"prove you're not a bot" verification. The email_extractor picks up
description-text emails without login (good for indie creators), but a
logged-in session unlocks the "View email address" reveal on far more
channels (the big-brand ones in particular).

How to use:

1. Log into YouTube in your normal browser (Chrome/Brave/Edge).
2. Install the "Get cookies.txt LOCALLY" extension
   (Chrome Web Store; ~2M users; doesn't phone home).
3. With youtube.com in the foreground, click the extension → Export →
   "youtube.com" or "All sites". Save the file as `cookies.txt`.
4. Upload `cookies.txt` to this directory (or anywhere; pass --in <path>).
5. Run:  python auth_youtube.py --in cookies.txt
6. The script writes `youtube_state.json` next to it. The next discovery
   run will pick this up automatically (via `_resolve_storage_state` in
   `src/email_extractor.py`).

The cookie file contains your YouTube session token. **Keep it private**
— it's the equivalent of a cached password. `.gitignore` already excludes
`*.json` in this folder, but treat the file like a credential.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEFAULT_OUT = Path(__file__).parent / "youtube_state.json"


def parse_netscape_cookies(path: Path) -> list[dict]:
    """Parse a Netscape cookies.txt file into Playwright cookie dicts."""
    cookies: list[dict] = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        domain, flag, cookie_path, secure, expires, name, value = parts[:7]
        try:
            expires_int = int(expires)
        except ValueError:
            expires_int = -1
        cookies.append({
            "name": name,
            "value": value,
            "domain": domain,
            "path": cookie_path or "/",
            "expires": expires_int,
            "httpOnly": False,
            "secure": secure.upper() == "TRUE",
            "sameSite": "Lax",
        })
    return cookies


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True, help="path to cookies.txt (Netscape format)")
    p.add_argument("--out", default=str(DEFAULT_OUT), help=f"output storage_state path (default {DEFAULT_OUT})")
    args = p.parse_args()

    src = Path(args.src).expanduser()
    if not src.exists():
        print(f"Error: input file {src} not found.", file=sys.stderr)
        return 2

    cookies = parse_netscape_cookies(src)
    if not cookies:
        print(f"Error: no cookies parsed from {src}. Is it Netscape format?", file=sys.stderr)
        return 2

    # Filter to youtube.com / google.com cookies — others aren't useful.
    relevant = [
        c for c in cookies
        if any(d in c["domain"] for d in ("youtube.com", "google.com", "googlevideo.com"))
    ]

    state = {"cookies": relevant, "origins": []}
    out = Path(args.out).expanduser()
    out.write_text(json.dumps(state, indent=2))
    out.chmod(0o600)
    print(f"Wrote {len(relevant)} cookies to {out}")
    print("The next `discover.py` run will use this for logged-in scraping.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
