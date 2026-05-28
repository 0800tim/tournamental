"use client";

import { useState, useMemo } from "react";
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
  created_at: number;
}

type Phase = "requesting" | "verifying" | "managing";

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
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const phoneE164 = useMemo(() => {
    const digits = phoneLocal.replace(/\D+/g, "").replace(/^0+/, "");
    return digits ? `${dialCode}${digits}` : "";
  }, [dialCode, phoneLocal]);

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
      const res = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/manage-owner`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editName.trim() || undefined,
          topic: editTopic.trim() || null,
        }),
      });
      if (res.ok) {
        const body = await res.json() as { syndicate?: { name: string; topic: string | null } };
        if (body.syndicate) {
          setSyndicate((prev) => prev ? { ...prev, name: body.syndicate!.name, topic: body.syndicate!.topic } : prev);
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
