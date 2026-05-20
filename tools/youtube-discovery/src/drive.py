"""Google Drive / Sheets / Docs auth and folder management.

Uses user-OAuth (installed-app flow) so we avoid the
`iam.disableServiceAccountKeyCreation` org-policy that blocks
service-account key creation on locked-down Google Workspace orgs.

First run: opens a browser tab (or, on a headless host, prints a URL to
paste into a local browser) and asks the user to consent. Refresh token
is cached at ~/.config/tournamental-youtube/token.json. Subsequent runs
are silent.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from googleapiclient.discovery import build
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
]

TOKEN_PATH = Path(os.path.expanduser("~/.config/tournamental-youtube/token.json"))

_cached_creds: Optional[Credentials] = None


def _client_config() -> dict:
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError(
            "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env. "
            "Create a 'Desktop app' OAuth 2.0 Client ID in Google Cloud Console → "
            "APIs & Services → Credentials, then paste the values into .env."
        )
    return {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }


def _load_cached_credentials() -> Optional[Credentials]:
    if not TOKEN_PATH.exists():
        return None
    try:
        return Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    except Exception:
        return None


def _save_credentials(creds: Credentials) -> None:
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(creds.to_json())
    try:
        TOKEN_PATH.chmod(0o600)
    except OSError:
        pass


def build_credentials() -> Credentials:
    """Return a valid OAuth Credentials object, prompting consent if needed."""
    global _cached_creds
    if _cached_creds and _cached_creds.valid:
        return _cached_creds

    creds = _load_cached_credentials()

    if creds and creds.valid:
        _cached_creds = creds
        return creds

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            _save_credentials(creds)
            _cached_creds = creds
            return creds
        except Exception as e:
            print(f"  [warn] token refresh failed, re-consenting: {e}")

    flow = InstalledAppFlow.from_client_config(_client_config(), SCOPES)
    if _is_headless():
        creds = _run_console_flow(flow)
    else:
        creds = flow.run_local_server(port=0, prompt="consent", open_browser=True)

    _save_credentials(creds)
    _cached_creds = creds
    return creds


def _is_headless() -> bool:
    if os.environ.get("TOURNAMENTAL_FORCE_CONSOLE_AUTH") == "1":
        return True
    return not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY")


def _run_console_flow(flow: InstalledAppFlow) -> Credentials:
    """Manual paste-the-redirect-URL flow for headless machines.

    Google deprecated the OOB ("show code on screen") flow in late 2022, so for
    OAuth clients created since then we use a localhost redirect. We don't
    actually run a local server; instead we ask the user to copy the failed
    redirect URL from their browser's address bar and parse the code out of it.
    """
    from urllib.parse import urlparse, parse_qs

    flow.redirect_uri = "http://localhost:8090/"
    auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline")
    print()
    print("  ----------------------------------------------------------------")
    print("  OAuth consent required (one-time).")
    print()
    print("  1. Open this URL in any browser on your LOCAL machine:")
    print()
    print(f"     {auth_url}")
    print()
    print("  2. Sign in with the Google account whose Drive you want")
    print("     the output Sheet to live in, and approve the requested scopes.")
    print()
    print("  3. Google will redirect you to a URL like:")
    print("       http://localhost:8090/?code=4/0AeaY...&scope=...")
    print("     Your browser will show 'this site can't be reached' or")
    print("     similar -- that's expected. Copy the FULL URL from the")
    print("     address bar and paste it below.")
    print("  ----------------------------------------------------------------")
    print()
    pasted = input("  Paste the localhost URL (or just the code): ").strip()

    if pasted.startswith("http"):
        parsed = urlparse(pasted)
        qs = parse_qs(parsed.query)
        if "error" in qs:
            raise RuntimeError(f"OAuth error from Google: {qs['error'][0]}")
        if "code" not in qs:
            raise RuntimeError(
                f"No 'code' parameter found in pasted URL. Got query: {parsed.query!r}"
            )
        code = qs["code"][0]
    else:
        code = pasted

    flow.fetch_token(code=code)
    return flow.credentials


def build_drive_client():
    return build("drive", "v3", credentials=build_credentials())


def build_sheets_client():
    return build("sheets", "v4", credentials=build_credentials())


def build_docs_client():
    return build("docs", "v1", credentials=build_credentials())


def find_or_create_folder(
    drive,
    name: str,
    parent_id: Optional[str] = None,
) -> str:
    """Return folder ID, creating it if it doesn't exist."""
    q = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent_id:
        q += f" and '{parent_id}' in parents"

    resp = drive.files().list(q=q, fields="files(id, name)").execute()
    files = resp.get("files", [])
    if files:
        return files[0]["id"]

    meta: dict = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    if parent_id:
        meta["parents"] = [parent_id]

    folder = drive.files().create(body=meta, fields="id").execute()
    return folder["id"]


def ensure_folder_tree(date_str: str) -> dict[str, str]:
    """
    Create/find:
      Tournamental GTM/
        YouTube Outreach/
          Pitches/
    Returns {root_id, outreach_id, pitches_id}.
    """
    drive = build_drive_client()
    root_parent = os.environ.get("GOOGLE_DRIVE_PARENT_FOLDER_ID") or None

    root_id = find_or_create_folder(drive, "Tournamental GTM", root_parent)
    outreach_id = find_or_create_folder(drive, "YouTube Outreach", root_id)
    pitches_id = find_or_create_folder(drive, "Pitches", outreach_id)

    return {
        "root_id": root_id,
        "outreach_id": outreach_id,
        "pitches_id": pitches_id,
    }
