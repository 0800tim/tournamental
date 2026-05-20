"""Personalised outreach email per channel, drafted via the local Claude Code CLI.

Why the CLI subprocess instead of the Anthropic Python SDK:

- The Anthropic API workspace previously ran out of credits mid-run. The Claude
  Code CLI uses the Max Plan login (OAuth via keychain), which has no per-call
  billing — pitches generate against the Max subscription, not API credits.
- The subprocess env explicitly strips ANTHROPIC_API_KEY so the CLI doesn't
  silently fall back to API auth when an API key is present in .env.
- Same model (Haiku 4.5), same prompts, same output quality. Only the auth +
  billing path differs.
"""

from __future__ import annotations

import os
import subprocess

CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
MODEL = "claude-haiku-4-5-20251001"
PER_CALL_TIMEOUT_S = 120


PITCH_SYSTEM = """\
You write short, personalised cold-email pitches for Tournamental, a free-to-play
football/soccer bracket prediction platform launching for the 2026 FIFA World Cup.

The platform lets creators give their audience a branded "pool" page
(e.g. play.tournamental.com/pools/<channel-slug>) where fans compete to predict
every match. The creator drives traffic, the fans play for free, the creator gets
attribution and a revenue share via Drips Network (paid automatically in ETH, no
invoice needed). If the creator opts to charge an entry fee, they keep 100% of it.

LANGUAGE — IMPORTANT:
Read the channel's description and recent video titles below. Detect the language
the creator actually publishes in (NOT the language of any English keyword used
to find them). Write the email ENTIRELY in that language — Spanish, Portuguese,
French, German, Italian, Arabic, English, whatever the channel's content is in.
If the description is in English, write English. If in Spanish, write Spanish.
If mixed or unclear, default to English. Never mix languages within the email.

Output ONLY the email body — no subject line, no preamble, no language note, no
sign-off other than "Tim". Around 180 words. Direct and specific. Reference
something concrete from the channel's description or recent videos in the first
sentence. End with a clear ask: reply to get a free branded pool set up before
the World Cup.
"""

PITCH_USER_TEMPLATE = """\
Channel: {channel_name}
Subscribers: {subscribers:,}
Country (if known): {country}

Channel description (use this to detect the language to write in):
\"\"\"{description}\"\"\"

Recent video titles:
{video_titles}

Now write the personalised outreach email body, in the channel's primary language.
"""


def generate_pitch(channel: dict, video_titles: list[str]) -> str:
    """Return a personalised email body string, written in the channel's actual content language.

    Language is detected by Haiku from the description + video titles, not from
    the keyword-group that found the channel (that signal is noisy — e.g. a
    Spanish-keyword hit may be an English channel just mentioning Mundial).
    """
    titles_str = "\n".join(f"- {t}" for t in video_titles) if video_titles else "- (unavailable)"
    description = (channel.get("description_preview") or "").strip() or "(no description provided)"
    if len(description) > 800:
        description = description[:800] + "…"

    user_prompt = PITCH_USER_TEMPLATE.format(
        channel_name=channel.get("channel_name", ""),
        subscribers=channel.get("subscribers", 0),
        country=channel.get("country", "unknown"),
        description=description,
        video_titles=titles_str,
    )

    cmd = [
        CLAUDE_BIN,
        "--print",
        "--no-session-persistence",
        "--model", MODEL,
        "--system-prompt", PITCH_SYSTEM,
        user_prompt,
    ]

    # Strip ANTHROPIC_API_KEY (and friends) from the subprocess env so the CLI
    # falls back to OAuth / keychain auth (Max Plan), not API-credit billing.
    cli_env = {
        k: v for k, v in os.environ.items()
        if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")
    }

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=PER_CALL_TIMEOUT_S,
            check=False,
            env=cli_env,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"claude CLI timed out after {PER_CALL_TIMEOUT_S}s")

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        raise RuntimeError(
            f"claude CLI exited {result.returncode}. stderr: {stderr!r} stdout: {stdout!r}"
        )

    return (result.stdout or "").strip()
