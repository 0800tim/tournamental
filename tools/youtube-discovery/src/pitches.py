"""Claude-generated personalised outreach email per channel."""

from __future__ import annotations

import os

import anthropic

PITCH_SYSTEM = """\
You write short, personalised cold-email pitches for Tournamental, a free-to-play
football/soccer bracket prediction platform launching for the 2026 FIFA World Cup.

The platform lets creators give their audience a branded syndicate page
(e.g. play.tournamental.com/s/channelname) where fans compete to predict every match.
The creator drives traffic, the fans play for free, the creator gets attribution and
a revenue share via Drips Network (paid automatically in ETH, no invoice needed).

Write a ~180-word email in plain English. Tone: direct, specific, no fluff. Reference
something real about the creator's channel in the first sentence. End with a clear
ask (reply to get a free syndicate page set up before the World Cup). No subject line.
"""

PITCH_USER_TEMPLATE = """\
Channel: {channel_name}
Subscribers: {subscribers:,}
Language: {primary_language}
Recent video titles:
{video_titles}

Write the personalised outreach email body.
"""


def generate_pitch(channel: dict, video_titles: list[str]) -> str:
    """Return a personalised email body string."""
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    titles_str = "\n".join(f"- {t}" for t in video_titles) if video_titles else "- (unavailable)"

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=400,
        system=PITCH_SYSTEM,
        messages=[{
            "role": "user",
            "content": PITCH_USER_TEMPLATE.format(
                channel_name=channel.get("channel_name", ""),
                subscribers=channel.get("subscribers", 0),
                primary_language=channel.get("primary_language", "en"),
                video_titles=titles_str,
            ),
        }],
    )
    return msg.content[0].text.strip()
