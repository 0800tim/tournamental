"use client";

/**
 * Telegram Login Widget mount.
 *
 * The widget loads `telegram-widget.js` which renders a button keyed to
 * `data-telegram-login`. On success it calls our global callback, which
 * POSTs the payload to `/v1/auth/telegram/callback` for verification.
 *
 * Bot username comes from `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` and MUST
 * match the bot whose token apps/auth-sms uses to verify the payload.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const AUTH_API_BASE =
  process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:3330";
const TG_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "VTournBot";
const STORAGE_KEY = "vtourn_jwt";

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
    onVtournTelegramAuth?: (payload: TelegramAuthPayload) => void;
  }
}

export default function TelegramLogin(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/world-cup-2026";
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    window.onVtournTelegramAuth = async (payload: TelegramAuthPayload) => {
      setStatus("Verifying…");
      try {
        const res = await fetch(`${AUTH_API_BASE}/v1/auth/telegram/callback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.jwt) {
          throw new Error(body?.error ?? "verify-failed");
        }
        try {
          window.localStorage.setItem(STORAGE_KEY, body.jwt);
        } catch {
          /* storage disabled — proceed anyway */
        }
        setStatus(null);
        router.push(next);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Couldn't sign in with Telegram.";
        setStatus(`Telegram sign-in failed (${msg}). Try the phone option.`);
      }
    };

    // Inject the widget script. We do this once per mount; React strict
    // mode in dev will double-invoke this effect, but Telegram's script
    // is idempotent on mount-unmount because we clear the container on
    // cleanup.
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", TG_BOT_USERNAME);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "8");
    s.setAttribute("data-userpic", "true");
    s.setAttribute("data-request-access", "write");
    s.setAttribute("data-onauth", "onVtournTelegramAuth(user)");
    mount.appendChild(s);

    return () => {
      // Clear the rendered iframe + script so re-mounts don't pile up.
      while (mount.firstChild) mount.removeChild(mount.firstChild);
      try {
        delete window.onVtournTelegramAuth;
      } catch {
        window.onVtournTelegramAuth = undefined;
      }
    };
  }, [next, router]);

  return (
    <div className="auth-telegram">
      <div ref={mountRef} className="auth-telegram-mount" />
      {status && (
        <p className="auth-info" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
