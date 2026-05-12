"use client";

/**
 * Authenticated profile editor at /profile.
 *
 * Two backends are supported transparently:
 *
 *   1. **Inbound-login** (the default — WhatsApp / SMS login via
 *      auth.tournamental.com). The user record lives in the auth-sms
 *      SQLite store. Reads from GET /v1/auth/me, writes via PATCH
 *      /v1/auth/me. Works without Supabase.
 *
 *   2. **Supabase** (legacy email magic-link). The user_profiles row
 *      lives in Supabase. Reads from useUser(), writes via the
 *      Supabase client's `from('user_profiles').update(...)`.
 *
 * The component figures out which one to use from useUser()'s status
 * and the shape of the user.id (`u_...` = inbound; UUID = Supabase).
 *
 * Save model: explicit Save button at the bottom of the form. We
 * keep a `draft` of pending edits, diff against the loaded record on
 * Save, and PATCH only the changed fields. The button stays disabled
 * unless there's a real diff so people can't accidentally bump
 * last_seen_at by mashing buttons.
 */

import { useEffect, useMemo, useState } from "react";

import { browserClient } from "@/lib/auth/supabase";
import { useUser } from "@/lib/auth/useUser";
import { signOut } from "@/lib/auth/signIn";
import {
  fetchInboundUser,
  updateInboundProfile,
  type InboundProfilePatch,
  type InboundUser,
} from "@/lib/auth/inbound-login";
import {
  COUNTRIES,
  detectCountryFromPhone,
  findCountryByCode,
} from "@/lib/profile/countries";
import { findTeamByCode } from "@/lib/profile/teams";
import { TeamPicker } from "@/components/profile/TeamPicker";
import { SignupModal } from "./SignupModal";

import "@/components/profile/team-picker.css";

export function ProfilePage() {
  const { status, user, loading } = useUser();
  const [showModal, setShowModal] = useState(false);

  if (loading) {
    return (
      <section className="vt-section">
        <h2 className="vt-section-title">Profile</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>Loading…</p>
      </section>
    );
  }

  if (status === "guest" || status === "unconfigured") {
    return (
      <>
        <section className="vt-section">
          <h2 className="vt-section-title">Save your bracket</h2>
          <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
            Sign in to keep your picks across devices, follow friends, and
            track your rank on the global leaderboard.
          </p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="vt-profile-cta"
          >
            Sign In/Up
          </button>
        </section>
        <SignupModal open={showModal} onClose={() => setShowModal(false)} />
      </>
    );
  }

  // Inbound-login users have IDs like `u_<22 hex>` (set by auth-sms).
  // Supabase users have UUIDs. Route accordingly.
  const isInbound = !!user?.id && user.id.startsWith("u_");

  if (isInbound) {
    return <InboundProfileEditor userId={user!.id} />;
  }

  return <SupabaseProfileNotice />;
}

/* ---------------- inbound (auth-sms) editor ---------------- */

