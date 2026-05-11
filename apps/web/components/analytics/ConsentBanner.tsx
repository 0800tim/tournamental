"use client";

/**
 * First-visit consent banner.
 *
 * Renders at the bottom of the viewport when no consent decision has
 * been persisted in localStorage under `tournamental.consent.v1`. Two
 * options:
 *
 *  - "Accept" — grants all four GA4 consent flags (analytics + ads).
 *  - "Only essential" — keeps analytics on, denies the ad_* flags.
 *
 * The choice persists; subsequent visits skip the banner. A v2 may
 * region-gate the prompt on `CF-IPCountry` to skip it in jurisdictions
 * that don't require it, but for v1 we show globally — better safe
 * than sorry.
 *
 * Visual: bottom-pinned bar, theme-aware via existing `vt-*`
 * variables. The buttons share the standard `vt-btn` styles so the
 * banner inherits the site theme without bespoke CSS.
 */

import { useEffect, useState } from "react";

import { setConsent } from "@/lib/analytics";

const CONSENT_KEY = "tournamental.consent.v1";

type Decision = "accept-all" | "essential-only";

interface PersistedDecision {
  readonly decision: Decision;
  readonly at: string; // ISO 8601
}

function loadDecision(): PersistedDecision | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDecision;
    if (parsed && (parsed.decision === "accept-all" || parsed.decision === "essential-only")) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveDecision(decision: Decision): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ decision, at: new Date().toISOString() } satisfies PersistedDecision),
    );
  } catch {
    // localStorage can throw in private-mode Safari — silently drop.
  }
}

function applyDecision(decision: Decision): void {
  if (decision === "accept-all") {
    setConsent({
      analytics_storage: "granted",
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    });
  } else {
    setConsent({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  }
}

export function ConsentBanner() {
  // Tri-state: undefined = not yet read (SSR + first render), true =
  // visible, false = decision already exists / dismissed.
  const [visible, setVisible] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const prior = loadDecision();
    if (prior) {
      // Re-apply on every visit so GTM's current dataLayer is in sync.
      applyDecision(prior.decision);
      setVisible(false);
      return;
    }
    setVisible(true);
  }, []);

  if (!visible) return null;

  const accept = () => {
    saveDecision("accept-all");
    applyDecision("accept-all");
    setVisible(false);
  };
  const essential = () => {
    saveDecision("essential-only");
    applyDecision("essential-only");
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-labelledby="vt-consent-title"
      data-testid="vt-consent-banner"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9000,
        padding: "16px",
        background: "rgba(10, 14, 26, 0.92)",
        color: "#f5f7fc",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        boxShadow: "0 -8px 24px rgba(0,0,0,0.32)",
      }}
    >
      <p
        id="vt-consent-title"
        style={{ margin: 0, fontSize: "0.95rem", lineHeight: 1.4 }}
      >
        <strong>We use cookies for analytics.</strong> Accept all to help us
        measure marketing channels too. You can change this any time in
        Settings.
      </p>
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          onClick={essential}
          data-testid="vt-consent-essential"
          style={{
            padding: "10px 16px",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "8px",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Only essential
        </button>
        <button
          type="button"
          onClick={accept}
          data-testid="vt-consent-accept"
          style={{
            padding: "10px 16px",
            border: "1px solid transparent",
            borderRadius: "8px",
            background: "#3b82f6",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
