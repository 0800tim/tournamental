#!/usr/bin/env python3
"""Build the 2026-06-07 'perfect bot bracket' press release + white paper.

Reads:
    docs/internal/press-2026-06-07-perfect-bot-bracket/press-release.md
    docs/internal/press-2026-06-07-perfect-bot-bracket/white-paper.md

Writes:
    apps/web/public/press/2026-06-07-perfect-bot-bracket.html  (print-friendly)
    apps/web/public/press/tournamental-press-release-2026-06-07.pdf (chromium)
    apps/web/public/whitepaper/perfect-bot-bracket/index.html  (web-friendly)

Run:
    tools/youtube-discovery/.venv/bin/python3 tools/youtube-discovery/build_press_2026-06-07.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import markdown


ROOT = Path("/home/clawdbot/clawdia/projects/vtorn")
SRC_DIR = ROOT / "docs/internal/press-2026-06-07-perfect-bot-bracket"
PRESS_OUT = ROOT / "apps/web/public/press/2026-06-07-perfect-bot-bracket.html"
PDF_OUT = ROOT / "apps/web/public/press/tournamental-press-release-2026-06-07.pdf"
WP_OUT = ROOT / "apps/web/public/whitepaper/perfect-bot-bracket/index.html"


# ------------------------------------------------------------------ press

PRESS_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FOR IMMEDIATE RELEASE: How close to a perfect 104-match World Cup bracket can the world's smartest AI swarm get?</title>
<meta name="description" content="Tournamental opens its 2026 FIFA World Cup leaderboard to AI bots. Spawn a million in your browser, run a billion on a federated node, watch the public on-chain leaderboard.">
<style>
  @page {{ size: A4; margin: 22mm 18mm; }}
  body {{
    font-family: Georgia, "Times New Roman", serif;
    color: #1a1a1a;
    line-height: 1.5;
    font-size: 11pt;
    max-width: 170mm;
    margin: 0 auto;
  }}
  .masthead {{
    border-bottom: 2px solid #1a1a1a;
    padding-bottom: 6mm;
    margin-bottom: 8mm;
  }}
  .masthead .label {{
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #a16a00;
    margin: 0 0 2mm;
  }}
  .masthead .date {{
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 10pt;
    color: #555;
    margin: 0;
  }}
  h1 {{
    font-family: Georgia, "Times New Roman", serif;
    font-size: 20pt;
    line-height: 1.15;
    font-weight: 700;
    margin: 4mm 0 6mm;
    color: #1a1a1a;
  }}
  h2 {{
    font-family: Georgia, "Times New Roman", serif;
    font-size: 13pt;
    margin: 8mm 0 3mm;
    color: #1a1a1a;
    border-bottom: 1px solid #d8c98a;
    padding-bottom: 1mm;
  }}
  p {{ margin: 0 0 3.5mm; }}
  ul, ol {{ margin: 0 0 4mm; padding-left: 6mm; }}
  ul li, ol li {{ margin: 0 0 1.5mm; }}
  blockquote {{
    margin: 3mm 0 5mm 4mm;
    padding: 0 0 0 6mm;
    border-left: 3px solid #a16a00;
    color: #2a2a2a;
    font-style: italic;
  }}
  a {{ color: #6b4900; text-decoration: underline; word-break: break-word; }}
  strong {{ color: #1a1a1a; }}
  code {{
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
    font-size: 9.5pt;
    background: #f4ecd3;
    padding: 0.5mm 1.5mm;
    border-radius: 1mm;
    color: #1a1a1a;
  }}
  .ends {{
    margin-top: 14mm;
    padding-top: 4mm;
    border-top: 1px solid #999;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #666;
    text-align: center;
  }}
</style>
</head>
<body>

<div class="masthead">
  <p class="label">For immediate release</p>
  <p class="date">7 June 2026, Auckland, New Zealand</p>
</div>

{body}

<p class="ends">ends</p>

</body>
</html>
"""


# ------------------------------------------------------------------ white paper

