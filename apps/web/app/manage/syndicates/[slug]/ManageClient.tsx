"use client";

import { useState, useMemo, useEffect } from "react";
import { InviteWizard } from "@/components/syndicate/invite/InviteWizard";

interface SyndicateData {
  slug: string;
  name: string;
  tier: string;
  member_count: number;
  share_url: string;
  share_guid: string;
  topic: string | null;
  size_band: string;
  /** Bare E.164 dial codes ("64", "61", ...). Empty array means
   * "no country restriction". Added Tim 2026-06-06 so the manage
   * page can edit the list post-creation. */
  allowed_phone_countries: readonly string[];
  created_at: number;
}

type Phase = "requesting" | "verifying" | "managing";

const COUNTRY_CODES = [
  { iso: "NZ", dial: "+64", name: "New Zealand", flag: "🇳🇿" },
  { iso: "AU", dial: "+61", name: "Australia", flag: "🇦🇺" },
  { iso: "GB", dial: "+44", name: "United Kingdom", flag: "🇬🇧" },
  { iso: "US", dial: "+1", name: "United States", flag: "🇺🇸" },
  { iso: "IE", dial: "+353", name: "Ireland", flag: "🇮🇪" },
  { iso: "ZA", dial: "+27", name: "South Africa", flag: "🇿🇦" },
  { iso: "IN", dial: "+91", name: "India", flag: "🇮🇳" },
  { iso: "BR", dial: "+55", name: "Brazil", flag: "🇧🇷" },
  { iso: "DE", dial: "+49", name: "Germany", flag: "🇩🇪" },
  { iso: "FR", dial: "+33", name: "France", flag: "🇫🇷" },
] as const;

/** Cap mirrors the server's MAX_ALLOWED_COUNTRIES (10). */
const MAX_ALLOWED_COUNTRIES = 10;

