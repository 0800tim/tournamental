/**
 * BracketPosterCallout, the "download printable poster" section on the
 * /s/<guid> share landing.
 *
 * Tim 2026-06-01: every saved bracket has all 104 picks (the save
 * pipeline only fires when the bracket is complete), so this callout
 * always shows the download CTA on a share landing.  The thumbnail
 * is rendered server-side by /api/og/bracket-poster at 2400×3600 and
 * the browser scales it down for display; clicking the CTA opens
 * the full-res PNG in a new tab where the user can save / print it.
 *
 * On surfaces where the user might not have completed their bracket
 * (the /world-cup-2026/save-share page during a draft, the bracket
 * builder), use this component with `requirePicks` info; it will
 * render the gating note + "Set all 104 picks to unlock your bracket
 * poster" instead.
 */

"use client";

import { useState } from "react";

export interface BracketPosterCalloutProps {
  /** Share guid; we pass it as `bracket_id` to the poster route. */
  readonly bracketId: string;
  /** User handle for the filename + share text. */
  readonly handle: string;
  /** Champion team name, just for caption flavour. */
  readonly championName?: string;
  /**
   * Optional gating mode: when the caller knows the bracket isn't
   * complete (e.g. on the bracket-builder save panel before all 104
   * picks are in), pass `requirePicks = { total: 104, made: N }` to
   * render the "set all 104 picks to unlock" state instead of the
   * download CTA.  On /s/<guid> this is always omitted because a
   * share landing only renders for fully-saved brackets.
   */
  readonly requirePicks?: {
    readonly total: number;
    readonly made: number;
  };
}

/** Etsy-style example URL for users who haven't completed their own
 * bracket yet; falls back to a known-good live bracket so the user
 * can see what the finished poster looks like.  The 0800tim user is
 * the canonical live example.  Resolved server-side by the poster
 * route; if 0800tim has no saved bracket the route's own placeholder
 * falls in.  Tim 2026-06-01. */
const EXAMPLE_POSTER_URL =
  "/api/og/bracket-poster?example=1&handle=0800tim&champion=ARG&size=portrait";

export function BracketPosterCallout(props: BracketPosterCalloutProps) {
  const { bracketId, handle, championName, requirePicks } = props;
  const [imgFailed, setImgFailed] = useState(false);

  const posterUrl = `/api/og/bracket-poster?bracket_id=${encodeURIComponent(
    bracketId,
  )}&handle=${encodeURIComponent(handle)}&size=portrait`;
  const filename = `tournamental-${handle}-wc26-bracket-poster.png`;

  // Gating mode: bracket incomplete.
  if (requirePicks && requirePicks.made < requirePicks.total) {
    const remaining = requirePicks.total - requirePicks.made;
    return (
      <section className="vt-share-poster vt-share-poster--locked" aria-label="Bracket poster">
        <div className="vt-share-poster-head">
          <h2 className="vt-share-poster-title">Printable bracket poster</h2>
          <p className="vt-share-poster-sub">
            Set all {requirePicks.total} picks to unlock your bracket poster.
            You've made <strong>{requirePicks.made}</strong>; <strong>{remaining}</strong> to go.
          </p>
        </div>
        <a className="vt-share-poster-thumb-link" href={EXAMPLE_POSTER_URL} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="vt-share-poster-thumb"
            src={EXAMPLE_POSTER_URL}
            alt="Example bracket poster, by @0800tim"
            loading="lazy"
            width={300}
            height={450}
          />
          <span className="vt-share-poster-thumb-caption">
            Here's @0800tim's poster as an example. Open full size →
          </span>
        </a>
        <a className="vt-share-poster-cta vt-share-poster-cta--secondary" href="/world-cup-2026">
          Complete my bracket →
        </a>
      </section>
    );
  }

  // Live mode: bracket complete, show real thumbnail + download CTA.
  return (
    <section className="vt-share-poster" aria-label="Bracket poster">
      <div className="vt-share-poster-head">
        <h2 className="vt-share-poster-title">Printable bracket poster</h2>
        <p className="vt-share-poster-sub">
          A3 print-quality, all 104 matches, the full path to{" "}
          {championName ?? "your predicted champion"}. Download, print, put on
          the wall.
        </p>
      </div>
      <a className="vt-share-poster-thumb-link" href={posterUrl} target="_blank" rel="noopener noreferrer">
        {!imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="vt-share-poster-thumb"
            src={posterUrl}
            alt={`@${handle}'s WC2026 bracket poster, printable`}
            loading="lazy"
            width={300}
            height={450}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="vt-share-poster-thumb-fallback" aria-hidden>
            🏆
          </div>
        )}
        <span className="vt-share-poster-thumb-caption">Open full-size in new tab →</span>
      </a>
      <a
        className="vt-share-poster-cta"
        href={posterUrl}
        download={filename}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="bracket-poster-download"
      >
        ⬇ Download printable poster
      </a>
    </section>
  );
}
