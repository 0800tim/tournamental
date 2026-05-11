"use client";

/**
 * ShareSavePage, the logged-in user's Save & share surface.
 *
 * Visual order, top-to-bottom:
 *   1. Hero strip: title + last-saved timestamp + "x of 104 picks saved" chip.
 *   2. Big OG image preview (~480px desktop, full-width mobile) with a
 *      Portrait / Landscape / Square format switcher under it.
 *   3. Read-only share-URL row with a big "Copy link" button + a
 *      transient "Copied!" pill.
 *   4. Primary share CTA, a giant gold "Share my bracket" button that
 *      fires navigator.share if supported, else the fallback popover.
 *   5. Always-visible row of WhatsApp / Telegram / X / Facebook / Email
 *      deep-link buttons.
 *   6. Download row, "Download as image" for Portrait / Landscape /
 *      Square (the OG endpoint serves the PNG).
 *   7. Collapsible embed-snippet section (`<details>`).
 *
 * Mobile: collapses to single column. Share CTA goes full-width sticky
 * to the bottom of the viewport above the bottom-nav.
 *
 * Analytics: every share action fires
 *   window.dataLayer.push({ event: 'share_clicked', platform, surface: 'save-share' })
 * so the analytics layer (parallel agent #62) is a single wire-up step
 * away, no further work on this surface required.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cascade,
  type Bracket,
  type CascadedBracket,
  type Tournament,
} from "@vtorn/bracket-engine";

import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import { localUserId, loadDraft } from "@/lib/bracket/storage";
import { shareContent, tapFeedback } from "@/lib/native";
import { loadStoredShareGuid } from "@/lib/share/share-guid-storage";
import {
  type OgSize,
  buildOgImageUrl,
  buildShareLinks,
  buildShareText,
  buildShareTitle,
  ogDownloadFilename,
  resolveShareGuid,
  shareDisplayUrlFor,
  shareUrlFor,
} from "@/lib/share/share-text";

import "./share-save.css";

export interface ShareSavePageProps {
  readonly tournament: Tournament;
  /**
   * Optional pre-supplied auth user id. Once PR #138 (Supabase auth)
   * lands we'll wire `useUser()` here; for now callers can pass
   * `undefined` and we fall through to the bracketId-based guid.
   */
  readonly authUserId?: string | null;
  /** Optional display name; same plumbing as `authUserId`. */
  readonly handle?: string | null;
}

type AnalyticsPlatform =
  | "native"
  | "copy"
  | "whatsapp"
  | "telegram"
  | "x"
  | "facebook"
  | "email"
  | "download";

function pushAnalytics(platform: AnalyticsPlatform): void {
  if (typeof window === "undefined") return;
  type DataLayerWindow = Window & {
    dataLayer?: Array<Record<string, unknown>>;
  };
  const w = window as DataLayerWindow;
  if (!Array.isArray(w.dataLayer)) w.dataLayer = [];
  w.dataLayer.push({
    event: "share_clicked",
    platform,
    surface: "save-share",
  });
}

function teamName(tournament: Tournament, code: string | null | undefined): string | null {
  if (!code) return null;
  return tournament.teams.find((t) => t.id === code)?.name ?? code;
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "Never saved";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never saved";
  // Short, locale-aware. We avoid a heavy date-fns dep just for this.
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------- Sub-components ----------

function SizeChip({
  size,
  current,
  onSelect,
}: {
  size: OgSize;
  current: OgSize;
  onSelect: (s: OgSize) => void;
}): JSX.Element {
  const active = size === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`vt-ss-size-chip${active ? " is-active" : ""}`}
      onClick={() => onSelect(size)}
    >
      {size[0].toUpperCase() + size.slice(1)}
    </button>
  );
}

function PlatformButton({
  platform,
  href,
  label,
  icon,
  onClick,
}: {
  platform: AnalyticsPlatform;
  href: string;
  label: string;
  icon: JSX.Element;
  onClick?: () => void;
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="vt-ss-platform-btn"
      data-platform={platform}
      aria-label={`Share on ${label}`}
      onClick={() => {
        pushAnalytics(platform);
        onClick?.();
      }}
    >
      <span className="vt-ss-platform-icon" aria-hidden="true">{icon}</span>
      <span className="vt-ss-platform-label">{label}</span>
    </a>
  );
}

// ---------- Main component ----------

