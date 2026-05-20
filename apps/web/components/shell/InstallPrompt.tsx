"use client";

/**
 * "Install Tournamental" affordance, rendered as a single line at the
 * foot of the AppMenuDrawer (NOT a top-of-page banner). The drawer-level
 * placement keeps the install path discoverable without interrupting
 * reading.
 *
 * Behaviour:
 *   - Listens for `beforeinstallprompt` (Chrome / Edge / Android Chrome)
 *     and `appinstalled`.
 *   - On tap, fires the saved prompt and waits for `userChoice`.
 *   - iOS Safari has no `beforeinstallprompt`; we detect iOS + non-
 *     standalone and surface a "Tap share, then Add to Home Screen"
 *     hint instead.
 *   - Dismissals are persisted in localStorage as an ISO timestamp.
 *     The affordance suppresses itself for 30 days after a dismissal
 *     so the menu does not nag returning visitors.
 *   - Hidden entirely once the page is running in standalone display
 *     mode (the user already installed).
 *
 * Returns null in every "do not show" branch so the drawer can render
 * <InstallPrompt /> unconditionally and the component decides whether
 * to occupy any DOM at all.
 */

import { useEffect, useState } from "react";

const DISMISS_KEY = "vt-install-dismissed-at";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallState =
  | { kind: "hidden" }
  | { kind: "chromium"; event: BeforeInstallPromptEvent }
  | { kind: "ios" }
  /**
   * Generic fallback. Surfaces when we are not in standalone, we are
   * not iOS Safari, and `beforeinstallprompt` hasn't fired yet (Chrome
   * can withhold the event for engagement reasons, esp. on the first
   * visit). The CTA opens browser-specific install help rather than
   * staying invisible. Per Tim 2026-05-21: the affordance must always
   * be visible in the drawer for non-installed visitors, otherwise the
   * PWA install path looks broken.
   */
  | { kind: "generic" };

function readDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage?.getItem(DISMISS_KEY);
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeDismissedAt(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(DISMISS_KEY, new Date().toISOString());
  } catch {
    // ignore quota / private-mode failures
  }
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari exposes navigator.standalone on the home-screen instance.
  // @ts-expect-error iOS Safari specific
  return window.navigator.standalone === true;
}

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent ?? "";
  const isIos = /iPad|iPhone|iPod/i.test(ua);
  const isChromeOrFx = /CriOS|FxiOS/i.test(ua);
  return isIos && !isChromeOrFx;
}

export function InstallPrompt() {
  const [state, setState] = useState<InstallState>({ kind: "hidden" });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    if (isStandalone()) return undefined;

    const dismissedAt = readDismissedAt();
    if (dismissedAt !== null && Date.now() - dismissedAt < DISMISS_TTL_MS) {
      return undefined;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setState({ kind: "chromium", event: e as BeforeInstallPromptEvent });
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => setState({ kind: "hidden" });
    window.addEventListener("appinstalled", installedHandler);

    // iOS Safari never fires beforeinstallprompt. Show the share-sheet
    // hint instead, but only if we are actually on iOS Safari.
    if (isIosSafari()) {
      setState({ kind: "ios" });
    } else {
      // Generic fallback for every non-iOS browser. If chromium fires
      // beforeinstallprompt later, the handler upgrades the state to
      // { kind: "chromium" } which gives us the native install button.
      // If it never fires, the generic CTA opens the browser's own
      // menu instructions instead of staying invisible.
      setState({ kind: "generic" });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  if (state.kind === "hidden") return null;

  const dismiss = () => {
    writeDismissedAt();
    setState({ kind: "hidden" });
  };

  const onClick = async () => {
    if (state.kind === "chromium") {
      try {
        await state.event.prompt();
        const choice = await state.event.userChoice;
        if (choice.outcome === "accepted" || choice.outcome === "dismissed") {
          dismiss();
        }
      } catch {
        dismiss();
      }
      return;
    }
    // iOS + generic paths: no programmatic install API. Tapping the
    // line counts as "saw the hint" and dismisses for 30 days.
    dismiss();
  };

  // Single-word visible label per Tim 2026-05-21 ("just say Install").
  // The longer description goes into aria-label so screen readers
  // still hear the iOS / generic path differentiation.
  const ariaLabel =
    state.kind === "ios"
      ? "Install Tournamental: tap share, then Add to Home Screen"
      : state.kind === "generic"
        ? "Install Tournamental: open your browser menu, then Install app"
        : "Install Tournamental as an app";

  return (
    <div className="vt-drawer-install">
      <button
        type="button"
        className="vt-drawer-install-cta"
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {/* Standard install glyph (downward arrow into tray) per
         * 2026-05-21 — the gold ball was misread as a generic logo
         * rather than an install affordance. Inline SVG so the colour
         * inherits from currentColor and stays on-token. */}
        <svg
          className="vt-drawer-install-mark"
          viewBox="0 0 24 24"
          width={20}
          height={20}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        <span className="vt-drawer-install-label">Install</span>
        <span className="vt-drawer-install-arrow" aria-hidden="true">
          →
        </span>
      </button>
      <button
        type="button"
        className="vt-drawer-install-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
        aria-label="Dismiss install prompt"
      >
        ✕
      </button>
    </div>
  );
}
