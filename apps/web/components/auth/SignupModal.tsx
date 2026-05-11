/**
 * SignupModal — 2-step registration flow.
 *
 * Step 1 (mandatory): pick a `@handle` + auth method.
 *   Tabs: Telegram, SMS, Email, Continue as guest.
 *   SMS + Email show "Coming soon" — guest + Telegram are live for the
 *   launch window.
 *
 * Step 2 (skippable): country + age bucket + favourite team.
 *   The country pre-fills from `defaultCountry` (passed by the parent
 *   from `CF-IPCountry` on the server, fallback NZ).
 *   The timezone is captured silently from `Intl.DateTimeFormat()`.
 *   The "Skip for now" and "Continue" buttons are the same size.
 *
 * Telemetry:
 *   - signup-attempt fires on Step 1 submit.
 *   - signup-complete fires once the server returns 201/200.
 *   - profile-field-saved fires for each field in Step 2.
 *   - Step 2 "Skip" fires signup-step2-skipped.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal="true".
 *   - Escape closes.
 *   - First focusable on Step 1 is the handle input; on Step 2 it's the
 *     country select.
 */

"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  patchProfile,
  registerUser,
  type ProfilePatchInput,
  type RegisterResult,
} from "@/lib/user/api";
import {
  pushDataLayer,
  setLocalUser,
} from "@/lib/user/storage";

import "./SignupModal.css";

export type SignupAuthMethod = "telegram" | "sms" | "email-magic-link" | "guest";

export interface SignupModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * Called when registration completes (with or without Step 2). The
   * caller is expected to refresh whatever UI surface depends on the
   * signed-in user (avatar initials, profile link, etc).
   */
  readonly onComplete?: (user: RegisterResult) => void;
  /** Default country pre-fill (ISO-2). Falls back to "NZ". */
  readonly defaultCountry?: string;
  /** Override base url (tests). */
  readonly baseUrl?: string;
  /** Override fetch (tests). */
  readonly fetchImpl?: typeof fetch;
}

const HANDLE_PATTERN = /^[a-z0-9_]{3,24}$/;

const AGE_BUCKETS = [
  "<18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+",
] as const;

const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "NZ", name: "New Zealand" },
  { code: "AU", name: "Australia" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "BR", name: "Brazil" },
  { code: "AR", name: "Argentina" },
  { code: "MX", name: "Mexico" },
  { code: "JP", name: "Japan" },
  { code: "ZA", name: "South Africa" },
  { code: "IN", name: "India" },
  { code: "__OTHER__", name: "Other / prefer not to say" },
];

const POPULAR_TEAMS: Array<{ code: string; name: string; emoji: string }> = [
  { code: "ARG", name: "Argentina", emoji: "🇦🇷" },
  { code: "BRA", name: "Brazil", emoji: "🇧🇷" },
  { code: "FRA", name: "France", emoji: "🇫🇷" },
  { code: "ENG", name: "England", emoji: "🏴" },
  { code: "ESP", name: "Spain", emoji: "🇪🇸" },
  { code: "GER", name: "Germany", emoji: "🇩🇪" },
  { code: "POR", name: "Portugal", emoji: "🇵🇹" },
  { code: "NED", name: "Netherlands", emoji: "🇳🇱" },
  { code: "USA", name: "United States", emoji: "🇺🇸" },
  { code: "MEX", name: "Mexico", emoji: "🇲🇽" },
  { code: "JPN", name: "Japan", emoji: "🇯🇵" },
];

