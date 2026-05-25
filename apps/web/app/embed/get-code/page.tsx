"use client";

/**
 * /embed/get-code  - the "Get my code" popup launched by the embed widget.
 *
 * Lives on play.tournamental.com (first-party), so it can talk to auth-sms
 * freely. It does NOT sign the user in here; it only helps them *request* a
 * one-time code, which they then type back into the widget on the partner
 * page (the widget verifies via /api/v1/auth/widget-otp).
 *
 * Two ways to get a code:
 *   1. WhatsApp (primary): a wa.me deep-link pre-filling the bare keyword
 *      `login` (the inbound gateway does not parse a pool-slug suffix). The
 *      user messages the bot and gets a 6-digit code. Nothing is posted
 *      back -- the widget verifies the bare code via verify-by-code, and it
 *      already knows which pool to join.
 *   2. Email (option): we send a code and postMessage the address back to
 *      the opener so the widget knows to verify the email OTP.
 *
 * On a successful email request we postMessage
 *   { type: "tournamental-otp-requested", channel, identifier }
 * to window.opener (targeted at the partner origin passed in `?origin=`).
 */

import { useEffect, useMemo, useState } from "react";

import { whatsAppLoginDeepLink } from "@/lib/auth/inbound-login";

const SLUG_RE = /^[a-z0-9-]{1,64}$/i;

function useQuery() {
  const [q, setQ] = useState<{ pool: string | null; origin: string | null; theme: string }>(
    { pool: null, origin: null, theme: "dark" },
  );
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const pool = p.get("pool");
    setQ({
      pool: pool && SLUG_RE.test(pool) ? pool.toLowerCase() : null,
      origin: p.get("origin"),
      theme: p.get("theme") === "light" ? "light" : "dark",
    });
  }, []);
  return q;
}

export default function GetCodePage(): JSX.Element {
  const { pool, origin } = useQuery();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [sent, setSent] = useState(false);

  // Plain "login" only. The inbound gateway matches the bare keyword and
  // does NOT parse a "login pool=<slug>" suffix -- sending that gets no
  // reply (Tim 2026-05-25). We don't need the slug here anyway: the user
  // pastes the code back into the embed, which already knows its pool and
  // verifies + joins there. `pool` is still used for the on-screen copy.
  const waLink = useMemo(() => whatsAppLoginDeepLink(), []);

  // Tell the opener (the widget) which address the code went to so it can
  // verify the email OTP. Targeted at the partner origin when we trust it.
  function postToOpener(channel: string, identifier: string | null): void {
    if (!window.opener) return;
    const target = origin && /^https?:\/\//.test(origin) ? origin : "*";
    try {
      window.opener.postMessage(
        { type: "tournamental-otp-requested", channel, identifier },
        target,
      );
    } catch {
      /* opener gone; ignore */
    }
  }

  async function requestEmail(): Promise<void> {
    const addr = email.trim();
    if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
      setNote({ kind: "err", text: "Enter a valid email address." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/v1/auth/widget-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", channel: "email", email: addr }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) {
        postToOpener("email", addr);
        setSent(true);
        setNote({ kind: "ok", text: `Code sent to ${addr}. Enter it on the page to finish.` });
      } else {
        setNote({
          kind: "err",
          text:
            j.error === "cooldown" || res.status === 429
              ? "Too many requests. Wait a minute and try again."
              : "We could not send a code right now. Try WhatsApp instead.",
        });
      }
    } catch {
      setNote({ kind: "err", text: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={S.main}>
      <div style={S.card}>
        <p style={S.eyebrow}>Tournamental</p>
        <h1 style={S.h1}>Get your sign-in code</h1>
        <p style={S.sub}>
          Request a one-time code, then type it into the widget on the page to
          {pool ? " join the pool" : " sign in"}. No password needed.
        </p>

        {/* WhatsApp (primary) */}
        <a href={waLink} target="_blank" rel="noopener noreferrer" style={S.waBtn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.207zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
          </svg>
          Get a code on WhatsApp
        </a>
        <p style={S.waHint}>
          Opens WhatsApp and pre-fills a message. Send it, and we reply with a
          6-digit code.
        </p>

        <div style={S.divider}><span style={S.dividerText}>or by email</span></div>

        {/* Email (option) */}
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void requestEmail();
          }}
          style={S.input}
          aria-label="Email"
        />
        <button
          type="button"
          onClick={() => void requestEmail()}
          disabled={busy}
          style={{ ...S.emailBtn, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Sending…" : "Email me a code"}
        </button>

        {note && (
          <p style={{ ...S.note, ...(note.kind === "err" ? S.noteErr : S.noteOk) }}>
            {note.text}
          </p>
        )}

        {sent && (
          <button type="button" onClick={() => window.close()} style={S.closeBtn}>
            Close and enter your code
          </button>
        )}
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    margin: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0e0e12",
    padding: 20,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  },
  card: {
    width: "100%",
    maxWidth: 360,
    background: "#17171d",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: 24,
    color: "#e7ecf7",
    textAlign: "center",
  },
  eyebrow: {
    margin: 0,
    fontSize: 11,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "#fbbf24",
    fontWeight: 700,
  },
  h1: { margin: "8px 0 6px", fontSize: 22, fontWeight: 800, color: "#fff" },
  sub: { margin: "0 0 18px", fontSize: 13.5, lineHeight: 1.5, color: "#a3acc2" },
  waBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 18px",
    borderRadius: 12,
    background: "#25d366",
    color: "#0b3d1f",
    fontSize: 15,
    fontWeight: 700,
    textDecoration: "none",
  },
  waHint: { margin: "8px 0 0", fontSize: 12, color: "#8b93a7" },
  divider: {
    display: "flex",
    alignItems: "center",
    margin: "20px 0 14px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    position: "relative",
  },
  dividerText: {
    position: "absolute",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: "#17171d",
    padding: "0 10px",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#8b93a7",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#101015",
    color: "#fff",
    fontSize: 15,
    marginBottom: 10,
  },
  emailBtn: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(180deg, #ffe9a8 0%, #fcd34d 42%, #f59e0b 100%)",
    color: "#15151a",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  },
  note: { margin: "14px 0 0", fontSize: 13, lineHeight: 1.45, borderRadius: 8, padding: "10px 12px" },
  noteOk: { background: "rgba(37,211,102,0.12)", color: "#bff5d2" },
  noteErr: { background: "rgba(214,59,59,0.12)", color: "#f3b4b4" },
  closeBtn: {
    marginTop: 14,
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 16px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "transparent",
    color: "#e7ecf7",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
};
