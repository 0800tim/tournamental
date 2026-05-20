"use client";

/**
 * "Link Telegram" button for the profile page.
 *
 * Renders a Telegram Login Widget. On successful widget auth, POSTs
 * the payload (plus the user's existing session cookie) to
 * auth-sms /v1/auth/telegram/link, which merges the telegram identity
 * onto the signed-in user. Used so a phone-authed user can add their
 * Telegram identity without creating a duplicate account.
 *
 * Bot username comes from NEXT_PUBLIC_TELEGRAM_BOT_USERNAME and must
 * match the bot whose token apps/auth-sms uses to verify the payload.
 */

import { useEffect, useRef, useState } from "react";

import { AUTH_BASE } from "@/lib/auth/inbound-login";

const TG_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "TournamentalBot";

interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    __vtornLinkTelegramAuth?: (payload: TelegramAuthPayload) => void;
  }
}

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; username: string | null }
  | { kind: "err"; message: string };

export function LinkTelegramButton({ onLinked }: { onLinked?: () => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    window.__vtornLinkTelegramAuth = async (payload) => {
      setStatus({ kind: "busy" });
      try {
        const res = await fetch(AUTH_BASE.replace(/\/$/, "") + "/v1/auth/telegram/link", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({})) as {
          ok?: boolean;
          error?: string;
          user?: { telegramUsername?: string | null };
        };
        if (!res.ok || !body.ok) {
          const message =
            body.error === "telegram-on-other-user"
              ? "This Telegram account is already linked to a different Tournamental user. Sign in to that account to merge."
              : body.error === "unauthorized"
              ? "Your session expired. Sign in again, then retry."
              : body.error === "bad-hash"
              ? "Telegram could not verify the login. Try again."
              : "Couldn't link Telegram. Try again.";
          setStatus({ kind: "err", message });
          return;
        }
        setStatus({ kind: "ok", username: body.user?.telegramUsername ?? null });
        onLinked?.();
      } catch {
        setStatus({ kind: "err", message: "Network error. Try again." });
      }
    };

    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", TG_BOT_USERNAME);
    s.setAttribute("data-size", "medium");
    s.setAttribute("data-radius", "8");
    s.setAttribute("data-userpic", "false");
    s.setAttribute("data-request-access", "write");
    s.setAttribute("data-onauth", "__vtornLinkTelegramAuth(user)");
    mount.appendChild(s);

    return () => {
      while (mount.firstChild) mount.removeChild(mount.firstChild);
      try {
        delete window.__vtornLinkTelegramAuth;
      } catch {
        window.__vtornLinkTelegramAuth = undefined;
      }
    };
  }, [onLinked]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div ref={mountRef} />
      {status.kind === "busy" && (
        <p style={{ fontSize: 13, color: "var(--vt-fg-muted, #aaa)", margin: 0 }}>
          Linking…
        </p>
      )}
      {status.kind === "ok" && (
        <p style={{ fontSize: 13, color: "#4ade80", margin: 0 }}>
          ✓ Linked Telegram{status.username ? ` (@${status.username})` : ""}.
        </p>
      )}
      {status.kind === "err" && (
        <p style={{ fontSize: 13, color: "#f87171", margin: 0 }}>{status.message}</p>
      )}
    </div>
  );
}