export function ShareSavePage({
  tournament,
  authUserId,
  handle,
}: ShareSavePageProps): JSX.Element {
  // Hydration-safe initial state, start "empty", load from
  // localStorage on mount.
  const [bracket, setBracket] = useState<Bracket | null>(null);
  const [userIdent, setUserIdent] = useState<string>("ssr_user");
  const [storedShareGuid, setStoredShareGuid] = useState<string | null>(null);
  const [size, setSize] = useState<OgSize>("landscape");
  const [copied, setCopied] = useState<boolean>(false);
  const [fallbackOpen, setFallbackOpen] = useState<boolean>(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = localUserId();
    setUserIdent(id);
    const draft = loadDraft(tournament.id, id);
    if (draft) setBracket(draft);
    // Pick up the canonical (server-returned) share guid persisted at
    // last save. If absent (offline-only state), we fall through to
    // the legacy bracketId-based URL — the next save will replace it.
    const guid = loadStoredShareGuid(tournament.id, id);
    if (guid) setStoredShareGuid(guid);
  }, [tournament.id]);

  // Cascade the bracket to derive the predicted champion. Re-runs only
  // when bracket changes (which after mount is approximately once).
  const cascaded: CascadedBracket | null = useMemo(() => {
    if (!bracket) return null;
    const legacy = bracketToCascadeInput(tournament, bracket, userIdent);
    let result = cascade(tournament, legacy);
    for (let pass = 0; pass < 6; pass += 1) {
      const overlays = Object.values(bracket.knockoutPredictions)
        .map((p) => {
          const k = result.knockouts.find((x) => x.id === p.matchId);
          if (!k) return null;
          const team = p.outcome === "home_win" ? k.home.team : k.away.team;
          return team ? { match_id: p.matchId, winner: team } : null;
        })
        .filter((x): x is { match_id: string; winner: string } => x !== null);
      const before = result.knockouts.filter((k) => k.effective_winner).length;
      result = cascade(tournament, { ...legacy, knockouts: overlays });
      const after = result.knockouts.filter((k) => k.effective_winner).length;
      if (after === before) break;
    }
    return result;
  }, [bracket, tournament, userIdent]);

  const totalGroup = tournament.group_fixtures.length;
  const totalKnockout = tournament.knockouts.length;
  const totalPicks = totalGroup + totalKnockout;
  const groupPicks = bracket ? Object.keys(bracket.matchPredictions).length : 0;
  const knockoutPicks = bracket ? Object.keys(bracket.knockoutPredictions).length : 0;
  const committed = groupPicks + knockoutPicks;
  const isComplete = committed === totalPicks;

  const final = cascaded?.knockouts.find((k) => k.stage === "f");
  const championCode = final?.effective_winner ?? final?.predicted_winner ?? null;
  const champion = teamName(tournament, championCode);

  // Stable share guid + URLs. `useMemo` ensures the URL doesn't change
  // on every render, important because the `<img>`'s src would otherwise
  // re-fetch.
  const guid = useMemo(
    () =>
      resolveShareGuid({
        serverShareGuid: storedShareGuid,
        authUserId,
        bracketId: bracket?.bracketId ?? userIdent,
      }),
    [storedShareGuid, authUserId, bracket?.bracketId, userIdent],
  );
  const shareUrl = useMemo(() => shareUrlFor(guid), [guid]);
  const shareDisplay = useMemo(() => shareDisplayUrlFor(guid), [guid]);
  const shareText = useMemo(
    () => buildShareText({ champion, guid, isComplete }),
    [champion, guid, isComplete],
  );
  const shareLinks = useMemo(
    () => buildShareLinks({ champion, guid, isComplete }),
    [champion, guid, isComplete],
  );

  const ogUrlBase = useMemo(
    () => ({
      bracketId: bracket?.bracketId ?? guid,
      handle: handle ?? "Anonymous",
      winner: champion ?? "TBD",
    }),
    [bracket?.bracketId, guid, handle, champion],
  );

  const ogUrl = useMemo(
    () => buildOgImageUrl({ ...ogUrlBase, size }),
    [ogUrlBase, size],
  );

  // ---------- Handlers ----------

  const handleCopy = useCallback(async (): Promise<void> => {
    pushAnalytics("copy");
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
      } else if (typeof document !== "undefined") {
        // Legacy clipboard fallback for browsers without the async API.
        const el = document.createElement("textarea");
        el.value = shareUrl;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Swallow, the platform buttons still work without clipboard access.
    }
  }, [shareUrl]);

  const handlePrimaryShare = useCallback(async (): Promise<void> => {
    pushAnalytics("native");
    void tapFeedback("medium");
    const ok = await shareContent({
      title: buildShareTitle(),
      text: shareText,
      url: shareUrl,
    });
    if (!ok) {
      // Web Share API unavailable / cancelled, show the platform
      // fallback popover so the user can still pick a target.
      setFallbackOpen(true);
    }
  }, [shareText, shareUrl]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // ---------- Render ----------

  const lastSaved = formatTimestamp(bracket?.lockedAt);

  return (
    <main className="vt-ss-page" aria-labelledby="vt-ss-title">
      {/* Hero strip */}
      <header className="vt-ss-hero">
        <div>
          <p className="vt-ss-eyebrow">FIFA World Cup 2026</p>
          <h1 id="vt-ss-title" className="vt-ss-title">Your World Cup 2026 bracket</h1>
          <p className="vt-ss-sub">
            <span className="vt-ss-saved-at" data-testid="vt-ss-saved-at">
              {bracket?.lockedAt ? `Last saved ${lastSaved}` : "Draft only, save to share"}
            </span>
          </p>
        </div>
        <div
          className={`vt-ss-count-chip${isComplete ? " is-complete" : ""}`}
          data-testid="vt-ss-count-chip"
          aria-label={`${committed} of ${totalPicks} picks saved`}
        >
          <strong>{committed}</strong>
          <span> of {totalPicks} picks saved</span>
        </div>
      </header>

      {/* Big OG image preview */}
      <section className="vt-ss-preview" aria-label="Bracket card preview">
        <div className="vt-ss-preview-frame" data-size={size}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={ogUrl}
            src={ogUrl}
            alt={`${handle ?? "Your"} bracket, champion ${champion ?? "TBD"}`}
            className="vt-ss-preview-img"
            data-testid="vt-ss-og-image"
          />
        </div>
        <div
          className="vt-ss-size-chips"
          role="tablist"
          aria-label="Card format"
        >
          <SizeChip size="portrait" current={size} onSelect={setSize} />
          <SizeChip size="landscape" current={size} onSelect={setSize} />
          <SizeChip size="square" current={size} onSelect={setSize} />
        </div>
      </section>

      {/* Share URL row */}
      <section className="vt-ss-url-row" aria-label="Your shareable link">
        <label htmlFor="vt-ss-url-input" className="vt-ss-url-label">
          Your share link
        </label>
        <div className="vt-ss-url-controls">
          <input
            id="vt-ss-url-input"
            type="text"
            readOnly
            value={shareDisplay}
            data-testid="vt-ss-url-input"
            className="vt-ss-url-input"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="vt-ss-copy-btn"
            data-testid="vt-ss-copy-btn"
            onClick={handleCopy}
            aria-live="polite"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
        {copied && (
          <span className="vt-ss-copied-pill" role="status" data-testid="vt-ss-copied-pill">
            Link copied to clipboard
          </span>
        )}
      </section>

      {/* Primary share CTA */}
      <section className="vt-ss-primary-cta" aria-label="Share my bracket">
        <button
          type="button"
          className="vt-ss-cta-btn"
          data-testid="vt-ss-primary-share"
          onClick={() => {
            void handlePrimaryShare();
          }}
        >
          Share my bracket
        </button>
        {fallbackOpen && (
          <p className="vt-ss-fallback-note" role="status">
            Pick a platform below to finish sharing.
          </p>
        )}
      </section>

      {/* Platform buttons row (always visible) */}
      <section className="vt-ss-platforms" aria-label="Share to a platform">
        <PlatformButton
          platform="whatsapp"
          href={shareLinks.whatsapp}
          label="WhatsApp"
          icon={<WhatsAppIcon />}
        />
        <PlatformButton
          platform="telegram"
          href={shareLinks.telegram}
          label="Telegram"
          icon={<TelegramIcon />}
        />
        <PlatformButton
          platform="x"
          href={shareLinks.x}
          label="X"
          icon={<XIcon />}
        />
        <PlatformButton
          platform="facebook"
          href={shareLinks.facebook}
          label="Facebook"
          icon={<FacebookIcon />}
        />
        <PlatformButton
          platform="email"
          href={shareLinks.email}
          label="Email"
          icon={<EmailIcon />}
        />
      </section>

      {/* Download row */}
      <section className="vt-ss-downloads" aria-label="Download bracket image">
        <h2 className="vt-ss-section-title">Download as image</h2>
        <div className="vt-ss-download-grid">
          {(["portrait", "landscape", "square"] as const).map((s) => {
            const url = buildOgImageUrl({ ...ogUrlBase, size: s });
            return (
              <a
                key={s}
                href={url}
                download={ogDownloadFilename({ ...ogUrlBase, size: s })}
                className="vt-ss-download-btn"
                data-testid={`vt-ss-download-${s}`}
                onClick={() => pushAnalytics("download")}
              >
                <span className="vt-ss-download-size">{s[0].toUpperCase() + s.slice(1)}</span>
                <span className="vt-ss-download-hint">PNG</span>
              </a>
            );
          })}
        </div>
      </section>

      {/* Embed snippet, collapsible */}
      <section className="vt-ss-embed" aria-label="Embed on a blog">
        <details>
          <summary>Embed this on a blog</summary>
          <p className="vt-ss-embed-note">
            Paste this snippet into any website. The preview image updates
            automatically each time you save a new pick.
          </p>
          <pre className="vt-ss-embed-snippet" data-testid="vt-ss-embed-snippet">
{`<a href="${shareUrl}" target="_blank" rel="noopener">
  <img src="https://play.tournamental.com${buildOgImageUrl({ ...ogUrlBase, size: "landscape" })}"
       alt="My Tournamental World Cup 2026 bracket"
       width="1200" height="630" />
</a>`}
          </pre>
        </details>
      </section>

      {/* Mobile sticky share CTA, visible only at <=640px via CSS. */}
      <div className="vt-ss-sticky-cta" aria-hidden="false">
        <button
          type="button"
          className="vt-ss-cta-btn vt-ss-cta-btn--sticky"
          data-testid="vt-ss-sticky-share"
          onClick={() => {
            void handlePrimaryShare();
          }}
        >
          Share my bracket
        </button>
      </div>
    </main>
  );
}