function InboundProfileEditor({ userId }: { userId: string }) {
  const [serverUser, setServerUser] = useState<InboundUser | null>(null);
  const [draft, setDraft] = useState<DraftProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  // Initial load.
  useEffect(() => {
    const ac = new AbortController();
    void fetchInboundUser(ac.signal).then((u) => {
      if (ac.signal.aborted) return;
      if (!u) return;
      setServerUser(u);
      setDraft(initialDraft(u));
    });
    return () => ac.abort();
  }, [userId]);

  // Auto-detect country from the user's sign-in phone once on first
  // load. Only applied if the user hasn't already set a country.
  useEffect(() => {
    if (!serverUser || !draft) return;
    if (draft.country) return;
    const detected = detectCountryFromPhone(serverUser.phone ?? null);
    if (!detected) return;
    setDraft((d) => (d ? { ...d, country: detected.code } : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUser]);

  if (!serverUser || !draft) {
    return (
      <section className="vt-section">
        <h2 className="vt-section-title">Profile</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>Loading profile…</p>
      </section>
    );
  }

  const diff = diffDraft(serverUser, draft);
  const dirty = Object.keys(diff).length > 0;

  const onSave = async () => {
    setSaving(true);
    setToast(null);
    const res = await updateInboundProfile(diff);
    setSaving(false);
    if (!res.ok) {
      setToast({ kind: "err", text: humaniseError(res.error) });
      window.setTimeout(() => setToast(null), 3500);
      return;
    }
    setServerUser(res.user);
    setDraft(initialDraft(res.user));
    setToast({ kind: "ok", text: "Saved ✓" });
    window.setTimeout(() => setToast(null), 2000);
  };

  const phoneDisplay = serverUser.phone ?? "—";
  const greeting = draft.displayName || draft.firstName || phoneDisplay;

  return (
    <>
      <section className="vt-section">
        <h2 className="vt-section-title">{greeting}</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 13 }}>
          Signed in as <strong>{phoneDisplay}</strong>
          {serverUser.email ? ` · ${serverUser.email}` : ""} · joined{" "}
          {new Date(serverUser.createdAt * 1000).toLocaleDateString()}
        </p>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">Details</h2>
        <Field label="First name">
          <input
            className="auth-input"
            type="text"
            value={draft.firstName}
            onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
            maxLength={80}
            autoComplete="given-name"
          />
        </Field>
        <Field label="Last name">
          <input
            className="auth-input"
            type="text"
            value={draft.lastName}
            onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
            maxLength={80}
            autoComplete="family-name"
          />
        </Field>
        <Field label="Display name (shown on leaderboards)">
          <input
            className="auth-input"
            type="text"
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            maxLength={80}
            placeholder={draft.firstName || "Your handle"}
          />
        </Field>
        <Field label="Email">
          <input
            className="auth-input"
            type="email"
            inputMode="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Mobile">
          <input
            className="auth-input"
            type="tel"
            value={phoneDisplay}
            readOnly
            aria-readonly="true"
            title="This is the phone number you signed in with. Contact support to change it."
            style={{ opacity: 0.7 }}
          />
        </Field>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">Location</h2>
        <Field label="Country">
          <select
            className="auth-input"
            value={draft.country}
            onChange={(e) => setDraft({ ...draft, country: e.target.value })}
          >
            <option value="">Select country…</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="City">
          <input
            className="auth-input"
            type="text"
            value={draft.city}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            maxLength={80}
            placeholder="Auckland"
            autoComplete="address-level2"
          />
        </Field>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">Favourite team</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 13 }}>
          {draft.favouriteTeamCode
            ? `Selected: ${findTeamByCode(draft.favouriteTeamCode)?.name ?? draft.favouriteTeamCode}`
            : "Tap a flag to choose your favourite. Sorted by FIFA ranking."}
        </p>
        <TeamPicker
          value={draft.favouriteTeamCode}
          onChange={(code) => setDraft({ ...draft, favouriteTeamCode: code ?? "" })}
        />
      </section>

      <section className="vt-section vt-profile-save-row" data-dirty={dirty ? "1" : "0"}>
        <button
          type="button"
          className="vt-profile-save"
          onClick={() => void onSave()}
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        {dirty && !saving && (
          <button
            type="button"
            className="vt-profile-revert"
            onClick={() => setDraft(initialDraft(serverUser))}
          >
            Discard
          </button>
        )}
        {toast && (
          <p
            role="status"
            style={{
              margin: 0,
              fontSize: 13,
              color: toast.kind === "ok" ? "var(--vt-accent)" : "#ff8888",
            }}
          >
            {toast.text}
          </p>
        )}
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">Developer</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 13 }}>
          Mint a personal API key to call the Tournamental REST API or to act
          as a user-tier key against the MCP server.
        </p>
        <a href="/profile/api-keys" className="vt-profile-cta vt-profile-cta--ghost">
          Manage API keys
        </a>
      </section>

      <section className="vt-section">
        <button
          type="button"
          onClick={() => {
            // Inbound-flow logout: clear the cookie via auth-sms logout
            // endpoint (best-effort), then reload to the home page.
            void fetch(
              (process.env.NEXT_PUBLIC_AUTH_BASE_URL ?? "https://auth.tournamental.com") +
                "/v1/auth/session/logout",
              { method: "POST", credentials: "include" },
            ).finally(() => {
              // Belt + braces: also stomp the cookie client-side.
              document.cookie =
                "tnm_session=; Path=/; Domain=.tournamental.com; Max-Age=0";
              window.location.href = "/";
            });
          }}
          className="vt-profile-cta vt-profile-cta--ghost"
        >
          Sign out
        </button>
      </section>

      <style jsx>{`
        :global(.vt-profile-cta) {
          align-self: flex-start;
          padding: 10px 16px;
          border-radius: 999px;
          background: var(--vt-accent, #fde68a);
          color: var(--vt-accent-on, #0a0e1a);
          font-weight: 700;
          border: 0;
          cursor: pointer;
          font-size: 14px;
          text-decoration: none;
          display: inline-block;
        }
        :global(.vt-profile-cta--ghost) {
          background: rgba(255, 255, 255, 0.06);
          color: var(--vt-fg, #fff);
          border: 1px solid rgba(255, 255, 255, 0.12);
          font-weight: 600;
        }
        :global(.vt-profile-save-row) {
          flex-direction: row;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          position: sticky;
          bottom: 12px;
          z-index: 5;
        }
        :global(.vt-profile-save) {
          padding: 12px 20px;
          border-radius: 999px;
          background: var(--vt-accent, #fde68a);
          color: var(--vt-accent-on, #0a0e1a);
          font-weight: 800;
          border: 0;
          cursor: pointer;
          font-size: 15px;
          min-width: 140px;
        }
        :global(.vt-profile-save[disabled]) {
          opacity: 0.45;
          cursor: not-allowed;
        }
        :global(.vt-profile-revert) {
          padding: 10px 14px;
          border-radius: 999px;
          background: transparent;
          color: var(--vt-fg-muted, #aaa);
          border: 1px solid rgba(255, 255, 255, 0.12);
          font-size: 13px;
          cursor: pointer;
        }
      `}</style>
    </>
  );
}

