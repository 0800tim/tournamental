"""Playwright-based email + social-link extraction from YouTube channel About pages.

Strategy, in order of hit rate:

1. **Logged-in scrape** (if YOUTUBE_STORAGE_STATE points to a valid Playwright
   storage_state JSON, OR youtube_state.json exists in the tool root). YouTube
   hides the "Email" link behind a Google login verification; with a logged-in
   session we can click "View email address" without the captcha.
2. **Public "Email" link** on the About page — works without login for some
   channels but most prompt for verification.
3. **Description regex** — many indie creators write their booking email straight
   into the About description (e.g. "Business: hello@channel.com"). Visible to
   everyone, no login needed.

Also extracts social handles (Twitter/X, Instagram, Facebook, TikTok, LinkedIn)
and the channel's primary external website from the Links section.
"""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Optional

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

# Social-link patterns from the channel's "Links" section.
SOCIAL_PATTERNS: dict[str, re.Pattern] = {
    "twitter": re.compile(r"https?://(?:www\.)?(?:twitter\.com|x\.com)/[A-Za-z0-9_]+/?", re.I),
    "instagram": re.compile(r"https?://(?:www\.)?instagram\.com/[A-Za-z0-9_.]+/?", re.I),
    "facebook": re.compile(r"https?://(?:www\.)?facebook\.com/[A-Za-z0-9._\-]+/?", re.I),
    "tiktok": re.compile(r"https?://(?:www\.)?tiktok\.com/@[A-Za-z0-9_.]+/?", re.I),
    "linkedin": re.compile(r"https?://(?:www\.)?linkedin\.com/(?:in|company)/[A-Za-z0-9\-_]+/?", re.I),
}

# Domains/local-parts that aren't real business contact emails.
SKIP_DOMAINS = (
    "youtube.com",
    "googleusercontent.com",
    "google.com",
    "example.com",
    "example.org",
    "sentry.io",
    "wixpress.com",
)
SKIP_LOCAL_PARTS = ("noreply", "no-reply", "donotreply", "support@youtube")


def _is_plausible_business_email(email: str) -> bool:
    lower = email.lower()
    if any(d in lower for d in SKIP_DOMAINS):
        return False
    if any(p in lower for p in SKIP_LOCAL_PARTS):
        return False
    if re.search(r"\.(png|jpe?g|svg|webp|gif)$", lower):
        return False
    return True


async def _try_click_view_email(page) -> None:
    """Click the 'View email address' button if present. Best-effort, ignores errors."""
    try:
        btn = page.get_by_role("button", name=re.compile(r"view\s*email", re.I))
        if await btn.count() > 0:
            await btn.first.click(timeout=2000)
            await page.wait_for_timeout(1200)
            return
    except Exception:
        pass

    try:
        loc = page.locator("text=/view email/i")
        if await loc.count() > 0:
            await loc.first.click(timeout=2000)
            await page.wait_for_timeout(1200)
    except Exception:
        pass


async def _extract_one(page, channel_id: str, timeout: int) -> dict:
    """Return {'email': str|None, 'socials': {platform: url, ...}, 'website': str|None}."""
    out: dict = {"email": None, "socials": {}, "website": None}
    url = f"https://www.youtube.com/channel/{channel_id}/about"
    try:
        await page.goto(url, timeout=timeout * 1000, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

        await _try_click_view_email(page)

        text = await page.inner_text("body")
        for match in EMAIL_RE.finditer(text):
            email = match.group(0)
            if _is_plausible_business_email(email):
                out["email"] = email
                break

        # Pull external links from anchor href attributes — more reliable than
        # parsing rendered text. YouTube wraps outbound links via
        # /redirect?q=<encoded>; handle both forms.
        try:
            hrefs = await page.eval_on_selector_all(
                "a[href]", "els => els.map(e => e.href)"
            )
        except Exception:
            hrefs = []

        from urllib.parse import urlparse, parse_qs, unquote
        resolved: list[str] = []
        for href in hrefs:
            if not href:
                continue
            if "youtube.com/redirect" in href:
                try:
                    q = parse_qs(urlparse(href).query).get("q", [""])[0]
                    if q:
                        resolved.append(unquote(q))
                        continue
                except Exception:
                    pass
            resolved.append(href)

        for href in resolved:
            for platform, pattern in SOCIAL_PATTERNS.items():
                if platform in out["socials"]:
                    continue
                m = pattern.search(href)
                if m:
                    out["socials"][platform] = m.group(0)

        # First non-YouTube, non-social http(s) link → channel's primary website.
        for href in resolved:
            if not href.startswith(("http://", "https://")):
                continue
            host = urlparse(href).netloc.lower()
            if not host:
                continue
            if any(skip in host for skip in (
                "youtube.com", "youtu.be", "google.com", "googleusercontent",
                "twitter.com", "x.com", "instagram.com", "facebook.com",
                "tiktok.com", "linkedin.com",
            )):
                continue
            out["website"] = href.split("?")[0].rstrip("/")
            break

    except Exception:
        pass
    return out


def extract_emails_and_socials(
    channel_ids: list[str],
    timeout_seconds: int = 8,
    on_progress=None,
) -> dict[str, dict]:
    """Return {channel_id: {"email": str, "socials": {...}, "website": str}}."""
    return asyncio.run(_extract_all(channel_ids, timeout_seconds, on_progress))


def extract_emails(
    channel_ids: list[str],
    timeout_seconds: int = 8,
    on_progress=None,
) -> dict[str, str]:
    """Back-compat alias returning only the email per channel."""
    rich = extract_emails_and_socials(channel_ids, timeout_seconds, on_progress)
    return {cid: data.get("email") or "" for cid, data in rich.items()}


def _resolve_storage_state() -> Optional[str]:
    """Return a Playwright storage_state path if one is configured + exists."""
    candidate = os.environ.get("YOUTUBE_STORAGE_STATE")
    if candidate:
        p = Path(candidate).expanduser()
        if p.exists():
            return str(p)
        print(f"  [warn] YOUTUBE_STORAGE_STATE points to {p!s} which doesn't exist; "
              "falling back to unauthenticated scraping.")
        return None
    default = Path(__file__).parent.parent / "youtube_state.json"
    if default.exists():
        return str(default)
    return None


async def _extract_all(
    channel_ids: list[str],
    timeout_seconds: int,
    on_progress,
) -> dict[str, dict]:
    from playwright.async_api import async_playwright

    results: dict[str, dict] = {}
    storage_state = _resolve_storage_state()
    if storage_state:
        print(f"  [info] Using YouTube storage state at {storage_state} (logged-in scraping).")
    else:
        print("  [info] No YouTube storage state found; scraping as anonymous "
              "(description-text emails only).")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context_kwargs = {
            "user_agent": (
                "Mozilla/5.0 (X11; Linux x86_64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "viewport": {"width": 1280, "height": 900},
        }
        if storage_state:
            context_kwargs["storage_state"] = storage_state
        context = await browser.new_context(**context_kwargs)
        page = await context.new_page()

        for i, cid in enumerate(channel_ids):
            data = await _extract_one(page, cid, timeout_seconds)
            results[cid] = data
            if on_progress:
                on_progress(i + 1, len(channel_ids), cid, data.get("email"))

        await browser.close()

    return results