// ---------- Inline icons ----------
// Monochrome SVGs, sized via CSS to 32×32. Keeping them inline avoids
// shipping an icon-font + an extra request for five 1KB sprites.

function WhatsAppIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.52 3.48A11.94 11.94 0 0 0 12 0C5.37 0 .02 5.36.02 11.99c0 2.11.55 4.18 1.6 6L0 24l6.18-1.62a12 12 0 0 0 5.82 1.49h.01c6.62 0 11.99-5.37 11.99-12 0-3.2-1.25-6.21-3.48-8.39ZM12 21.7c-1.78 0-3.53-.48-5.06-1.4l-.36-.21-3.67.96.98-3.58-.24-.37A9.65 9.65 0 0 1 2.32 12c0-5.34 4.34-9.68 9.68-9.68 2.59 0 5.02 1.01 6.85 2.84a9.6 9.6 0 0 1 2.83 6.85c0 5.34-4.34 9.69-9.68 9.69Zm5.31-7.27c-.29-.15-1.72-.85-1.99-.95-.27-.1-.46-.15-.66.15-.19.29-.76.95-.93 1.14-.17.19-.34.22-.63.07-.29-.15-1.22-.45-2.32-1.43-.86-.77-1.44-1.71-1.61-2-.17-.29-.02-.45.13-.6.14-.13.29-.34.43-.51.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.15-.66-1.59-.91-2.18-.24-.57-.49-.5-.66-.51l-.56-.01c-.19 0-.51.07-.78.36-.27.29-1.03 1.01-1.03 2.47s1.05 2.86 1.2 3.06c.15.19 2.07 3.16 5.02 4.43.7.3 1.25.48 1.68.62.71.23 1.35.2 1.86.12.57-.08 1.72-.7 1.96-1.38.24-.68.24-1.26.17-1.38-.07-.12-.27-.19-.56-.34Z" />
    </svg>
  );
}

function TelegramIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.94 4.3 18.7 19.62c-.24 1.07-.88 1.34-1.79.83l-4.94-3.64-2.38 2.29c-.27.27-.5.5-1.01.5l.36-5.09 9.27-8.38c.4-.36-.09-.56-.62-.2L6.13 13.13 1.2 11.6c-1.07-.33-1.09-1.07.22-1.59L20.55 2.7c.89-.33 1.67.2 1.39 1.6Z" />
    </svg>
  );
}

function XIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.8l-5.32-6.96L4.8 22H1.54l8.02-9.17L1 2h6.96l4.81 6.36L18.244 2Zm-2.39 18h1.88L7.24 4H5.27l10.585 16Z" />
    </svg>
  );
}

function FacebookIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22 12.07C22 6.51 17.52 2 12 2S2 6.51 2 12.07C2 17.1 5.66 21.26 10.44 22v-7.02H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.1 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.57v1.88h2.77l-.44 2.91h-2.33V22C18.34 21.26 22 17.1 22 12.07Z" />
    </svg>
  );
}

function EmailIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 4.2v9.8h16V8.2l-8 5.34L4 8.2ZM4 6l8 5.33L20 6H4Z" />
    </svg>
  );
}
