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

/** Browser-specific instruction copy shown when we can't trigger the
 * native install dialog. Falls back to a generic step list when we
 * can't sniff the UA. Tim 2026-05-23: clicking Install used to call
 * dismiss() and close the drawer with no install path; this state
 * now expands the row to show what to do. */
function instructionSteps(state: InstallState): readonly string[] {
  if (state.kind === "ios") {
    return [
      "Tap the Share icon at the bottom of Safari.",
      "Scroll the share sheet and tap “Add to Home Screen”.",
      "Tap Add. Tournamental opens like a normal app from your home screen.",
    ];
  }
  if (typeof window !== "undefined") {
    const ua = window.navigator.userAgent ?? "";
    if (/Android.*Chrome/i.test(ua)) {
      return [
        "Tap the three-dot menu at the top right of Chrome.",
        "Tap “Install app” (or “Add to Home screen”).",
        "Confirm to install. Tournamental launches from your home screen with no browser chrome.",
      ];
    }
    if (/Edg\//i.test(ua)) {
      return [
        "Click the three-dot menu at the top right of Edge.",
        "Choose Apps → Install Tournamental.",
        "Confirm. Tournamental opens in its own window.",
      ];
    }
    if (/Chrome/i.test(ua) && !/Mobile/i.test(ua)) {
      return [
        "Click the install icon in the address bar (small box with a downward arrow), or open the three-dot menu and choose Cast, save, and share → Install Tournamental.",
        "Confirm. Tournamental opens in its own window.",
      ];
    }
  }
  return [
    "Open your browser’s main menu (usually three dots or a hamburger icon).",
    "Look for “Install app”, “Add to Home Screen”, or “Install Tournamental”.",
    "Confirm. Tournamental launches as a standalone app.",
  ];
}

export function InstallPrompt() {
  const [state, setState] = useState<InstallState>({ kind: "hidden" });
  const [showSteps, setShowSteps] = useState(false);

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
        if (choice.outcome === "accepted") {
          dismiss();
          return;
        }
        // outcome === "dismissed": Chrome will refuse to fire the
        // same prompt event again, so fall through to the instructions
        // hint instead of silently re-dismissing. The user clicked
        // Install for a reason; give them a path that still works.
        setShowSteps(true);
      } catch {
        // event.prompt() can throw if the saved event has been
        // consumed already (the browser only lets prompt() fire once
        // per engagement). Show instructions in that case too.
        setShowSteps(true);
      }
      return;
    }
    // iOS + generic paths: no programmatic install API; expand to
    // show browser-specific instructions instead of dismissing the
    // affordance (Tim 2026-05-23 — clicking Install used to close
    // the drawer without anything happening).
    setShowSteps((v) => !v);
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

  const steps = showSteps ? instructionSteps(state) : null;

  return (
    <div
      className="vt-drawer-install"
      data-expanded={showSteps ? "1" : undefined}
    >
      <button
        type="button"
        className="vt-drawer-install-cta"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-expanded={showSteps}
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
      {steps && (
        <ol className="vt-drawer-install-steps" aria-live="polite">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
