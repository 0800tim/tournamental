"use client";

/**
 * Standalone success client, used by `/syndicates/new/success?slug=…`
 * when a user lands here directly (e.g. after a reload). The primary
 * happy path renders an inline success card on /syndicates/new and
 * never visits this URL.
 */

import { useMemo, useState } from "react";

import "../syndicate-form.css";

const PUBLIC_HOST =
  process.env.NEXT_PUBLIC_PLAY_HOST ?? "https://play.tournamental.com";

export function SyndicateSuccessClient({ slug }: { slug: string }): JSX.Element {
  const url = `${PUBLIC_HOST}/s/${slug || "your-pool"}`;
  const [copied, setCopied] = useState(false);

  const inviteText = useMemo(
    () => `Come predict the Football World Cup 2026 with me, join my pool at ${url}`,
    [url],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore, user can still select and copy the text.
    }
  };

  const waHref = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
    "Come predict the Football World Cup 2026 with me",
  )}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(
    "Join my Tournamental pool",
  )}&body=${encodeURIComponent(inviteText)}`;

  return (
    <div className="syn-page">
      <div className="syn-container">
        <div className="syn-success-card">
          <h1 className="syn-success-title">Your syndicate is live</h1>
          <p className="syn-success-sub">Share the link and start your pool.</p>

          <div className="syn-url-pill">
            <div className="syn-url-text" aria-label="Syndicate URL">
              {url.replace(/^https?:\/\//, "")}
            </div>
            <button
              type="button"
              className="syn-url-copy"
              onClick={copy}
              aria-label="Copy syndicate URL"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          <div className="syn-cta-grid">
            <a className="syn-cta" href={waHref} target="_blank" rel="noopener noreferrer">
              Invite via WhatsApp
            </a>
            <a className="syn-cta" href={tgHref} target="_blank" rel="noopener noreferrer">
              Invite via Telegram
            </a>
            <a className="syn-cta" href={mailHref}>
              Invite by email
            </a>
          </div>

          <div className="syn-link-row">
            <a href={`/s/${slug}`}>Go to your syndicate page →</a>
            <a href="/world-cup-2026">Make your bracket first →</a>
          </div>
        </div>
      </div>
    </div>
  );
}