export function SignupModal({
  open,
  onClose,
  onComplete,
  defaultCountry = "NZ",
  baseUrl,
  fetchImpl,
}: SignupModalProps) {
  const titleId = useId();
  const handleId = useId();
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [handle, setHandle] = useState("");
  const [authMethod, setAuthMethod] = useState<SignupAuthMethod>("guest");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 state
  const [country, setCountry] = useState<string>(defaultCountry);
  const [ageBucket, setAgeBucket] = useState<string>("");
  const [favouriteTeam, setFavouriteTeam] = useState<string>("");
  const [created, setCreated] = useState<RegisterResult | null>(null);

  const handleInputRef = useRef<HTMLInputElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Reset when the modal opens.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setHandle("");
    setAuthMethod("guest");
    setError(null);
    setSubmitting(false);
    setCreated(null);
    setCountry(defaultCountry);
    setAgeBucket("");
    setFavouriteTeam("");
    // Defer focus so the dialog has painted.
    queueMicrotask(() => handleInputRef.current?.focus());
  }, [open, defaultCountry]);

  // Escape-to-close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleValid = useMemo(() => HANDLE_PATTERN.test(handle), [handle]);

  const onStep1Submit = useCallback(async () => {
    if (submitting) return;
    setError(null);
    if (!handleValid) {
      setError("Handle must be 3–24 lowercase letters, digits or underscore.");
      return;
    }
    if (authMethod !== "guest" && authMethod !== "telegram") {
      setError("That sign-in method is coming soon. Try guest or Telegram.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await registerUser(
        {
          handle,
          auth_method: authMethod,
          // For Telegram, a real auth_id comes from the bot widget. Until
          // that lands we just register the handle and let the bot bind
          // the auth pair later.
        },
        { baseUrl, fetchImpl },
      );
      setLocalUser({
        id: result.id,
        handle: result.handle,
        auth_method: authMethod,
        created_at: result.created_at,
      });
      setCreated(result);
      setStep(2);
    } catch (err) {
      const e = err as { status?: number; body?: { error?: string } };
      if (e.status === 409) {
        setError("That handle's already taken. Try another.");
      } else if (e.status === 400) {
        setError("Invalid sign-up payload.");
      } else {
        setError("Couldn't sign you up. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [authMethod, baseUrl, fetchImpl, handle, handleValid, submitting]);

  const onStep2Submit = useCallback(
    async (skip: boolean) => {
      if (!created) return;
      if (skip) {
        pushDataLayer("tournamental.profile.signup-step2-skipped", {
          user_id: created.id,
        });
        onComplete?.(created);
        onClose();
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const patch: ProfilePatchInput = {};
        if (country && country !== "__OTHER__") patch.country_code = country;
        if (ageBucket) patch.age_bucket = ageBucket;
        if (favouriteTeam) patch.favourite_team_code = favouriteTeam;
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (tz) patch.timezone = tz;
        } catch {
          // older browsers: skip timezone capture
        }
        if (Object.keys(patch).length > 0) {
          await patchProfile(created.id, patch, { baseUrl, fetchImpl });
        }
        pushDataLayer("tournamental.profile.signup-step2-completed", {
          user_id: created.id,
          fields: Object.keys(patch),
        });
        onComplete?.(created);
        onClose();
      } catch {
        setError("Couldn't save your profile. You can fill this in later.");
      } finally {
        setSubmitting(false);
      }
    },
    [
      ageBucket,
      baseUrl,
      country,
      created,
      favouriteTeam,
      fetchImpl,
      onClose,
      onComplete,
    ],
  );

  if (!open) return null;

  return (
    <div
      className="vsm-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="vsm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <span className="vsm-grabber" aria-hidden="true" />
        <button
          ref={closeBtnRef}
          type="button"
          className="vsm-close"
          aria-label="Close sign up"
          onClick={onClose}
        >
          ×
        </button>
        <header className="vsm-header">
          <h2 id={titleId} className="vsm-title">
            {step === 1 ? "Join Tournamental" : "Tell us a bit about you"}
          </h2>
          <span className="vsm-step-chip">Step {step} of 2</span>
        </header>

        {step === 1 ? (
          <>
            <section className="vsm-section">
              <label className="vsm-section-label" htmlFor={handleId}>
                Pick a handle
              </label>
              <div className="vsm-handle-wrap">
                <span className="vsm-handle-prefix" aria-hidden="true">
                  @
                </span>
                <input
                  ref={handleInputRef}
                  id={handleId}
                  className="vsm-handle-input"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="your_handle"
                  value={handle}
                  onChange={(e) =>
                    setHandle(e.target.value.toLowerCase().slice(0, 24))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void onStep1Submit();
                    }
                  }}
                />
              </div>
              <p className="vsm-hint">
                3–24 chars, lowercase letters, digits or underscore.
              </p>
            </section>

            <section className="vsm-section">
              <span className="vsm-section-label">How you&apos;ll sign in</span>
              <div className="vsm-tabs">
                <button
                  type="button"
                  className="vsm-tab"
                  aria-pressed={authMethod === "guest"}
                  onClick={() => setAuthMethod("guest")}
                >
                  Guest
                </button>
                <button
                  type="button"
                  className="vsm-tab"
                  aria-pressed={authMethod === "telegram"}
                  onClick={() => setAuthMethod("telegram")}
                >
                  Telegram
                </button>
                <button
                  type="button"
                  className="vsm-tab"
                  aria-pressed={authMethod === "sms"}
                  data-disabled="true"
                  onClick={() =>
                    setError("SMS sign-in is coming soon. Try guest for now.")
                  }
                >
                  SMS<span className="vsm-tab-soon">soon</span>
                </button>
                <button
                  type="button"
                  className="vsm-tab"
                  aria-pressed={authMethod === "email-magic-link"}
                  data-disabled="true"
                  onClick={() =>
                    setError(
                      "Magic-link email sign-in is coming soon. Try guest for now.",
                    )
                  }
                >
                  Email<span className="vsm-tab-soon">soon</span>
                </button>
              </div>
              <p className="vsm-hint">
                Guest works right now — you can link Telegram from your profile later.
              </p>
            </section>

            {error ? <p className="vsm-error">{error}</p> : null}

            <div className="vsm-actions">
              <button
                type="button"
                className="vsm-btn vsm-btn-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="vsm-btn vsm-btn-primary"
                onClick={() => {
                  void onStep1Submit();
                }}
                disabled={submitting || !handleValid}
              >
                {submitting ? "Signing up…" : "Continue"}
              </button>
            </div>
          </>
        ) : (
          <>
            <section className="vsm-section">
              <label className="vsm-section-label" htmlFor="vsm-country">
                Country
              </label>
              <select
                id="vsm-country"
                className="vsm-input"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </section>

            <section className="vsm-section">
              <span className="vsm-section-label">Age range</span>
              <div className="vsm-tabs">
                {AGE_BUCKETS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className="vsm-tab"
                    aria-pressed={ageBucket === b}
                    onClick={() => setAgeBucket(b === ageBucket ? "" : b)}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </section>

            <section className="vsm-section">
              <span className="vsm-section-label">Favourite team (optional)</span>
              <div className="vsm-tabs">
                {POPULAR_TEAMS.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    className="vsm-tab"
                    aria-pressed={favouriteTeam === t.code}
                    onClick={() =>
                      setFavouriteTeam(t.code === favouriteTeam ? "" : t.code)
                    }
                  >
                    <span aria-hidden="true" style={{ marginRight: 4 }}>
                      {t.emoji}
                    </span>
                    {t.code}
                  </button>
                ))}
              </div>
              <p className="vsm-hint">
                You can change this any time from your profile.
              </p>
            </section>

            {error ? <p className="vsm-error">{error}</p> : null}

            <div className="vsm-actions">
              <button
                type="button"
                className="vsm-btn vsm-btn-secondary"
                onClick={() => {
                  void onStep2Submit(true);
                }}
                disabled={submitting}
              >
                Skip for now
              </button>
              <button
                type="button"
                className="vsm-btn vsm-btn-primary"
                onClick={() => {
                  void onStep2Submit(false);
                }}
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Finish"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
