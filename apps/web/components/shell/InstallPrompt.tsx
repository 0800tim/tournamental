"use client";

/**
 * "Install VTourn" toast — appears once per device when the browser
 * fires `beforeinstallprompt`. Stores its dismissal in localStorage so
 * the toast doesn't reappear on every visit.
 *
 * On iOS Safari, where `beforeinstallprompt` is not implemented, this
 * component falls back to a hint about the share-sheet "Add to Home
 * Screen" affordance. The hint is shown once per device.
 */

import { useEffect, useState } from "react";

const DISMISS_KEY = "vt-install-dismissed-v1";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const dismissed = window.localStorage?.getItem(DISMISS_KEY);
    if (dismissed) return undefined;

    // Already installed in standalone mode? Don't prompt.
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari specific
      window.navigator.standalone === true;
    if (isStandalone) return undefined;

    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS fallback: show the hint after a short delay if no
    // beforeinstallprompt fires (it never will on iOS Safari).
    const ua = window.navigator.userAgent ?? "";
    const isIos = /iPad|iPhone|iPod/i.test(ua) && !/CriOS|FxiOS/i.test(ua);
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIos) {
      iosTimer = setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, 4000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    if (typeof window !== "undefined") {
      try {
        window.localStorage?.setItem(DISMISS_KEY, "1");
      } catch {
        // ignore storage failures (quota, private mode)
      }
    }
  };

  const install = async () => {
    if (!event) return;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome) dismiss();
    } catch {
      dismiss();
    }
  };

  return (
    <div className="vt-install-toast" role="dialog" aria-label="Install VTourn">
      <div className="vt-install-mark" aria-hidden="true">
        V
      </div>
      <div className="vt-install-body">
        <p className="vt-install-title">Install VTourn</p>
        <p className="vt-install-sub">
          {iosHint
            ? "Tap share, then \"Add to Home Screen\" for the app experience."
            : "Get the app experience on your home screen."}
        </p>
      </div>
      {!iosHint && event ? (
        <button type="button" className="vt-install-cta" onClick={install}>
          Install
        </button>
      ) : null}
      <button
        type="button"
        className="vt-install-dismiss"
        aria-label="Dismiss install prompt"
        onClick={dismiss}
      >
        x
      </button>
    </div>
  );
}
