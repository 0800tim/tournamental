"use client";

/**
 * Syndicate signup form.
 *
 * One-page client component. Renders the input form on first paint
 * and the success card after a 200 from POST /api/v1/syndicates.
 * Anonymous visitors can submit, `useUser()` is consulted to pre-
 * fill email + phone if a Supabase session exists, but the form does
 * NOT gate on a session.
 *
 * The slug field auto-derives from the syndicate name as the user
 * types (unless they've manually edited the slug, we track that
 * with a `slugEdited` flag). A 300ms debounced fetch hits
 * /api/v1/syndicates/<slug>/available to live-check uniqueness.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { deriveSlug, isValidSlugShape } from "@/lib/syndicate/slug";
import { useUser } from "@/lib/auth/useUser";

import "./syndicate-form.css";

interface SuccessPayload {
  syndicate_id: string;
  slug: string;
  share_url: string;
  share_guid: string;
  ghl_status: string;
}

type AvailabilityState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok" }
  | { state: "taken" }
  | { state: "reserved" }
  | { state: "invalid" };

const SIZE_BANDS = [
  { value: "2-10", label: "2-10 friends" },
  { value: "11-30", label: "11-30 people" },
  { value: "31-100", label: "31-100 people" },
  { value: "100-plus", label: "100+ (a crowd)" },
] as const;

/**
 * Country dial codes, small, deliberately curated list covering
 * Tournamental's launch markets (NZ, AU, GB, US, IE, ZA, IN, BR) plus
 * a few EU. A bigger picker can ship post-launch.
 */
const COUNTRY_CODES = [
  { iso: "NZ", dial: "+64", name: "New Zealand" },
  { iso: "AU", dial: "+61", name: "Australia" },
  { iso: "GB", dial: "+44", name: "United Kingdom" },
  { iso: "US", dial: "+1", name: "United States" },
  { iso: "IE", dial: "+353", name: "Ireland" },
  { iso: "ZA", dial: "+27", name: "South Africa" },
  { iso: "IN", dial: "+91", name: "India" },
  { iso: "BR", dial: "+55", name: "Brazil" },
  { iso: "DE", dial: "+49", name: "Germany" },
  { iso: "FR", dial: "+33", name: "France" },
] as const;

type FieldErrors = Partial<{
  name: string;
  slug: string;
  size_band: string;
  owner_email: string;
  owner_phone: string;
  topic: string;
  terms: string;
}>;

