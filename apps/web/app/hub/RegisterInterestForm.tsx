"use client";

/**
 * Register-interest form for the upcoming tournament (hub page).
 *
 * Posts to /api/v1/register-interest. On success it swaps to a
 * thank-you state with the person's personal invite link and share
 * buttons: the seed of the referral loop in the RWC 2027 growth plan
 * (docs/briefs/rwc2027-growth-plan.md). The only number shown is the
 * person's own referral count.
 *
 * A `?ref=<code>` in the URL (set by /i/<code>) is carried through as
 * the referrer. Stored in sessionStorage so it survives a reload.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";

export interface RegisterInterestFormProps {
  readonly tournamentName: string;
  readonly defaultCountry: string | null;
  readonly inviteBase: string;
}

type Phase = "idle" | "busy" | "done" | "error";

const REF_KEY = "tnm_ref";

function readRef(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("ref");
    if (fromUrl && /^[a-z0-9]{4,16}$/.test(fromUrl)) {
      sessionStorage.setItem(REF_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function RegisterInterestForm({
  tournamentName,
  defaultCountry,
  inviteBase,
}: RegisterInterestFormProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; url: string; referrals: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorField, setErrorField] = useState<"email" | "phone" | "consent" | null>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setRef(readRef());
  }, []);

  // The form is replaced by the thank-you state on success. Move focus
  // to its heading so keyboard and screen-reader users are not left on
  // a button that no longer exists.
  useEffect(() => {
    if (phase === "done") doneHeadingRef.current?.focus();
  }, [phase]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase === "busy") return;
    setPhase("busy");
    setError(null);
    setErrorField(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      email: String(fd.get("email") ?? ""),
      first_name: String(fd.get("first_name") ?? ""),
      country: String(fd.get("country") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      consent: fd.get("consent") === "on",
      website: String(fd.get("website") ?? ""),
      ref: ref ?? "",
      source_path: window.location.pathname,
    };
    try {
      const res = await fetch("/api/v1/register-interest", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        invite_code?: string;
        invite_url?: string;
        referrals?: number;
      };
      if (!res.ok || !body.ok) {
        setError(messageFor(body.error));
        setErrorField(fieldFor(body.error));
        setPhase("error");
        return;
      }
      setInvite({
        code: body.invite_code ?? "",
        url: body.invite_url ?? `${inviteBase}/i/${body.invite_code ?? ""}`,
        referrals: body.referrals ?? 0,
      });
      setPhase("done");
    } catch {
      setError("Could not reach the server. Please try again.");
      setPhase("error");
    }
  }

  async function copyLink() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link is visible as text anyway */
    }
  }

  async function nativeShare() {
    if (!invite) return;
    const text = `I'm in for ${tournamentName} on Tournamental. Register with my link and we'll be in the same pool when picks open:`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: "Tournamental", text, url: invite.url });
        return;
      } catch {
        /* user cancelled */
      }
    }
    await copyLink();
  }

  if (phase === "done" && invite) {
    const text = encodeURIComponent(
      `I'm in for ${tournamentName} on Tournamental. Register with my link and we'll be in the same pool when picks open: ${invite.url}`,
    );
    return (
      <div className="vt-hub-form vt-hub-form-done" role="status" aria-live="polite">
        <p className="vt-hub-form-eyebrow">You are on the list</p>
        <h3 className="vt-hub-form-title" ref={doneHeadingRef} tabIndex={-1}>Now bring your crew.</h3>
        <p className="vt-hub-form-p">
          This is your personal invite link. Everyone who registers through it is
          placed with you when pools open, and your invites count toward the
          launch prize draw (terms to come).
        </p>
        <div className="vt-hub-invite">
          <code className="vt-hub-invite-url">{invite.url}</code>
          <button type="button" className="vt-hub-btn vt-hub-btn-ghost" onClick={copyLink} aria-label="Copy your invite link">
            {copied ? "Copied" : "Copy"}
          </button>
          <span className="vt-sr-only" aria-live="polite">{copied ? "Invite link copied" : ""}</span>
        </div>
        <div className="vt-hub-share-row">
          <a
            className="vt-hub-btn vt-hub-btn-primary"
            href={`https://wa.me/?text=${text}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Share on WhatsApp<span className="vt-sr-only"> (opens in a new tab)</span>
          </a>
          <a
            className="vt-hub-btn vt-hub-btn-ghost"
            href={`https://t.me/share/url?url=${encodeURIComponent(invite.url)}&text=${encodeURIComponent(`I'm in for ${tournamentName} on Tournamental. Register with my link and we'll be in the same pool when picks open.`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Telegram<span className="vt-sr-only"> (opens in a new tab)</span>
          </a>
          <button type="button" className="vt-hub-btn vt-hub-btn-ghost" onClick={nativeShare} aria-label="More ways to share your invite link">
            More
          </button>
        </div>
        <p className="vt-hub-form-note">
          Friends joined through your link so far: <strong>{invite.referrals}</strong>
        </p>
      </div>
    );
  }

  return (
    <form className="vt-hub-form" onSubmit={onSubmit} noValidate>
      <p className="vt-hub-form-eyebrow">Register interest</p>
      <h3 className="vt-hub-form-title">Be first in when picks open.</h3>
      {ref ? (
        <p className="vt-hub-form-note">You were invited by a friend. You will land in their pool.</p>
      ) : null}
      <div className="vt-hub-field-row">
        <label className="vt-hub-field">
          <span>First name</span>
          <input name="first_name" type="text" autoComplete="given-name" maxLength={80} />
        </label>
        <label className="vt-hub-field">
          <span>Country</span>
          <input
            name="country"
            type="text"
            autoComplete="country"
            maxLength={2}
            defaultValue={defaultCountry ?? ""}
            placeholder="NZ"
            aria-describedby="ri-country-hint"
            style={{ textTransform: "uppercase" }}
          />
        </label>
        <span id="ri-country-hint" className="vt-sr-only">Two-letter country code, for example NZ</span>
      </div>
      <label className="vt-hub-field">
        <span>Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-required="true"
          maxLength={200}
          inputMode="email"
          aria-invalid={errorField === "email" ? "true" : undefined}
          aria-describedby={errorField === "email" ? "ri-error" : undefined}
        />
      </label>
      <label className="vt-hub-field">
        <span>Mobile (optional, for match-day picks by text)</span>
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={32}
          inputMode="tel"
          placeholder="+64 21 ..."
          aria-invalid={errorField === "phone" ? "true" : undefined}
          aria-describedby={errorField === "phone" ? "ri-error" : undefined}
        />
      </label>
      {/* Honeypot: hidden from people, filled by bots. */}
      <div className="vt-hub-hp" aria-hidden="true">
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="vt-hub-consent">
        <input
          name="consent"
          type="checkbox"
          required
          aria-required="true"
          aria-invalid={errorField === "consent" ? "true" : undefined}
          aria-describedby={errorField === "consent" ? "ri-error" : undefined}
        />
        <span>
          Email me when {tournamentName} picks open, plus pool and prize news. Unsubscribe any time.
        </span>
      </label>
      {error ? <p id="ri-error" className="vt-hub-form-error" role="alert">{error}</p> : null}
      <button
        type="submit"
        className="vt-hub-btn vt-hub-btn-primary vt-hub-btn-block"
        disabled={phase === "busy"}
        aria-busy={phase === "busy" ? "true" : undefined}
      >
        {phase === "busy" ? "Registering…" : "Register my interest"}
      </button>
      <p className="vt-hub-form-note">
        Free to play. No spam. We store your details with Growth Spurt Ltd (Auckland) and our CRM,
        see the <a href="https://tournamental.com/legal/privacy">privacy policy</a>.
      </p>
    </form>
  );
}

/** Which input an API error code belongs to, for aria-invalid and aria-describedby. */
export function fieldFor(code: string | undefined): "email" | "phone" | "consent" | null {
  switch (code) {
    case "email_invalid":
      return "email";
    case "phone_invalid":
      return "phone";
    case "consent_required":
      return "consent";
    default:
      return null;
  }
}

function messageFor(code: string | undefined): string {
  switch (code) {
    case "email_invalid":
      return "That email does not look right.";
    case "phone_invalid":
      return "That mobile number does not look right. Include the country code, or leave it blank.";
    case "consent_required":
      return "Tick the box so we can email you when picks open.";
    case "rate_limited":
      return "Too many attempts from this connection. Try again in a few minutes.";
    case "no_upcoming_tournament":
      return "Registrations are closed for now.";
    default:
      return "Something went wrong. Please try again.";
  }
}
