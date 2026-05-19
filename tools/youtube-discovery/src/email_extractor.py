"""Playwright-based email extraction from YouTube channel About pages."""

from __future__ import annotations

import asyncio
import re
from typing import Optional

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")


async def _extract_one(page, channel_id: str, timeout: int) -> Optional[str]:
    url = f"https://www.youtube.com/channel/{channel_id}/about"
    try:
        await page.goto(url, timeout=timeout * 1000, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)

        # Try the "View email address" button (YouTube shows it for channels with
        # a public business email)
        btn = page.locator("text=View email address")
        if await btn.count() > 0:
            await btn.first.click()
            await page.wait_for_timeout(1500)

        # Scan rendered text for an email address
        text = await page.inner_text("body")
        match = EMAIL_RE.search(text)
        if match:
            email = match.group(0)
            # Skip YouTube's own addresses
            if "youtube" not in email and "google" not in email:
                return email

    except Exception:
        pass
    return None


def extract_emails(
    channel_ids: list[str],
    timeout_seconds: int = 8,
    on_progress=None,
) -> dict[str, str]:
    """
    Return {channel_id: email_or_empty} for each channel ID.
    Runs sequentially to avoid triggering YouTube rate limits.
    """
    return asyncio.run(_extract_all(channel_ids, timeout_seconds, on_progress))


async def _extract_all(
    channel_ids: list[str],
    timeout_seconds: int,
    on_progress,
) -> dict[str, str]:
    from playwright.async_api import async_playwright

    results: dict[str, str] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        )
        page = await context.new_page()

        for i, cid in enumerate(channel_ids):
            email = await _extract_one(page, cid, timeout_seconds)
            results[cid] = email or ""
            if on_progress:
                on_progress(i + 1, len(channel_ids), cid, email)

        await browser.close()

    return results