export function ManageClient({
  slug,
  prefilledPhone,
}: {
  slug: string;
  prefilledPhone: string;
}): JSX.Element {
  // Try to split a pre-filled E.164 phone into dial + local
    type DialCode = typeof COUNTRY_CODES[number]["dial"];
  const prefillDial: DialCode = COUNTRY_CODES.find((c) => prefilledPhone.startsWith(c.dial))?.dial ?? "+64";
  const prefillLocal = prefilledPhone.startsWith(prefillDial)
    ? prefilledPhone.slice(prefillDial.length)
    : "";

  const [phase, setPhase] = useState<Phase>("requesting");
  const [dialCode, setDialCode] = useState<DialCode>(prefillDial);
  const [phoneLocal, setPhoneLocal] = useState(prefillLocal);
  const [code, setCode] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");
  const [token, setToken] = useState("");
  const [syndicate, setSyndicate] = useState<SyndicateData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Edit state
  const [editName, setEditName] = useState("");
  const [editTopic, setEditTopic] = useState("");
  // Country lock editor. We keep the current allow-list as a separate
  // `editAllowedCountries` array so the user can toggle / add / remove
  // without round-tripping to the server. `editCountriesLocked` mirrors
  // the SyndicateForm pattern: a checkbox toggle, distinct from the
  // array being empty, so the user can clear the list (-> 'no
  // restriction') AND toggle the lock off without ambiguity.
  const [editAllowedCountries, setEditAllowedCountries] = useState<string[]>([]);
  const [editCountriesLocked, setEditCountriesLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const phoneE164 = useMemo(() => {
    const digits = phoneLocal.replace(/\D+/g, "").replace(/^0+/, "");
    return digits ? `${dialCode}${digits}` : "";
  }, [dialCode, phoneLocal]);

  // Super-admin native session: a logged-in caller that the server
  // recognises as super-admin (SUPER_ADMIN_USER_IDS / SUPER_ADMIN_PHONES
  // env) can hit /manage-owner directly with the tnm_session cookie and
  // skip the OTP phase. We probe by calling GET with no Bearer token —
  // if the server says 200 it accepted the session; otherwise we fall
  // through to the OTP UI as normal. Tim 2026-06-04.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (token) return;
    // If the URL carries ?admin_token=, the explicit admin-impersonate
    // path takes precedence. Don't probe.
    const url = new URL(window.location.href);
    if (url.searchParams.has("admin_token")) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug)}/manage-owner`,
          { credentials: "include", cache: "no-store" },
        );
        if (cancelled) return;
        if (!res.ok) return;
        const body = (await res.json()) as { syndicate?: SyndicateData };
        if (!body.syndicate) return;
        // Server accepted the session as super-admin. Use a sentinel
        // "session:cookie" marker so the rest of the component knows
        // we're already authorised; the Bearer header it sends with
        // that sentinel is ignored server-side because the session
        // check runs before the JWT check.
        setToken("session:cookie");
        setSyndicate(body.syndicate);
        setEditName(body.syndicate.name);
        setEditTopic(body.syndicate.topic ?? "");
        setPhase("managing");
      } catch {
        // Network hiccup -> just fall through to the OTP UI.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Admin impersonation: when the URL carries `?admin_token=` (issued
  // by the Tournamental admin app via /api/admin/syndicates/[slug]
  // /impersonate), use it as the manage token and skip the OTP phase.
  // The token is verified server-side on every subsequent call, so a
  // tampered URL just lands on a 403 from /manage-owner.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const adminToken = url.searchParams.get("admin_token");
    if (!adminToken || token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug)}/manage-owner`,
          {
            headers: { Authorization: `Bearer ${adminToken}` },
            cache: "no-store",
          },
        );
        if (cancelled) return;
        if (!res.ok) {
          setError("Admin impersonation token rejected or expired.");
          return;
        }
        const body = (await res.json()) as {
          syndicate?: SyndicateData;
        };
        if (!body.syndicate) {
          setError("Admin impersonation: pool not found.");
          return;
        }
        setToken(adminToken);
        setSyndicate(body.syndicate);
        setEditName(body.syndicate.name);
        setEditTopic(body.syndicate.topic ?? "");
        setPhase("managing");
        // Strip the token from the URL so a copy-paste link doesn't
        // leak the token to the next person; the in-memory state
        // still has it.
        url.searchParams.delete("admin_token");
        window.history.replaceState({}, "", url.toString());
      } catch {
        if (!cancelled) setError("Network error while opening as admin.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // We deliberately only run this once on mount; if the token were
    // to change, the operator just reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestOtp() {
    setError("");
    if (!/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
      setError("Enter a valid phone number including country code.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/manage-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", phone: phoneE164 }),
      });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        if (body.error === "phone_mismatch") {
          setError("That phone number doesn't match the one used to create this syndicate.");
        } else if (body.error === "not_found") {
          setError("Syndicate not found. Check the URL.");
        } else {
          setError("Couldn't send the code. Please try again.");
        }
        return;
      }
      setPhoneMasked(body.phone_masked as string ?? phoneE164);
      setPhase("verifying");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError("");
    if (code.trim().length < 4) {
      setError("Enter the code we sent you.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/manage-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", phone: phoneE164, code: code.trim() }),
      });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        if (body.error === "otp_verify_failed") {
          setError("Incorrect or expired code. Try again.");
        } else {
          setError("Verification failed. Please try again.");
        }
        return;
      }
      const syn = body.syndicate as SyndicateData;
      setToken(body.token as string);
      setSyndicate(syn);
      setEditName(syn.name);
      setEditTopic(syn.topic ?? "");
      const initialCountries = (syn.allowed_phone_countries ?? []).slice();
      setEditAllowedCountries(initialCountries);
      setEditCountriesLocked(initialCountries.length > 0);
      setPhase("managing");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    if (!token || !syndicate) return;
    setSaving(true);
    setSaveMsg("");
    try {
      // When the lock toggle is OFF, send an empty array to clear
      // the restriction server-side. When it's ON, send whatever
      // codes the user has chipped in (the server enforces a 10-code
      // cap and a dial-code regex on each entry).
      const allowedToSend = editCountriesLocked ? editAllowedCountries : [];
      const res = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/manage-owner`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editName.trim() || undefined,
          topic: editTopic.trim() || null,
          allowed_phone_countries: allowedToSend,
        }),
      });
      if (res.ok) {
        const body = await res.json() as {
          syndicate?: {
            name: string;
            topic: string | null;
            allowed_phone_countries?: readonly string[];
          };
        };
        if (body.syndicate) {
          const nextCountries = body.syndicate.allowed_phone_countries ?? [];
          setSyndicate((prev) =>
            prev
              ? {
                  ...prev,
                  name: body.syndicate!.name,
                  topic: body.syndicate!.topic,
                  allowed_phone_countries: nextCountries,
                }
              : prev,
          );
          // Re-sync the editor in case the server normalised our list
          // (deduped, dropped invalid entries, etc).
          setEditAllowedCountries(nextCountries.slice());
          setEditCountriesLocked(nextCountries.length > 0);
        }
        setSaveMsg("Saved.");
        setTimeout(() => setSaveMsg(""), 2000);
      } else {
        setSaveMsg("Couldn't save. Please try again.");
      }
    } catch {
      setSaveMsg("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(syndicate?.share_url ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  if (phase === "requesting") {
    return (
      <div className="syn-page">
        <div className="syn-container">
          <p className="syn-eyebrow">Syndicate owner access</p>
          <h1 className="syn-title">Manage your syndicate</h1>
          <p className="syn-sub">
            Enter the phone number you used when you created <strong>{slug}</strong>. We&apos;ll send a one-time code.
          </p>
          <div className="syn-form">
            <div className="syn-field">
              <label className="syn-label" htmlFor="manage-phone">Your phone number</label>
              <div className="syn-phone-row">
                <select
                  className="syn-select"
                  value={dialCode}
                  onChange={(e) => setDialCode(e.target.value as DialCode)}
                  aria-label="Country dialling code"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.iso} value={c.dial}>{c.iso} {c.dial}</option>
                  ))}
                </select>
                <input
                  id="manage-phone"
                  className="syn-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  value={phoneLocal}
                  placeholder="21 123 4567"
                  onChange={(e) => setPhoneLocal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && requestOtp()}
                />
              </div>
            </div>
            {error && <div className="syn-form-error">{error}</div>}
            <button
              type="button"
              className="syn-submit"
              onClick={requestOtp}
              disabled={loading || !phoneLocal}
            >
              {loading ? "Sending…" : "Send me a code"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "verifying") {
    return (
      <div className="syn-page">
        <div className="syn-container">
          <p className="syn-eyebrow">Syndicate owner access</p>
          <h1 className="syn-title">Enter your code</h1>
          <p className="syn-sub">
            We sent a 6-digit code to <strong>{phoneMasked}</strong>.
          </p>
          <div className="syn-form">
            <div className="syn-field">
              <label className="syn-label" htmlFor="manage-code">One-time code</label>
              <input
                id="manage-code"
                className="syn-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                autoFocus
              />
            </div>
            {error && <div className="syn-form-error">{error}</div>}
            <button
              type="button"
              className="syn-submit"
              onClick={verifyOtp}
              disabled={loading || code.length < 4}
            >
              {loading ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              className="syn-submit"
              style={{ background: "transparent", color: "var(--ink-400, #94a3b8)", marginTop: "0.5rem", border: "1px solid var(--vt-border, #25252c)" }}
              onClick={() => { setPhase("requesting"); setCode(""); setError(""); }}
            >
              Use a different number
            </button>
          </div>
        </div>
      </div>
    );
  }

  // phase === "managing"
  if (!syndicate) return <></>;

  const inviteText = `Come predict the Football World Cup 2026 with me — join my pool at ${syndicate.share_url}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(syndicate.share_url)}&text=${encodeURIComponent("Come predict the Football World Cup 2026 with me")}`;
  const mailHref = `mailto:?subject=${encodeURIComponent("Join my Tournamental pool")}&body=${encodeURIComponent(inviteText)}`;
  const embedSnippet = `<iframe src="https://play.tournamental.com/embed/${syndicate.slug}" width="100%" height="480" frameborder="0" allow="clipboard-write"></iframe>`;

  return (
    <div className="syn-page">
      <div className="syn-container">
        <p className="syn-eyebrow">Managing · {syndicate.tier === "premium" ? "Premium" : "Free tier"}</p>
        <h1 className="syn-title">{syndicate.name}</h1>

        {/* Invite URL */}
        <div className="syn-success-card" style={{ marginTop: "1.5rem" }}>
          <p className="syn-success-sub" style={{ marginBottom: "0.75rem" }}>Your invite link</p>
          <div className="syn-url-pill">
            <div className="syn-url-text">{syndicate.share_url.replace(/^https?:\/\//, "")}</div>
            <button type="button" className="syn-url-copy" onClick={copyLink}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="syn-cta-grid" style={{ marginTop: "0.75rem" }}>
            <a className="syn-cta" href={waHref} target="_blank" rel="noopener noreferrer">WhatsApp</a>
            <a className="syn-cta" href={tgHref} target="_blank" rel="noopener noreferrer">Telegram</a>
            <a className="syn-cta" href={mailHref}>Email</a>
          </div>
        </div>

        {/* Bulk invite (CSV upload + per-contact warm-invite URL) */}
        <div className="syn-success-card" style={{ marginTop: "1rem" }}>
          <InviteWizard
            slug={syndicate.slug}
            poolName={syndicate.name}
            shareUrl={syndicate.share_url}
            manageToken={token}
          />
        </div>

        {/* Stats */}
        <div className="syn-success-card" style={{ marginTop: "1rem" }}>
          <p className="syn-success-sub">Stats</p>
          <div style={{ display: "flex", gap: "2rem", marginTop: "0.5rem" }}>
            <div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--vt-fg-strong, #f1f5f9)" }}>{syndicate.member_count}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--ink-400, #94a3b8)" }}>Members</div>
            </div>
            <div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--vt-fg-strong, #f1f5f9)" }}>{syndicate.tier === "premium" ? "Premium" : "Free"}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--ink-400, #94a3b8)" }}>Tier</div>
            </div>
          </div>
        </div>

        {/* Embed snippet */}
        <div className="syn-success-card" style={{ marginTop: "1rem" }}>
          <p className="syn-success-sub">Embed on your site</p>
          <p style={{ fontSize: "0.82rem", color: "var(--ink-400, #94a3b8)", marginBottom: "0.5rem" }}>
            Drop this snippet anywhere on your website or blog to embed your live leaderboard.
          </p>
          <div className="syn-url-pill" style={{ fontFamily: "monospace", fontSize: "0.75rem", wordBreak: "break-all" }}>
            <div className="syn-url-text">{embedSnippet}</div>
            <button
              type="button"
              className="syn-url-copy"
              onClick={() => { navigator.clipboard.writeText(embedSnippet).catch(() => {}); }}
            >
              Copy
            </button>
          </div>
        </div>

        {/* Settings */}
        <div className="syn-success-card" style={{ marginTop: "1rem" }}>
          <p className="syn-success-sub">Settings</p>
          <div className="syn-form" style={{ marginTop: "0.75rem" }}>
            <div className="syn-field">
              <label className="syn-label" htmlFor="manage-name">Syndicate name</label>
              <input
                id="manage-name"
                className="syn-input"
                type="text"
                value={editName}
                maxLength={80}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="syn-field">
              <label className="syn-label" htmlFor="manage-topic">Description <span className="syn-hint">(optional)</span></label>
              <textarea
                id="manage-topic"
                className="syn-textarea"
                value={editTopic}
                maxLength={280}
                onChange={(e) => setEditTopic(e.target.value)}
              />
            </div>

            {/* Country lock editor. Mirrors the create form's picker
              * (apps/web/app/syndicates/new/SyndicateForm.tsx). Toggle
              * controls whether the lock is on at all; when off, the
              * server clears `allowed_phone_countries` so the join
              * page stops showing the "<flag> residents only" banner.
              * Tim 2026-06-06. */}
            <fieldset className="syn-fieldset" style={{ marginTop: "0.5rem" }}>
              <legend className="syn-label">
                <span aria-hidden="true">🔒</span> Lock entries by country
              </legend>
              <label className="syn-checkbox-row" style={{ marginTop: "0.25rem" }}>
                <input
                  type="checkbox"
                  checked={editCountriesLocked}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setEditCountriesLocked(next);
                    // First time the toggle goes ON without any
                    // chips in the list, seed with NZ so the user
                    // has something to remove rather than staring
                    // at an empty box.
                    if (next && editAllowedCountries.length === 0) {
                      setEditAllowedCountries(["64"]);
                    }
                  }}
                />
                <span>
                  <strong>Restrict joiners by phone country code</strong>
                  <span className="syn-hint">
                    We verify the joiner&apos;s WhatsApp / SMS country code (+64, +44, +61, etc).
                    Leave off to accept the world. Email-only signups bypass this gate.
                  </span>
                </span>
              </label>
              {editCountriesLocked && (
                <div style={{ marginTop: "0.5rem" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {editAllowedCountries.length === 0 ? (
                      <span className="syn-hint">No countries selected. Add one to keep the lock active.</span>
                    ) : (
                      editAllowedCountries.map((dial) => {
                        const country = COUNTRY_CODES.find((c) => c.dial === `+${dial}`);
                        return (
                          <span
                            key={dial}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.35rem",
                              padding: "0.25rem 0.6rem",
                              borderRadius: "9999px",
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              fontSize: "0.85rem",
                            }}
                          >
                            <span aria-hidden="true">{country?.flag ?? "🌐"}</span>
                            <span>{country?.name ?? `+${dial}`}</span>
                            <span style={{ opacity: 0.6 }}>+{dial}</span>
                            <button
                              type="button"
                              aria-label={`Remove ${country?.name ?? dial}`}
                              onClick={() =>
                                setEditAllowedCountries((cur) => cur.filter((c) => c !== dial))
                              }
                              style={{
                                background: "transparent",
                                border: 0,
                                color: "inherit",
                                cursor: "pointer",
                                fontSize: "1rem",
                                lineHeight: 1,
                                padding: 0,
                                marginLeft: "0.15rem",
                              }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>
                  {editAllowedCountries.length < MAX_ALLOWED_COUNTRIES && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <select
                        className="syn-select"
                        value=""
                        onChange={(e) => {
                          const dial = e.target.value;
                          if (!dial) return;
                          setEditAllowedCountries((cur) =>
                            cur.includes(dial) ? cur : [...cur, dial],
                          );
                        }}
                      >
                        <option value="" disabled>
                          {editAllowedCountries.length === 0
                            ? "Pick a country…"
                            : "+ Add another country…"}
                        </option>
                        {COUNTRY_CODES.filter(
                          (c) => !editAllowedCountries.includes(c.dial.slice(1)),
                        ).map((c) => (
                          <option key={c.iso} value={c.dial.slice(1)}>
                            {c.flag} {c.name} ({c.dial})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {editAllowedCountries.length >= MAX_ALLOWED_COUNTRIES && (
                    <span className="syn-hint" style={{ display: "block", marginTop: "0.4rem" }}>
                      Maximum {MAX_ALLOWED_COUNTRIES} countries per pool. Remove one to add another.
                    </span>
                  )}
                </div>
              )}
            </fieldset>

            <button
              type="button"
              className="syn-submit"
              onClick={saveSettings}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {saveMsg && <p style={{ fontSize: "0.85rem", color: saveMsg === "Saved." ? "#4ade80" : "#f87171", marginTop: "0.5rem" }}>{saveMsg}</p>}
          </div>
        </div>

        <div className="syn-link-row" style={{ marginTop: "1.5rem" }}>
          <a href={`/s/${syndicate.slug}`}>View your public syndicate page →</a>
          <a href="/dashboard/syndicates">Full dashboard (requires sign-in) →</a>
        </div>
      </div>
    </div>
  );
}
