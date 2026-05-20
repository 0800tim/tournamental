"use client";

/**
 * Sign-in popup window used by the embed widget.
 *
 * The widget (running on a partner site) opens this URL in a
 * 520×720 popup when a logged-out user clicks "Log in to play".
 * The user signs in here via the standard SignupModal (WhatsApp,
 * Telegram, SMS, Email). On success we postMessage back to the
 * opener (the widget) and auto-close. The widget then refreshes
 * its auth state and switches the "Play" tab from CTA to bracket
 * iframe — all without disrupting the player's flow on the
 * partner site.
 *
 * Auth cookies are apex-domain (.tournamental.com), so the iframe
 * to /world-cup-2026?embed=1 inherits the session automatically
 * once it's set.
 */

import { useEffect, useState } from "react";

import { SignupModal } from "@/components/auth/SignupModal";
import { useUser } from "@/lib/auth/useUser";

interface AuthPopupClientProps {
  pool: string | null;
  from: string | null;
}

export function AuthPopupClient({ pool, from }: AuthPopupClientProps) {
  const auth = useUser();
  const [closing, setClosing] = useState(false);

  // When the user becomes authenticated, postMessage the opener
  // and close. Use a short delay so they see "Signed in!" before
  // the window vanishes.
  useEffect(() => {
    if (auth.status !== "authenticated" || closing) return;
    setClosing(true);
    try {
      if (window.opener) {
        window.opener.postMessage(
          { type: "tournamental-auth", ok: true, pool },
          "*",
        );
      }
    } catch {
      /* ignore — cross-origin opener might not be reachable */
    }
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        /* user can close manually */
      }
    }, 900);
  }, [auth.status, closing, pool]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0e1a",
        color: "#fff",
        padding: 20,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
      }}
    >
      {auth.status === "authenticated" ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 12 }}>✓</div>
          <p style={{ margin: 0, fontWeight: 600 }}>
            You&apos;re signed in.
          </p>
          <p style={{ margin: "6px 0 0", color: "#9aa6c2", fontSize: 13 }}>
            Returning you to the game…
          </p>
        </div>
      ) : (
        <>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#fbbf24",
              margin: 0,
              fontWeight: 600,
            }}
          >
            Sign in to play
          </p>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              margin: "8px 0 16px",
              textAlign: "center",
            }}
          >
            One tap and you&apos;re in
          </h1>
          <p
            style={{
              color: "#cdd5e7",
              maxWidth: 360,
              textAlign: "center",
              margin: "0 0 20px",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {pool
              ? `Pick how you'd like to sign in to join "${pool}".`
              : "Pick a sign-in method to start predicting."}
          </p>
          {/* Always-open modal — the user can't dismiss the popup
              into an empty page; close via the OS window controls. */}
          <SignupModal open={true} onClose={() => { /* no-op in popup */ }} />
          <p
            style={{
              color: "#6b7283",
              fontSize: 11,
              marginTop: 24,
            }}
          >
            {from === "embed" ? "Embed sign-in" : "Tournamental"} ·{" "}
            <a
              href="https://tournamental.com/legal/terms"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#9aa6c2" }}
            >
              Terms
            </a>
          </p>
        </>
      )}
    </main>
  );
}
