"""Google Drive folder management."""

from __future__ import annotations

import os
from typing import Optional

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.oauth2 import service_account

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
]


def build_credentials():
    key_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service-account.json")
    return service_account.Credentials.from_service_account_file(key_path, scopes=SCOPES)


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