export function SyndicateForm(): JSX.Element {
  const auth = useUser();
  const prefillEmail = auth.user?.email ?? "";
  const prefillPhone = auth.user?.phone ?? "";

  // Form state.
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [tournamentId] = useState<"fifa-wc-2026">("fifa-wc-2026");
  const [sizeBand, setSizeBand] = useState<string>("2-10");
  const [email, setEmail] = useState(prefillEmail);
  const [dialCode, setDialCode] = useState<string>("+64");
  const [phoneLocal, setPhoneLocal] = useState<string>("");
  const [topic, setTopic] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [availability, setAvailability] = useState<AvailabilityState>({ state: "idle" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessPayload | null>(null);

  // When the user signs in mid-session, sync prefills.
  useEffect(() => {
    if (prefillEmail && !email) setEmail(prefillEmail);
    if (prefillPhone && !phoneLocal) {
      // If the user's stored phone is E.164 we split off the dial code
      // by matching against our curated list. Otherwise just dump it.
      const match = COUNTRY_CODES.find((c) => prefillPhone.startsWith(c.dial));
      if (match) {
        setDialCode(match.dial);
        setPhoneLocal(prefillPhone.slice(match.dial.length));
      } else {
        setPhoneLocal(prefillPhone);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillEmail, prefillPhone]);

  // Auto-derive slug from the name unless the user has touched it.
  const onNameChange = useCallback(
    (next: string) => {
      setName(next);
      if (!slugEdited) {
        setSlug(deriveSlug(next));
      }
    },
    [slugEdited],
  );

  // Debounced availability check.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!slug) {
      setAvailability({ state: "idle" });
      return;
    }
    if (!isValidSlugShape(slug)) {
      setAvailability({ state: "invalid" });
      return;
    }
    setAvailability({ state: "checking" });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/available`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setAvailability({ state: "idle" });
          return;
        }
        const body = (await res.json()) as { available: boolean; reason: string };
        if (body.available) setAvailability({ state: "ok" });
        else if (body.reason === "taken") setAvailability({ state: "taken" });
        else if (body.reason === "reserved") setAvailability({ state: "reserved" });
        else setAvailability({ state: "invalid" });
      } catch {
        // Soft-fail: leave state idle, server is source of truth on POST.
        setAvailability({ state: "idle" });
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [slug]);

  const phoneE164 = useMemo(() => {
    const digits = phoneLocal.replace(/\D+/g, "");
    if (!digits) return "";
    // If user typed leading 0 (common in many countries), drop it.
    const trimmed = digits.replace(/^0+/, "");
    return `${dialCode}${trimmed}`;
  }, [dialCode, phoneLocal]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const errors: FieldErrors = {};
    if (name.trim().length < 3) errors.name = "Name must be at least 3 characters.";
    if (!isValidSlugShape(slug)) errors.slug = "Slug must be kebab-case (a-z, 0-9, single hyphens), 3-40 chars.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.owner_email = "Enter a valid email address.";
    if (!/^\+[1-9]\d{7,14}$/.test(phoneE164)) errors.owner_phone = "Enter a valid phone number.";
    if (topic && topic.length > 280) errors.topic = "Keep the description under 280 characters.";
    if (!termsAccepted) errors.terms = "You must agree to the terms to continue.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/syndicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          tournament_id: tournamentId,
          size_band: sizeBand,
          owner_email: email.trim().toLowerCase(),
          owner_phone: phoneE164,
          owner_handle: auth.profile?.handle ?? null,
          topic: topic.trim() || null,
          marketing_consent: marketingConsent,
          terms_accepted: termsAccepted,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const reason = (body as { reason?: string }).reason;
        if (reason === "reserved") {
          setFieldErrors({ slug: "That name is reserved. Try another." });
        } else if (reason === "taken") {
          setFieldErrors({ slug: "That syndicate name is already taken." });
        } else {
          setSubmitError("That syndicate name isn't available. Try another.");
        }
        return;
      }
      if (!res.ok) {
        const issues = (body as { issues?: { path: string; message: string }[] }).issues ?? [];
        if (issues.length > 0) {
          const nextErrors: FieldErrors = {};
          for (const i of issues) {
            const key = i.path as keyof FieldErrors;
            nextErrors[key] = i.message;
          }
          setFieldErrors(nextErrors);
        } else {
          setSubmitError("Couldn't create the syndicate. Please try again.");
        }
        return;
      }
      setSuccess(body as SuccessPayload);
    } catch (err) {
      setSubmitError("Network error. Please try again.");
      // eslint-disable-next-line no-console
      console.error("syndicate submit failed", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return <SuccessCard payload={success} />;
  }

  const canSubmit =
    !submitting &&
    name.trim().length >= 3 &&
    isValidSlugShape(slug) &&
    availability.state !== "taken" &&
    availability.state !== "reserved" &&
    availability.state !== "invalid" &&
    termsAccepted;

  return (
    <div className="syn-page">
      <div className="syn-container">
        <p className="syn-eyebrow">Create a syndicate</p>
        <h1 className="syn-title">Start your prediction pool</h1>
        <p className="syn-sub">
          Pick a name, share the link, and watch your friends fight for bragging
          rights. Free to play, no app to install.
        </p>

        <form className="syn-form" onSubmit={onSubmit} noValidate>
          {/* Name */}
          <div className="syn-field">
            <label className="syn-label syn-required" htmlFor="syn-name">
              Syndicate name
            </label>
            <input
              id="syn-name"
              className={`syn-input ${fieldErrors.name ? "is-error" : ""}`}
              type="text"
              autoComplete="off"
              value={name}
              maxLength={60}
              placeholder="Dave's mates"
              onChange={(e) => onNameChange(e.target.value)}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "syn-name-error" : undefined}
            />
            {fieldErrors.name && (
              <span className="syn-error-text" id="syn-name-error">
                {fieldErrors.name}
              </span>
            )}
            {/* Sample-name suggestion chips */}
            <div className="syn-suggestions" aria-label="Sample names">
              <span className="syn-suggestions-label">Try one:</span>
              {[
                "George FM World Cup",
                "Mt Eden Primary Sweepstake",
                "The Cafe Crew Bracket",
                "Brookfield Bowls Club",
                "Wellington Workplace Pool",
              ].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  className="syn-suggestion-chip"
                  onClick={() => onNameChange(sample)}
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>

          {/* Slug */}
          <div className="syn-field">
            <label className="syn-label syn-required" htmlFor="syn-slug">
              Syndicate URL
            </label>
            <div
              className={`syn-slug-row ${
                fieldErrors.slug ||
                availability.state === "taken" ||
                availability.state === "reserved" ||
                availability.state === "invalid"
                  ? "is-error"
                  : ""
              }`}
            >
              <span className="syn-slug-prefix">play.tournamental.com/s/</span>
              <input
                id="syn-slug"
                className="syn-slug-input"
                type="text"
                autoComplete="off"
                value={slug}
                maxLength={40}
                placeholder="daves-mates"
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase());
                  setSlugEdited(true);
                }}
                aria-invalid={Boolean(fieldErrors.slug)}
                aria-describedby="syn-slug-status"
              />
            </div>
            <span
              id="syn-slug-status"
              className="syn-status"
              data-state={availability.state}
            >
              {fieldErrors.slug
                ? fieldErrors.slug
                : availability.state === "ok"
                ? "Available"
                : availability.state === "taken"
                ? "Already taken"
                : availability.state === "reserved"
                ? "That name is reserved"
                : availability.state === "invalid"
                ? "Use lowercase letters, digits, and single hyphens"
                : availability.state === "checking"
                ? "Checking…"
                : "Lowercase, kebab-case, 3-40 chars"}
            </span>
          </div>

          {/* Tournament */}
          <div className="syn-field">
            <span className="syn-label syn-required">Tournament</span>
            <div className="syn-radio-grid">
              <label className="syn-radio" data-checked="true">
                <input
                  type="radio"
                  name="syn-tournament"
                  value="fifa-wc-2026"
                  checked
                  readOnly
                />
                <span className="syn-radio-label">Football World Cup 2026</span>
              </label>
              <label className="syn-radio" aria-disabled="true">
                <input type="radio" name="syn-tournament" value="future" disabled />
                <span className="syn-radio-label">More coming soon</span>
              </label>
            </div>
          </div>

          {/* Size band */}
          <div className="syn-field">
            <span className="syn-label syn-required">Estimated size</span>
            <div className="syn-radio-grid">
              {SIZE_BANDS.map((band) => (
                <label
                  key={band.value}
                  className="syn-radio"
                  data-checked={sizeBand === band.value}
                >
                  <input
                    type="radio"
                    name="syn-size-band"
                    value={band.value}
                    checked={sizeBand === band.value}
                    onChange={() => setSizeBand(band.value)}
                  />
                  <span className="syn-radio-label">{band.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Email */}
          <div className="syn-field">
            <label className="syn-label syn-required" htmlFor="syn-email">
              Your email
            </label>
            <input
              id="syn-email"
              className={`syn-input ${fieldErrors.owner_email ? "is-error" : ""}`}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              maxLength={200}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors.owner_email)}
            />
            {fieldErrors.owner_email && (
              <span className="syn-error-text">{fieldErrors.owner_email}</span>
            )}
          </div>

          {/* Phone */}
          <div className="syn-field">
            <label className="syn-label syn-required" htmlFor="syn-phone">
              Your phone
            </label>
            <div className="syn-phone-row">
              <select
                className="syn-select"
                value={dialCode}
                onChange={(e) => setDialCode(e.target.value)}
                aria-label="Country dialing code"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.iso} value={c.dial}>
                    {c.iso} {c.dial}
                  </option>
                ))}
              </select>
              <input
                id="syn-phone"
                className={`syn-input ${fieldErrors.owner_phone ? "is-error" : ""}`}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                value={phoneLocal}
                placeholder="21 123 4567"
                onChange={(e) => setPhoneLocal(e.target.value)}
                aria-invalid={Boolean(fieldErrors.owner_phone)}
              />
            </div>
            <span className="syn-hint">We use this for match-day reminders and login OTPs.</span>
            {fieldErrors.owner_phone && (
              <span className="syn-error-text">{fieldErrors.owner_phone}</span>
            )}
          </div>

          {/* Topic */}
          <div className="syn-field">
            <label className="syn-label" htmlFor="syn-topic">
              Topic / description <span className="syn-hint">(optional)</span>
            </label>
            <textarea
              id="syn-topic"
              className={`syn-textarea ${fieldErrors.topic ? "is-error" : ""}`}
              value={topic}
              maxLength={280}
              placeholder="The office WC pool, winner brings cake."
              onChange={(e) => setTopic(e.target.value)}
            />
            {fieldErrors.topic && (
              <span className="syn-error-text">{fieldErrors.topic}</span>
            )}
          </div>

          {/* Consent */}
          <label className="syn-checkbox-row">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
            />
            <span>It&apos;s OK to email me launch news + match-day nudges.</span>
          </label>

          <label className="syn-checkbox-row">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              aria-invalid={Boolean(fieldErrors.terms)}
            />
            <span>
              I agree to the <a href="/terms">Tournamental terms</a>.
            </span>
          </label>
          {fieldErrors.terms && <span className="syn-error-text">{fieldErrors.terms}</span>}

          {submitError && <div className="syn-form-error">{submitError}</div>}

          <button type="submit" className="syn-submit" disabled={!canSubmit}>
            {submitting ? "Creating…" : "Create my syndicate · free"}
          </button>
          <ul className="syn-reassure">
            <li><span aria-hidden="true">✓</span> No credit card required</li>
            <li><span aria-hidden="true">✓</span> Free forever on this tier</li>
            <li><span aria-hidden="true">✓</span> Embed on any site you own</li>
          </ul>
        </form>
      </div>
    </div>
  );
}

function SuccessCard({ payload }: { payload: SuccessPayload }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const url = payload.share_url;
  const inviteText = useMemo(
    () =>
      `Come predict the Football World Cup 2026 with me, join my pool at ${url}`,
    [url],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Fallback for older browsers, selecting the visible text is enough.
    }
  };

  const waHref = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
    "Come predict the Football World Cup 2026 with me",
  )}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(
    "Join my Tournamental pool",
  )}&body=${encodeURIComponent(inviteText)}`;

  return (
    <div className="syn-page">
      <div className="syn-container">
        <div className="syn-success-card">
          <h1 className="syn-success-title">Your syndicate is live</h1>
          <p className="syn-success-sub">
            Share the link and start your pool.
          </p>

          <div className="syn-url-pill">
            <div className="syn-url-text" aria-label="Syndicate URL">
              {url.replace(/^https?:\/\//, "")}
            </div>
            <button
              type="button"
              className="syn-url-copy"
              onClick={copy}
              aria-label="Copy syndicate URL"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          <div className="syn-cta-grid">
            <a className="syn-cta" href={waHref} target="_blank" rel="noopener noreferrer">
              Invite via WhatsApp
            </a>
            <a className="syn-cta" href={tgHref} target="_blank" rel="noopener noreferrer">
              Invite via Telegram
            </a>
            <a className="syn-cta" href={mailHref}>
              Invite by email
            </a>
          </div>

          <div className="syn-link-row">
            <a href={`/s/${payload.slug}`}>Go to your syndicate page →</a>
            <a href="/world-cup-2026">Make your bracket first →</a>
            <a href={`/manage/syndicates/${payload.slug}`}>Manage your syndicate →</a>
          </div>
        </div>
      </div>
    </div>
  );
}
