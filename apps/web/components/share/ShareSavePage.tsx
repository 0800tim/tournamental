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
} from "@tournamental/bracket-engine";

import { useUser } from "@/lib/auth/useUser";
import { loadServerBracket } from "@/lib/bracket/api";
import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import { mergeBrackets } from "@/lib/bracket/merge";
import { localUserId, loadDraft, saveDraft } from "@/lib/bracket/storage";
// dom-capture.ts is retained for legacy paths but no longer used here;
// the save-share page now fetches the OG image directly (Tim 2026-05-14).
import type {
  DomCaptureResult,
  DomCaptureSize,
} from "@/lib/molecule/dom-capture";
import { tapFeedback } from "@/lib/native";
import { loadStoredShareGuid } from "@/lib/share/share-guid-storage";
import { slugifyDisplayName } from "@/lib/share/handle-slug";
import {
  type OgSize,
  buildOgImageUrl,
  buildShareLinks,
  buildShareText,
  buildShareTextBody,
  buildShareTitle,
  resolveShareGuid,
  shareDisplayUrlFor,
  shareUrlFor,
} from "@/lib/share/share-text";

import { SignupModal } from "@/components/auth/SignupModal";

import { MoleculeSharePreview } from "./MoleculeSharePreview";

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

function triggerDownload(href: string, filename: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

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

/** Pixel dimensions for the format chip hint. Matches `specFor` in
 *  `dom-capture.ts` — bump both if either changes. */
function sizeDimensions(s: DomCaptureSize): string {
  switch (s) {
    case "portrait":
      return "1080×1920 PNG";
    case "square":
      return "1080×1080 PNG";
    case "landscape":
    default:
      return "1600×900 PNG";
  }
}

/**
 * Compose the legacy static OG image URL used in the blog embed
 * snippet. The molecule capture is per-pose and client-side, so the
 * embed falls back to the server-rendered `bracket-share-card.ts`
 * endpoint which produces the older PYRAMID-sketch + PODIUM card.
 * Tim's brief explicitly carves that path out as "stays for legacy
 * social-meta + blog embeds".
 */
function embedOgUrl(input: { bracketId: string; handle: string; winner: string }): string {
  const q = new URLSearchParams();
  q.set("bracket_id", input.bracketId);
  q.set("handle", input.handle);
  q.set("winner", input.winner);
  q.set("size", "landscape");
  return `/api/og/bracket?${q.toString()}`;
}

function sizeHint(s: DomCaptureSize): string {
  switch (s) {
    case "portrait":
      return "Portrait fits Stories, Reels, and TikTok feeds.";
    case "square":
      return "Square fits Instagram feed posts and WhatsApp avatars.";
    case "landscape":
    default:
      return "Landscape fits X, Facebook, LinkedIn, and WhatsApp link previews.";
  }
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

  // Identity hierarchy mirrors BracketBuilder: authed `tnm_session` user
  // id when signed in, else the local browser uuid. Without this the
  // save-share page reads the wrong bucket (guest uuid) when the user
  // is signed in and saved under their auth id.
  const auth = useUser();
  useEffect(() => {
    if (auth.loading) return;
    const authedId = auth.user?.id ?? null;
    const guestId = localUserId();
    const id = authedId ?? guestId;
    setUserIdent(id);

    // Load whatever's in localStorage for the resolved identity.
    let starting = loadDraft(tournament.id, id) ?? null;
    if (starting) setBracket(starting);

    // Pick up the canonical (server-returned) share guid persisted at
    // last save. If absent (offline-only state) we fall through to the
    // legacy bracketId-based URL, the next save will replace it.
    const guid =
      loadStoredShareGuid(tournament.id, id) ??
      (authedId ? loadStoredShareGuid(tournament.id, guestId) : null);
    if (guid) setStoredShareGuid(guid);

    // Best-effort server hydration so the save-share view reflects the
    // server-of-record even when this device hasn't built the bracket
    // locally (e.g. user saved on phone, opens share page on laptop).
    let cancelled = false;
    void (async () => {
      const remote = await loadServerBracket({
        userId: id,
        tournamentId: tournament.id,
      });
      if (cancelled || !remote.ok) return;
      const merged = starting
        ? mergeBrackets(starting, remote.bracket)
        : remote.bracket;
      saveDraft(tournament.id, merged, id);
      setBracket(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [tournament.id, auth.loading, auth.user?.id]);

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
  // Friendly handle for the signed-in user. Top precedence in the
  // resolver chain so the share URL renders as `/s/0800tim` instead of
  // `/s/<random-guid>` (Tim 2026-05-24). Falls through to the guid
  // form when handle is null / contested.
  const authHandle = slugifyDisplayName(auth.profile?.display_name ?? null);
  const guid = useMemo(
    () =>
      resolveShareGuid({
        serverShareGuid: storedShareGuid,
        authUserId,
        authHandle,
        bracketId: bracket?.bracketId ?? userIdent,
      }),
    [storedShareGuid, authUserId, authHandle, bracket?.bracketId, userIdent],
  );
  const shareUrl = useMemo(() => shareUrlFor(guid), [guid]);
  const shareDisplay = useMemo(() => shareDisplayUrlFor(guid), [guid]);
  // Body-only text for navigator.share (URL passed separately so the
  // URL doesn't appear twice in WhatsApp / iMessage previews — Tim
  // 2026-05-24). buildShareText (with URL inline) is still consumed
  // by buildShareLinks for the deep-link fallbacks below.
  const shareTextBody = useMemo(
    () => buildShareTextBody({ champion, guid, isComplete }),
    [champion, guid, isComplete],
  );
  void buildShareText;
  const shareLinks = useMemo(
    () => buildShareLinks({ champion, guid, isComplete }),
    [champion, guid, isComplete],
  );

  // Note: the captured PNG inherits the full podium for free —
  // `captureDomComposition` snapshots the live MoleculePanel which
  // includes the new "Podium peek" row (PR #161, 2026-05-11), so the
  // share image already carries 🥇 BRA · 🥈 ARG · 🥉 GER. No extra
  // wiring needed here.

  // ---------- Capture helpers ----------

  // Track the last captured object URL so we can revoke it on the
  // next capture / unmount, otherwise the browser pins the blob in
  // memory for the page session.
  const lastCaptureUrlRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (lastCaptureUrlRef.current) {
        try {
          URL.revokeObjectURL(lastCaptureUrlRef.current);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // 2026-05-14: capture pipeline swapped from a DOM-to-canvas dance
  // (which required mounting the 3D molecule + .molecule-panel) to a
  // direct fetch of /api/og/bracket. The endpoint renders the same
  // viral podium card the visible preview shows, so what the user
  // sees on this page is byte-identical to the file they download
  // and what social platforms unfurl from the share link.
  const performCapture = useCallback(
    async (s: DomCaptureSize): Promise<DomCaptureResult> => {
      // Derive runner-up / third-place codes from the cascade so the
      // endpoint can skip its fallback path.
      const finalK = cascaded?.knockouts.find((k) => k.stage === "f");
      const runnerCode = finalK
        ? finalK.effective_winner === finalK.home.team
          ? finalK.away.team
          : finalK.effective_winner === finalK.away.team
            ? finalK.home.team
            : null
        : null;
      const tpK = cascaded?.knockouts.find((k) => k.stage === "tp");
      const thirdCode = tpK?.effective_winner ?? tpK?.predicted_winner ?? null;
      const effectiveHandle =
        handle ?? auth.profile?.display_name ?? auth.profile?.handle ?? null;
      const url = buildOgImageUrl({
        bracketId: guid,
        handle: effectiveHandle,
        winner: championCode ?? null,
        runnerUp: runnerCode ?? null,
        third: thirdCode ?? null,
        avatarUrl:
          authUserId ?? auth.user?.id
            ? `/avatars/${authUserId ?? auth.user?.id}.jpg`
            : null,
        size: s,
      });
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`OG image fetch failed: ${res.status}`);
      }
      const blob = await res.blob();
      if (lastCaptureUrlRef.current) {
        try {
          URL.revokeObjectURL(lastCaptureUrlRef.current);
        } catch {
          // ignore
        }
      }
      const objectUrl = URL.createObjectURL(blob);
      lastCaptureUrlRef.current = objectUrl;
      const handleSlug = (handle ?? "bracket")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "bracket";
      return {
        blob,
        objectUrl,
        filename: `tournamental-${handleSlug}-${s}.png`,
      };
    },
    [guid, handle, championCode, cascaded, authUserId, auth.user?.id],
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

  const [primaryBusy, setPrimaryBusy] = useState<boolean>(false);
  const handlePrimaryShare = useCallback(async (): Promise<void> => {
    if (primaryBusy) return;
    pushAnalytics("native");
    void tapFeedback("medium");
    setPrimaryBusy(true);
    try {
      // v6.1, "viral share landing" (2026-05-11). The primary CTA
      // captures a fresh molecule + panel composition at the user's
      // chosen size (defaulting to landscape) and hands it to the
      // native share sheet via Web Share Level 2 (`files`). If files
      // aren't supported (most desktop browsers) we fall through to
      // the legacy URL+text share, then the platform-button popover.
      let result: DomCaptureResult | null = null;
      try {
        result = await performCapture(size);
      } catch {
        // Capture failed (no canvas, GL context lost, hydration race).
        // Don't bail entirely — the URL share path is still useful.
        result = null;
      }
      const nav = typeof navigator !== "undefined" ? navigator : null;
      // Web Share Level 2 (files) — iOS Safari + Android Chrome.
      if (
        result &&
        nav &&
        typeof nav.canShare === "function" &&
        typeof nav.share === "function"
      ) {
        const file = new File([result.blob], result.filename, { type: "image/png" });
        if (nav.canShare({ files: [file] })) {
          try {
            await nav.share({
              files: [file],
              title: buildShareTitle(),
              text: shareTextBody,
              url: shareUrl,
            });
            return;
          } catch (err) {
            // AbortError = user cancelled, treat as success-ish.
            if (err instanceof Error && err.name === "AbortError") return;
            // Fall through to the URL-only share + popover fallback.
          }
        }
      }
      // Desktop / no-files fallback: pop the URL share sheet.
      if (nav && typeof nav.share === "function") {
        try {
          await nav.share({
            title: buildShareTitle(),
            text: shareTextBody,
            url: shareUrl,
          });
          return;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
        }
      }
      // Last-resort: download the PNG locally (if we have one) and
      // open the platform popover so the user can pick a target.
      if (result) triggerDownload(result.objectUrl, result.filename);
      setFallbackOpen(true);
    } finally {
      setPrimaryBusy(false);
    }
  }, [primaryBusy, performCapture, size, shareTextBody, shareUrl]);

  // Note: the previous per-size handleDownload() callback was removed
  // 2026-06-01 in favour of an anchor that opens the image in a new tab
  // using the currently-selected `size` toggle. The new flow plays
  // nicely with iOS Safari which silently blocked programmatic
  // <a download> on hosted PNGs.

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // ---------- Render ----------

  const lastSaved = formatTimestamp(bracket?.lockedAt);

  // Auth gate: if the user is browsing the save-share page anonymously
  // they get an anonymous share URL bound to a localStorage uuid that
  // recipients can't trace back. That's a poor sharing experience, so
  // we require sign-in. The pretty preview stays parked behind the
  // SignupModal. Once the user signs in (cookie set by auth-sms +
  // useUser() refreshes) the auth.user becomes non-null and this gate
  // unmounts to reveal the share surface (Tim 2026-05-22).
  if (!auth.loading && !auth.user) {
    return <ShareSignInGate />;
  }

  return (
    <main className="vt-ss-page" aria-labelledby="vt-ss-title">
      {/* Hero strip */}
      <header className="vt-ss-hero">
        <div>
          <p className="vt-ss-eyebrow">Football World Cup 2026</p>
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

      {/* v6.1, "viral share landing" (2026-05-11). The preview is now
        * the LIVE molecule + champion-panel composition — the same
        * one `dom-capture.ts` snapshots when the user hits Share or
        * Download. The format switcher selects which aspect ratio the
        * downloaded PNG uses (landscape 16:9, portrait 9:16, square
        * 1:1). The on-screen preview stays 16:9 regardless, the
        * format hint under the chips clarifies what each chip
        * downloads as. */}
      <section className="vt-ss-preview" aria-label="Bracket card preview">
        <MoleculeSharePreview
          tournament={tournament}
          bracket={bracket}
          authUserId={authUserId ?? auth.user?.id ?? null}
          handle={
            handle ??
            auth.profile?.display_name ??
            auth.profile?.handle ??
            null
          }
          avatarUrl={
            authUserId || auth.user?.id
              ? `/avatars/${authUserId ?? auth.user?.id}.jpg`
              : null
          }
          size={size}
        />
        <div
          className="vt-ss-size-chips"
          role="tablist"
          aria-label="Card format"
        >
          <SizeChip size="portrait" current={size} onSelect={setSize} />
          <SizeChip size="landscape" current={size} onSelect={setSize} />
          <SizeChip size="square" current={size} onSelect={setSize} />
        </div>
        <p className="vt-ss-size-hint" data-testid="vt-ss-size-hint">
          {sizeHint(size)}
        </p>
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

      {/* Bird's-eye view share — the "whole tournament planner" card.
        * Renders all 12 groups + the user's gold-path + champion crown in
        * a single PNG that's ideal for status / Stories. Wired here so a
        * power user can grab the brag card alongside the podium variant
        * (Tim 2026-05-22, doc 36 §F item 11). */}
      <BirdseyeShare
        bracketId={guid}
        handle={handle ?? auth.profile?.handle ?? auth.profile?.display_name ?? null}
      />


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

      {/* Download row. The 3-button per-size grid was replaced with a
        * single CTA that opens the image at the CURRENTLY SELECTED size
        * (driven by the format toggle above the preview) in a new tab.
        * Programmatic <a download> was unreliable on iOS Safari and
        * the user-controlled "right-click / long-press → Save Image"
        * flow works on every platform. Tim 2026-06-01. */}
      <section className="vt-ss-downloads" aria-label="Save bracket image">
        <h2 className="vt-ss-section-title">Save your bracket image</h2>
        <p className="vt-ss-download-instructions">
          Opens the <strong>{size[0].toUpperCase() + size.slice(1)}</strong>{" "}
          version ({sizeDimensions(size)}) in a new tab. Right-click and{" "}
          <em>Save Image As</em> on desktop, or long-press and{" "}
          <em>Save to Photos</em> on mobile. Switch format above first if
          you want Portrait or Square instead.
        </p>
        <a
          className="vt-ss-download-open-cta"
          href={(() => {
            const finalK = cascaded?.knockouts.find((k) => k.stage === "f");
            const runnerCode = finalK
              ? finalK.effective_winner === finalK.home.team
                ? finalK.away.team
                : finalK.effective_winner === finalK.away.team
                  ? finalK.home.team
                  : null
              : null;
            const tpK = cascaded?.knockouts.find((k) => k.stage === "tp");
            const thirdCode = tpK?.effective_winner ?? tpK?.predicted_winner ?? null;
            const effectiveHandle =
              handle ?? auth.profile?.display_name ?? auth.profile?.handle ?? null;
            return buildOgImageUrl({
              bracketId: guid,
              handle: effectiveHandle,
              winner: championCode ?? null,
              runnerUp: runnerCode ?? null,
              third: thirdCode ?? null,
              avatarUrl:
                authUserId ?? auth.user?.id
                  ? `/avatars/${authUserId ?? auth.user?.id}.jpg`
                  : null,
              size,
            });
          })()}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="vt-ss-download-open"
          onClick={() => pushAnalytics("download")}
        >
          <span aria-hidden="true">↗</span>
          <span>Open {size[0].toUpperCase() + size.slice(1)} image in new tab</span>
        </a>
      </section>

      {/* Embed snippet, collapsible. The molecule capture is per-pose
        * + client-side, so the blog embed falls back to the legacy
        * server-rendered OG card (static "PYRAMID + PODIUM" sketch).
        * Tim 2026-05-11: keep this path alive for blog + meta-tag use
        * cases; the live molecule preview is the on-page hero. */}
      <section className="vt-ss-embed" aria-label="Embed on a blog">
        <details>
          <summary>Embed this on a blog</summary>
          <p className="vt-ss-embed-note">
            Paste this snippet into any website. The preview image updates
            automatically each time you save a new pick.
          </p>
          <pre className="vt-ss-embed-snippet" data-testid="vt-ss-embed-snippet">
{`<a href="${shareUrl}" target="_blank" rel="noopener">
  <img src="https://play.tournamental.com${embedOgUrl({ bracketId: bracket?.bracketId ?? guid, handle: handle ?? "Anonymous", winner: champion ?? "TBD" })}"
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

/**
 * Bird's-eye share card surface. Two affordances:
 *   1. Native share with a generated File on browsers that support it
 *      (Android Chrome / iOS Safari 15+). The user picks the channel.
 *   2. Open the PNG in a new tab as a fallback so the user can
 *      long-press / right-click → save.
 *
 * The card itself is rendered server-side at /api/og/bracket-birdseye
 * with the user's share guid; the route resolves their predicted
 * champion + gold-path from the game service.
 */
function BirdseyeShare({
  bracketId,
  handle,
}: {
  bracketId: string | null;
  handle: string | null;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const buildUrl = (size: "portrait" | "landscape" | "square"): string => {
    const u = new URLSearchParams();
    if (bracketId) u.set("bracket_id", bracketId);
    if (handle) u.set("handle", handle);
    u.set("size", size);
    return `/api/og/bracket-birdseye?${u.toString()}`;
  };
  const previewUrl = buildUrl("portrait");

  const onShare = async (): Promise<void> => {
    setBusy(true);
    try {
      const w = window as Window & { dataLayer?: Array<Record<string, unknown>> };
      if (!Array.isArray(w.dataLayer)) w.dataLayer = [];
      w.dataLayer.push({
        event: "share_clicked",
        platform: "birdseye",
        surface: "save-share",
      });
      const nav = navigator as Navigator & {
        share?: (d: ShareData) => Promise<void>;
        canShare?: (d: ShareData) => boolean;
      };
      const portraitUrl = buildUrl("portrait");
      const text = "My World Cup 2026 bracket — all 48 teams, full predictions.";
      const shareLanding = bracketId
        ? `https://play.tournamental.com/world-cup-2026/share/${encodeURIComponent(bracketId)}`
        : "https://play.tournamental.com/world-cup-2026/save-share";

      if (typeof nav.share === "function") {
        try {
          // Try file-share first (best UX on Android / iOS).
          const res = await fetch(portraitUrl, { credentials: "include" });
          if (res.ok && typeof nav.canShare === "function") {
            const blob = await res.blob();
            const file = new File([blob], "birdseye-bracket.png", {
              type: blob.type || "image/png",
            });
            const data: ShareData = { title: "My World Cup 2026 bracket", text, url: shareLanding, files: [file] };
            if (nav.canShare(data)) {
              await nav.share(data);
              return;
            }
          }
        } catch {
          /* fall through to text+url share */
        }
        await nav.share({ title: "My World Cup 2026 bracket", text, url: shareLanding });
        return;
      }
      // No native share: open the image in a new tab so the user can save it.
      window.open(portraitUrl, "_blank", "noopener");
      setDownloaded(true);
      window.setTimeout(() => setDownloaded(false), 2500);
    } catch {
      /* user cancelled or share failed; non-fatal */
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="vt-ss-birdseye" aria-label="Bird's-eye bracket share">
      <div className="vt-ss-birdseye-head">
        <p className="vt-ss-birdseye-eyebrow">Bonus brag-card</p>
        <h3 className="vt-ss-birdseye-title">Share the whole tournament</h3>
        <p className="vt-ss-birdseye-sub">
          All 12 groups + your knockout picks + champion crown in one card.
          Perfect for WhatsApp status, Instagram Story, or a group chat.
        </p>
      </div>
      <a
        className="vt-ss-birdseye-preview"
        href={previewUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open bird's-eye bracket image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Bird's-eye bracket preview" loading="lazy" />
      </a>
      <div className="vt-ss-birdseye-actions">
        <button
          type="button"
          className="vt-ss-birdseye-cta"
          onClick={() => {
            void onShare();
          }}
          disabled={busy}
        >
          {busy ? "Preparing…" : downloaded ? "Opened ↗" : "Share bird's-eye"}
        </button>
        <a
          className="vt-ss-birdseye-link"
          href={buildUrl("portrait")}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Portrait ↗
        </a>
        <a
          className="vt-ss-birdseye-link"
          href={buildUrl("landscape")}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Landscape ↗
        </a>
        <a
          className="vt-ss-birdseye-link"
          href={buildUrl("square")}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Square ↗
        </a>
      </div>
      <p className="vt-ss-birdseye-save-note">
        Each "Open" link opens the full image in a new tab. Right-click and{" "}
        <em>Save Image As</em> on desktop, or long-press and{" "}
        <em>Save to Photos</em> on mobile.
      </p>
      <style jsx>{`
        .vt-ss-birdseye {
          margin-top: 18px;
          padding: 20px;
          background: linear-gradient(180deg, rgba(252, 211, 77, 0.06), rgba(20, 20, 24, 0.6));
          border: 1px solid rgba(220, 169, 75, 0.22);
          border-radius: 14px;
        }
        .vt-ss-birdseye-eyebrow {
          margin: 0 0 4px;
          font-family: "JetBrains Mono", ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--vt-gold-400, #dca94b);
        }
        .vt-ss-birdseye-title {
          margin: 0 0 6px;
          font-family: var(--vt-display, "Fraunces", Georgia, serif);
          font-size: 22px;
          font-weight: 500;
          color: var(--vt-fg, #f4f4f5);
        }
        .vt-ss-birdseye-sub {
          margin: 0 0 14px;
          color: var(--vt-fg-muted, #a3a3ad);
          font-size: 13px;
          line-height: 1.5;
        }
        .vt-ss-birdseye-preview {
          display: block;
          border-radius: 10px;
          overflow: hidden;
          background: #0c0c10;
          border: 1px solid rgba(220, 169, 75, 0.16);
          margin-bottom: 14px;
          max-width: 260px;
          aspect-ratio: 1080 / 1920;
        }
        .vt-ss-birdseye-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .vt-ss-birdseye-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
        }
        .vt-ss-birdseye-cta {
          appearance: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 12px 18px;
          border-radius: 999px;
          border: 0;
          background: linear-gradient(180deg, #fcd34d 0%, #f59e0b 100%);
          color: #15151a;
          font-weight: 800;
          font-size: 14px;
          letter-spacing: 0.01em;
          cursor: pointer;
          box-shadow: 0 8px 22px -8px rgba(220, 169, 75, 0.55);
        }
        .vt-ss-birdseye-cta:hover:not(:disabled) {
          background: linear-gradient(180deg, #ffe084 0%, #ffae31 100%);
        }
        .vt-ss-birdseye-cta:disabled {
          opacity: 0.6;
          cursor: progress;
        }
        .vt-ss-birdseye-link {
          color: var(--vt-fg-muted, #a3a3ad);
          font-size: 13px;
          text-decoration: none;
          padding: 6px 10px;
          border-radius: 6px;
        }
        .vt-ss-birdseye-link:hover {
          color: var(--vt-gold-300, #fcd34d);
        }
        .vt-ss-birdseye-save-note {
          margin: 12px 0 0;
          font-size: 12px;
          color: var(--vt-fg-muted, #a3a3ad);
          line-height: 1.5;
        }
        .vt-ss-birdseye-save-note em {
          color: var(--vt-fg, #f4f4f5);
          font-style: normal;
          font-weight: 600;
        }
      `}</style>
    </section>
  );
}

function EmailIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 4.2v9.8h16V8.2l-8 5.34L4 8.2ZM4 6l8 5.33L20 6H4Z" />
    </svg>
  );
}

/**
 * Sign-in gate shown when an unauthenticated user lands on the
 * save-share surface. Tim's launch requirement: every shared bracket
 * must be tied to a real account so the recipient lands on a page that
 * names the predictor (Tim 2026-05-22).
 */
function ShareSignInGate(): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <main className="vt-ss-gate" aria-labelledby="vt-ss-gate-title">
      <div className="vt-ss-gate-card">
        <p className="vt-ss-eyebrow">One quick step</p>
        <h1 id="vt-ss-gate-title" className="vt-ss-gate-title">
          Sign in to share your bracket
        </h1>
        <p className="vt-ss-gate-sub">
          We attach your share link to your account so friends can see your
          name, your handle, and your live leaderboard rank when they open it.
          One tap via WhatsApp or Telegram. No password.
        </p>
        <button
          type="button"
          className="vt-ss-gate-cta"
          onClick={() => setOpen(true)}
        >
          Sign in to continue →
        </button>
        <p className="vt-ss-gate-back">
          <a href="/world-cup-2026">← Back to the bracket</a>
        </p>
      </div>
      <SignupModal open={open} onClose={() => setOpen(false)} />
      <style jsx>{`
        .vt-ss-gate {
          min-height: 60vh;
          display: grid;
          place-items: center;
          padding: 48px 16px;
        }
        .vt-ss-gate-card {
          max-width: 520px;
          width: 100%;
          background: var(--vt-surface-1, #1c1c22);
          border: 1px solid var(--vt-border, #2a2a31);
          border-radius: 14px;
          padding: 32px;
          text-align: center;
        }
        .vt-ss-gate-title {
          font-family: var(--vt-display, "Fraunces", serif);
          font-size: clamp(24px, 4vw, 34px);
          line-height: 1.15;
          margin: 8px 0 14px;
          color: var(--vt-fg, #f4f4f5);
        }
        .vt-ss-gate-sub {
          color: var(--vt-fg-muted, #9ca3af);
          font-size: 14px;
          line-height: 1.55;
          margin: 0 0 22px;
        }
        .vt-ss-gate-cta {
          display: inline-block;
          padding: 14px 22px;
          background: linear-gradient(180deg, #fcd34d 0%, #f59e0b 100%);
          color: #15151a;
          border: 0;
          border-radius: 10px;
          font-weight: 800;
          font-size: 15px;
          cursor: pointer;
          letter-spacing: 0.01em;
          box-shadow: 0 8px 22px -8px rgba(220, 169, 75, 0.65);
        }
        .vt-ss-gate-cta:hover {
          background: linear-gradient(180deg, #ffe084 0%, #ffae31 100%);
        }
        .vt-ss-gate-back {
          margin: 18px 0 0;
          font-size: 13px;
        }
        .vt-ss-gate-back a {
          color: var(--vt-fg-muted, #9ca3af);
          text-decoration: none;
        }
        .vt-ss-gate-back a:hover {
          color: var(--vt-gold-300, #fcd34d);
        }
      `}</style>
    </main>
  );
}
