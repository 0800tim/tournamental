"""Google Docs creation for outreach pitch letters."""

from __future__ import annotations

import time

from googleapiclient.errors import HttpError

from .drive import build_docs_client, build_drive_client


def create_pitch_doc(
    channel_name: str,
    pitch_body: str,
    pitches_folder_id: str,
) -> str:
    """Create a Google Doc with the pitch text. Returns the Doc URL."""
    drive = build_drive_client()
    docs = build_docs_client()

    # Create empty Doc in the Pitches folder
    doc_meta = {
        "name": f"{channel_name} - Pitch",
        "mimeType": "application/vnd.google-apps.document",
        "parents": [pitches_folder_id],
    }
    doc_file = _retry(lambda: drive.files().create(body=doc_meta, fields="id").execute())
    doc_id = doc_file["id"]

    # Insert the pitch body text
    _retry(lambda: docs.documents().batchUpdate(
        documentId=doc_id,
        body={
            "requests": [
                {
                    "insertText": {
                        "location": {"index": 1},
                        "text": pitch_body,
                    }
                }
            ]
        },
    ).execute())

    return f"https://docs.google.com/document/d/{doc_id}/edit"


def _retry(fn, attempts: int = 3):
    for i in range(attempts):
        try:
            return fn()
        except HttpError as e:
            if i == attempts - 1:
                raise
            time.sleep(2 ** i)