WP_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How close to a perfect 104-match World Cup bracket can the world's smartest AI swarm get? · Tournamental</title>
<meta name="description" content="A public, multi-week, blockchain-anchored experiment in machine sports forecasting. Tim Thomas, Founder, Tournamental.">
<link rel="canonical" href="https://play.tournamental.com/whitepaper/perfect-bot-bracket">
<style>
  :root {{
    --bg: #0e0f15;
    --surface: #14161e;
    --ink: #e9eefb;
    --ink-soft: #b9c1d6;
    --ink-mute: #8590a8;
    --rule: #2a2e3d;
    --gold: #f6c64f;
    --gold-soft: #fbe1a3;
    --link: #93c5fd;
    --serif: Fraunces, "Source Serif Pro", ui-serif, Georgia, serif;
    --sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
  }}
  html {{ background: var(--bg); }}
  body {{
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    line-height: 1.6;
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
  }}
  .wrap {{
    max-width: 760px;
    margin: 0 auto;
    padding: 56px 24px 96px;
  }}
  .masthead {{
    border-bottom: 1px solid var(--rule);
    padding-bottom: 24px;
    margin-bottom: 32px;
  }}
  .eyebrow {{
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--gold);
    margin: 0 0 12px;
  }}
  h1 {{
    font-family: var(--serif);
    font-weight: 500;
    font-size: clamp(28px, 4vw, 40px);
    line-height: 1.15;
    margin: 0 0 14px;
    letter-spacing: -0.01em;
  }}
  .deck {{
    color: var(--ink-soft);
    font-size: clamp(16px, 1.6vw, 18px);
    margin: 0 0 14px;
  }}
  .byline {{
    color: var(--ink-mute);
    font-size: 13px;
    margin: 14px 0 0;
    font-family: var(--mono);
    letter-spacing: 0.04em;
  }}
  .byline strong {{ color: var(--ink); }}
  h2 {{
    font-family: var(--serif);
    font-weight: 500;
    font-size: clamp(22px, 2.6vw, 28px);
    line-height: 1.2;
    margin: 56px 0 14px;
    color: var(--ink);
  }}
  h3 {{
    font-family: var(--serif);
    font-weight: 500;
    font-size: clamp(18px, 1.8vw, 21px);
    line-height: 1.3;
    margin: 36px 0 10px;
    color: var(--ink);
  }}
  h4 {{
    font-family: var(--sans);
    font-weight: 600;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
    margin: 28px 0 8px;
  }}
  p {{ margin: 0 0 16px; color: var(--ink); }}
  ul, ol {{ margin: 0 0 18px; padding-left: 22px; color: var(--ink); }}
  li {{ margin: 0 0 6px; }}
  blockquote {{
    margin: 18px 0;
    padding: 4px 0 4px 18px;
    border-left: 3px solid var(--gold);
    color: var(--gold-soft);
    font-family: var(--serif);
    font-style: italic;
    font-size: 18px;
  }}
  blockquote p {{ color: var(--gold-soft); }}
  hr {{
    border: none;
    border-top: 1px solid var(--rule);
    margin: 40px 0;
  }}
  a {{ color: var(--link); text-decoration: underline; text-decoration-color: rgba(147, 197, 253, 0.4); }}
  a:hover {{ text-decoration-color: var(--link); }}
  strong {{ color: var(--ink); }}
  em {{ font-style: italic; color: var(--gold-soft); }}
  code {{
    font-family: var(--mono);
    font-size: 13px;
    background: var(--surface);
    padding: 1px 6px;
    border-radius: 4px;
    color: var(--gold-soft);
  }}
  pre {{
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 8px;
    padding: 14px 16px;
    overflow-x: auto;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.5;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 18px;
    font-size: 14px;
  }}
  th, td {{
    border-bottom: 1px solid var(--rule);
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
  }}
  th {{ color: var(--ink-soft); font-weight: 600; }}
  .nav {{
    margin-top: 56px;
    padding-top: 24px;
    border-top: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    color: var(--ink-mute);
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }}
  .nav a {{ color: var(--ink-soft); text-decoration: none; }}
  .nav a:hover {{ color: var(--gold); }}
</style>
</head>
<body>
<main class="wrap">
<div class="masthead">
  <p class="eyebrow">White paper · 7 June 2026 · v2.0</p>
{header_block}
</div>

{body}

<nav class="nav">
  <a href="https://play.tournamental.com">play.tournamental.com</a>
  <a href="https://play.tournamental.com/bot-arena">/bot-arena</a>
  <a href="https://play.tournamental.com/the-bet">/the-bet</a>
  <a href="https://play.tournamental.com/odds">/odds</a>
  <a href="https://play.tournamental.com/verify">/verify</a>
  <a href="https://github.com/0800tim/tournamental">github</a>