/* ---------------- helpers ---------------- */

interface DraftProfile {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  country: string;
  city: string;
  favouriteTeamCode: string;
}

function initialDraft(u: InboundUser): DraftProfile {
  return {
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    displayName: u.displayName ?? "",
    email: u.email ?? "",
    country: u.country ?? "",
    city: u.city ?? "",
    favouriteTeamCode: u.favouriteTeamCode ?? "",
  };
}

function diffDraft(server: InboundUser, draft: DraftProfile): InboundProfilePatch {
  const out: InboundProfilePatch = {};
  const cmp = (
    serverVal: string | null,
    draftVal: string,
    key: keyof InboundProfilePatch,
  ) => {
    const sv = (serverVal ?? "").trim();
    const dv = draftVal.trim();
    if (sv === dv) return;
    (out as Record<string, string | null>)[key] = dv.length > 0 ? dv : null;
  };
  cmp(server.firstName, draft.firstName, "first_name");
  cmp(server.lastName, draft.lastName, "last_name");
  cmp(server.displayName, draft.displayName, "display_name");
  cmp(server.email, draft.email, "email");
  cmp(server.country, draft.country, "country");
  cmp(server.city, draft.city, "city");
  cmp(server.favouriteTeamCode, draft.favouriteTeamCode, "favourite_team_code");
  return out;
}

function humaniseError(err: string): string {
  switch (err) {
    case "bad-email":
      return "That email doesn't look right.";
    case "email-taken":
      return "That email is already linked to another account.";
    case "unauthorized":
      return "Your session expired. Sign in again to save changes.";
    case "network":
      return "Couldn't reach the profile service. Check your connection.";
    default:
      return "Couldn't save changes. Try again.";
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 13,
        color: "var(--vt-fg-muted)",
      }}
    >
      {label}
      {children}
    </label>
  );
}

/* ---------------- Supabase fallback notice ---------------- */

/**
 * Stub for users authenticated through Supabase (the legacy path). For
 * v0.4 we don't migrate the Supabase-side profile editor; users on the
 * legacy path see a notice and can sign out + back in via the inbound
 * flow to get the new editor. When/if we drop Supabase entirely this
 * branch goes away.
 */
function SupabaseProfileNotice() {
  const sb = useMemo(() => browserClient(), []);
  return (
    <section className="vt-section">
      <h2 className="vt-section-title">Profile</h2>
      <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
        You signed in through the legacy email flow. The new profile editor
        is only wired into the WhatsApp / SMS sign-in for now. Sign out and
        sign back in with WhatsApp to use it.
      </p>
      <button
        type="button"
        className="vt-profile-cta vt-profile-cta--ghost"
        onClick={() => {
          if (sb) void signOut();
        }}
      >
        Sign out
      </button>
    </section>
  );
}