</nav>
</main>
</body>
</html>
"""


# ------------------------------------------------------------------ helpers

def md_to_html(md_text: str) -> str:
    return markdown.markdown(
        md_text,
        extensions=["extra", "sane_lists", "tables"],
        output_format="html5",
    )


def build_press() -> Path:
    src = (SRC_DIR / "press-release.md").read_text(encoding="utf-8")
    # Strip the "FOR IMMEDIATE RELEASE" + dateline lines — they're in the masthead
    # template. Drop the leading hr-fenced bits up to the first content header.
    lines = src.splitlines()
    cleaned: list[str] = []
    skip_meta = True
    for ln in lines:
        if skip_meta:
            if ln.strip().startswith("## ") and "perfect" in ln.lower():
                # Convert the first H2 (the dramatic headline) into an H1 so the
                # press release reads as one document. Drop the leading "## ".
                cleaned.append("# " + ln.strip().lstrip("#").strip())
                skip_meta = False
                continue
            # skip the FOR IMMEDIATE RELEASE / date / blank lines until first H2
            continue
        cleaned.append(ln)
    body_md = "\n".join(cleaned)
    body_html = md_to_html(body_md)
    out = PRESS_TEMPLATE.format(body=body_html)
    PRESS_OUT.parent.mkdir(parents=True, exist_ok=True)
    PRESS_OUT.write_text(out, encoding="utf-8")
    print(f"[press] wrote {PRESS_OUT} ({len(out):,} bytes)")
    return PRESS_OUT


def build_pdf(html_path: Path) -> Path:
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    if not chrome:
        raise RuntimeError("no chrome/chromium binary in PATH")
    PDF_OUT.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-pdf-header-footer",
        f"--print-to-pdf={PDF_OUT}",
        f"file://{html_path}",
    ]
    print(f"[pdf]   running: {' '.join(cmd)}")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        print(r.stderr)
        raise RuntimeError(f"chrome --print-to-pdf failed: rc={r.returncode}")
    print(f"[pdf]   wrote {PDF_OUT} ({PDF_OUT.stat().st_size:,} bytes)")
    return PDF_OUT


def build_whitepaper() -> Path:
    src = (SRC_DIR / "white-paper.md").read_text(encoding="utf-8")
    # Pull the first heading + deck + byline lines out so we can render them in
    # a designed masthead block, then drop them from the markdown body.
    lines = src.splitlines()
    header_lines: list[str] = []
    body_start = 0
    seen_hr = False
    title = ""
    deck = ""
    byline_parts: list[str] = []
    for i, ln in enumerate(lines):
        if not seen_hr and ln.strip().startswith("# "):
            title = ln.strip().lstrip("#").strip()
            continue
        if not seen_hr and ln.strip().startswith("### "):
            deck = ln.strip().lstrip("#").strip()
            continue
        if not seen_hr and ln.strip().startswith("**") and ln.strip().endswith("**"):
            byline_parts.append(ln.strip().strip("*"))
            continue
        if not seen_hr and ln.strip().startswith("*") and ln.strip().endswith("*") and len(byline_parts) < 4:
            # the *italic affiliation* line
            byline_parts.append(ln.strip().strip("*"))
            continue
        if ln.strip() == "---":
            seen_hr = True
            body_start = i + 1
            break
    if not title:
        raise RuntimeError("white paper markdown is missing the H1")
    header_block = (
        f'  <h1>{title}</h1>\n'
        + (f'  <p class="deck">{deck}</p>\n' if deck else "")
        + (
            '  <p class="byline">'
            + " · ".join(p for p in byline_parts if p)
            + "</p>\n"
            if byline_parts
            else ""
        )
    )
    body_md = "\n".join(lines[body_start:])
    body_html = md_to_html(body_md)
    out = WP_TEMPLATE.format(header_block=header_block, body=body_html)
    WP_OUT.parent.mkdir(parents=True, exist_ok=True)
    WP_OUT.write_text(out, encoding="utf-8")
    print(f"[wp]    wrote {WP_OUT} ({len(out):,} bytes)")
    return WP_OUT


def main() -> int:
    html = build_press()
    build_pdf(html)
    build_whitepaper()
    return 0


if __name__ == "__main__":
    sys.exit(main())
