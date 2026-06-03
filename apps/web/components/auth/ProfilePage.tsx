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

import { useTranslations } from "next-intl";
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
import { AvatarUploader } from "@/components/profile/AvatarUploader";
import { SignupModal } from "./SignupModal";
import { PhoneLinkModal } from "./PhoneLinkModal";
import { slugifyDisplayName } from "@/lib/share/handle-slug";

import "@/components/profile/team-picker.css";
import "@/components/profile/avatar-uploader.css";

function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const out = t(key);
    if (out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

export function ProfilePage() {
  const t = useTranslations();
  const { status, user, loading } = useUser();
  const [showModal, setShowModal] = useState(false);

  if (loading) {
    return (
      <section className="vt-section">
        <h2 className="vt-section-title">{safeT(t, "profile_page.profile_section_title", "Profile")}</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>{safeT(t, "profile_page.loading", "Loading…")}</p>
      </section>
    );
  }

  if (status === "guest" || status === "unconfigured") {
    return (
      <>
        <section className="vt-section">
          <h2 className="vt-section-title">{safeT(t, "profile_page.guest_section_title", "Save your bracket")}</h2>
          <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
            {safeT(t, "profile_page.guest_section_lede", "Sign in to keep your picks across devices, follow friends, and track your rank on the global leaderboard.")}
          </p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="vt-profile-cta"
          >
            {safeT(t, "profile_page.guest_cta_sign_in_up", "Sign In/Up")}
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
  // Add-phone-via-WhatsApp modal. Opens from the empty Mobile field
  // when the user signed up via email-OTP (or any path that didn't
  // leave a phone on file). Tim 2026-06-04: phone is never typed by
  // the user, possession is proven via inbound WhatsApp message.
  const [phoneLinkOpen, setPhoneLinkOpen] = useState(false);
  // Pool counts drive the primary CTA copy + visibility:
  //   - owned > 0                     → "View/Manage pools"  (owner badge)
  //   - owned = 0 && member > 0       → "View pools"         (member-only)
  //   - both 0                        → "Create a pool"      (empty state)
  // Tim 2026-06-02: previously fetched /v1/syndicates/mine (owner-only)
  // so member-only users saw "Create a pool" even though they had pools
  // to view. Switched to /v1/profile/syndicates which returns role per
  // row; same endpoint MyPoolsSection consumes so the browser dedupes.
  const [poolCounts, setPoolCounts] = useState<{
    owned: number;
    member: number;
  } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const r = await fetch("/api/v1/profile/syndicates", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: ac.signal,
        });
        if (!r.ok) {
          setPoolCounts({ owned: 0, member: 0 });
          return;
        }
        const body = (await r.json()) as {
          syndicates?: Array<{ role?: string }>;
        };
        const rows = body.syndicates ?? [];
        const owned = rows.filter((p) => p.role === "owner").length;
        const member = rows.filter((p) => p.role !== "owner").length;
        setPoolCounts({ owned, member });
      } catch {
        if (!ac.signal.aborted) setPoolCounts({ owned: 0, member: 0 });
      }
    })();
    return () => ac.abort();
  }, []);

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

  const t = useTranslations();

  if (!serverUser || !draft) {
    return (
      <section className="vt-section">
        <h2 className="vt-section-title">{safeT(t, "profile_page.profile_section_title", "Profile")}</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>{safeT(t, "profile_page.profile_loading", "Loading profile…")}</p>
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
      setToast({ kind: "err", text: humaniseError(res.error, t) });
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

  const onLogout = () => {
    // Inbound-flow logout: clear the cookie via auth-sms logout
    // endpoint (best-effort), then reload to the home page.
    void fetch(
      (process.env.NEXT_PUBLIC_AUTH_BASE_URL ?? "https://auth.tournamental.com") +
        "/v1/auth/session/logout",
      { method: "POST", credentials: "include" },
    ).finally(() => {
      document.cookie =
        "tnm_session=; Path=/; Domain=.tournamental.com; Max-Age=0";
      window.location.href = "/";
    });
  };

  const onManagePoolsClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Smooth-scroll to the My Pools section instead of jumping; honour
    // prefers-reduced-motion so users with vestibular sensitivity get
    // an instant jump.
    e.preventDefault();
    const target = document.getElementById("profile-pools");
    if (!target) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  return (
    <>
      <section className="vt-section vt-profile-head">
        <div className="vt-profile-head-text">
          <h2 className="vt-section-title">{greeting}</h2>
          <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 13 }}>
            {safeT(t, "profile_page.signed_in_as", "Signed in as")} <strong>{phoneDisplay}</strong>
            {serverUser.email ? ` · ${serverUser.email}` : ""} · {safeT(t, "profile_page.joined", "joined")}{" "}
            {new Date(serverUser.createdAt * 1000).toLocaleDateString()}
          </p>
        </div>
        <div className="vt-profile-head-actions">
          {poolCounts === null ? null : poolCounts.owned > 0 ? (
            <a
              href="#profile-pools"
              onClick={onManagePoolsClick}
              className="vt-profile-action vt-profile-action--primary"
            >
              {safeT(t, "profile_page.view_manage_pools", "View/Manage pools")}
            </a>
          ) : poolCounts.member > 0 ? (
            <a
              href="#profile-pools"
              onClick={onManagePoolsClick}
              className="vt-profile-action vt-profile-action--primary"
            >
              {safeT(t, "profile_page.view_pools", "View pools")}
            </a>
          ) : (
            <a
              href="/syndicates/new"
              className="vt-profile-action vt-profile-action--primary"
            >
              {safeT(t, "profile_page.create_a_pool", "Create a pool")}
            </a>
          )}
          {/* "View my public page" - takes the user to their own bracket
              share landing (/s/<handle>). Always rendered when there's
              a slugifiable handle; only the owner-only "Manage" surface
              changes per role. */}
          {(() => {
            const slug = slugifyDisplayName(draft.displayName);
            if (!slug) return null;
            return (
              <a
                href={`/s/${slug}`}
                className="vt-profile-action vt-profile-action--ghost"
              >
                {safeT(t, "profile_page.view_public_page", "View my public page")}
              </a>
            );
          })()}
          <button
            type="button"
            onClick={onLogout}
            className="vt-profile-action vt-profile-action--ghost"
          >
            {safeT(t, "profile_page.log_out", "Log out")}
          </button>
        </div>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">{safeT(t, "profile_page.avatar_section_title", "Avatar")}</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: "0 0 12px", fontSize: 13 }}>
          {safeT(t, "profile_page.avatar_description", "Shows on your share cards, leaderboard rows, and syndicate tiles. Square images work best; we crop to a circle.")}
        </p>
        <AvatarUploader userId={userId} />
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">{safeT(t, "profile_page.details_section_title", "Details")}</h2>
        <Field label={safeT(t, "profile_page.field_first_name", "First name")}>
          <input
            className="auth-input"
            type="text"
            value={draft.firstName}
            onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
            maxLength={80}
            autoComplete="given-name"
          />
        </Field>
        <Field label={safeT(t, "profile_page.field_last_name", "Last name")}>
          <input
            className="auth-input"
            type="text"
            value={draft.lastName}
            onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
            maxLength={80}
            autoComplete="family-name"
          />
        </Field>
        <Field label={safeT(t, "profile_page.field_display_name", "Display name (your permanent @handle)")}>
          {/* Tim 2026-06-04: display_name is the user's public identity AND
            * the source of their /s/<handle> share URL. Once set it's
            * immutable server-side (auth-sms returns 403 display_name_locked
            * on PATCH). Render read-only with a note so the UX matches.
            * First-time signup still hits this field with displayName="" so
            * we keep editing enabled in that case. */}
          {(serverUser?.displayName ?? "").trim() ? (
            <>
              <input
                className="auth-input"
                type="text"
                value={draft.displayName}
                readOnly
                disabled
                aria-readonly
                maxLength={80}
              />
              <p className="auth-field-hint">
                {safeT(
                  t,
                  "profile_page.hint_display_name_locked",
                  "Your display name is your permanent @handle on Tournamental. It can't be changed once it's set.",
                )}
              </p>
            </>
          ) : (
            <input
              className="auth-input"
              type="text"
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              maxLength={80}
              placeholder={draft.firstName || safeT(t, "profile_page.placeholder_handle", "Your handle")}
            />
          )}
        </Field>
        <Field label={safeT(t, "profile_page.field_email", "Email")}>
          {/* Tim 2026-06-04: email changes require server-side
            * verify-and-merge against the current session, which the
            * auth-sms email-OTP flow doesn't yet support (it mints a
            * fresh session for the verified address instead). Gate the
            * field readOnly with a tooltip until the merge endpoint
            * lands. IDEAS.md tracks the follow-up. */}
          <input
            className="auth-input"
            type="email"
            inputMode="email"
            value={draft.email}
            readOnly
            aria-readonly="true"
            maxLength={254}
            autoComplete="email"
            placeholder={safeT(t, "profile_page.placeholder_email", "you@example.com")}
            title={safeT(
              t,
              "profile_page.field_email_readonly_title",
              "Email changes are coming soon. For now, contact support to update your email.",
            )}
            style={{ opacity: 0.7, cursor: "not-allowed" }}
          />
        </Field>
        <Field label={safeT(t, "profile_page.field_mobile", "Mobile")}>
          {serverUser.phone ? (
            <input
              className="auth-input"
              type="tel"
              value={serverUser.phone}
              readOnly
              aria-readonly="true"
              title={safeT(t, "profile_page.field_mobile_title", "This is the phone number you signed in with. Contact support to change it.")}
              style={{ opacity: 0.7 }}
            />
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                className="auth-input"
                type="tel"
                value=""
                readOnly
                aria-readonly="true"
                placeholder={safeT(t, "profile_page.placeholder_no_phone", "No phone linked yet")}
                style={{ opacity: 0.6, flex: 1 }}
              />
              <button
                type="button"
                className="vt-profile-add-phone-btn"
                onClick={() => setPhoneLinkOpen(true)}
                title={safeT(t, "profile_page.add_phone_title", "Message 'login' to our WhatsApp to save your phone number to your profile.")}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zm-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488" />
                </svg>
                {safeT(t, "profile_page.add_phone_btn", "Add phone")}
              </button>
            </div>
          )}
        </Field>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">{safeT(t, "profile_page.location_section_title", "Location")}</h2>
        <Field label={safeT(t, "profile_page.field_country", "Country")}>
          <select
            className="auth-input"
            value={draft.country}
            onChange={(e) => setDraft({ ...draft, country: e.target.value })}
          >
            <option value="">{safeT(t, "profile_page.placeholder_country", "Select country…")}</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={safeT(t, "profile_page.field_city", "City")}>
          <input
            className="auth-input"
            type="text"
            value={draft.city}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            maxLength={80}
            placeholder={safeT(t, "profile_page.placeholder_city", "Auckland")}
            autoComplete="address-level2"
          />
        </Field>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">
          {safeT(t, "profile_page.favourite_team_section_title", "Favourite team")}
        </h2>
        {/* Tim 2026-06-03: standard-size, non-bold clarifying note
            sat as a separate paragraph below the heading instead of
            jammed inline at 0.6em. */}
        <p
          style={{
            color: "var(--vt-fg-muted)",
            margin: "2px 0 8px",
            fontSize: 14,
            fontWeight: 400,
            fontStyle: "normal",
          }}
        >
          ({safeT(
            t,
            "profile_page.favourite_team_note",
            "This can differ from your predicted winner, e.g. your national team or favourite team in the tournament, even though they may not win!",
          )})
        </p>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 13 }}>
          {draft.favouriteTeamCode
            ? safeT(t, "profile_page.favourite_team_selected", "Selected: {team}").replace("{team}", findTeamByCode(draft.favouriteTeamCode)?.name ?? draft.favouriteTeamCode)
            : safeT(t, "profile_page.favourite_team_help", "Tap a flag to choose your favourite. Sorted by world ranking.")}
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
          {saving ? safeT(t, "profile_page.save_btn_saving", "Saving…") : dirty ? safeT(t, "profile_page.save_btn_save_changes", "Save changes") : safeT(t, "profile_page.save_btn_saved", "Saved")}
        </button>
        {dirty && !saving && (
          <button
            type="button"
            className="vt-profile-revert"
            onClick={() => setDraft(initialDraft(serverUser))}
          >
            {safeT(t, "profile_page.discard_btn", "Discard")}
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

      <MyPoolsSection />

      <section className="vt-section">
        <h2 className="vt-section-title">{safeT(t, "profile_page.developer_section_title", "Developer")}</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 13 }}>
          {safeT(t, "profile_page.developer_description", "Mint a personal API key to call the Tournamental REST API or to act as a user-tier key against the MCP server.")}
        </p>
        <a href="/profile/api-keys" className="vt-profile-cta vt-profile-cta--ghost">
          {safeT(t, "profile_page.developer_manage_api_keys", "Manage API keys")}
        </a>
      </section>

      {/* Sign-out moved to the profile-head action row at the top of
        * the page (Tim 2026-05-22). Anchor still kept for any legacy
        * deep-link, but the visible CTA is gone. */}

      <style jsx>{`
        :global(.vt-profile-cta) {
          align-self: flex-start;
          padding: 10px 16px;
          border-radius: 999px;
          background: var(--vt-accent, #fde68a);
          color: var(--vt-accent-on, #15151a);
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
          /* Gold gradient -- matches .vt-profile-action--primary and the rest
           * of the play-app gold CTAs. --vt-accent is the deprecated sky-blue
           * token (shell.css :root) so don't reach for it here. */
          background: linear-gradient(180deg, #fcd34d 0%, #f59e0b 100%);
          color: #15151a;
          font-weight: 800;
          border: 0;
          cursor: pointer;
          font-size: 15px;
          min-width: 140px;
          box-shadow: 0 8px 20px -10px rgba(220, 169, 75, 0.55);
          transition: background 120ms ease, transform 120ms ease;
        }
        :global(.vt-profile-save:hover:not([disabled])) {
          background: linear-gradient(180deg, #ffe084 0%, #ffae31 100%);
          transform: translateY(-1px);
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

        /* Profile-head action row — sits in the top-right of the
         * greeting section. Equal-width buttons; stacks vertically on
         * mobile where the section is narrow. */
        :global(.vt-profile-head) {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        @media (min-width: 720px) {
          :global(.vt-profile-head) {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
          }
          :global(.vt-profile-head-text) {
            flex: 1 1 auto;
            min-width: 0;
          }
        }
        :global(.vt-profile-head-text) {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        :global(.vt-profile-head-actions) {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
        }
        @media (min-width: 720px) {
          :global(.vt-profile-head-actions) {
            flex: 0 0 auto;
            flex-direction: row;
            align-items: stretch;
            width: auto;
          }
          :global(.vt-profile-head-actions .vt-profile-action) {
            min-width: 160px;
            width: auto;
          }
        }
        :global(.vt-profile-action) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 11px 16px;
          border-radius: 10px;
          border: 0;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 0.005em;
          cursor: pointer;
          text-decoration: none;
          text-align: center;
          font-family: inherit;
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
          width: 100%;
        }
        :global(.vt-profile-action--primary) {
          background: linear-gradient(180deg, #fcd34d 0%, #f59e0b 100%);
          color: #15151a;
          font-weight: 800;
          box-shadow: 0 8px 20px -10px rgba(220, 169, 75, 0.55);
        }
        :global(.vt-profile-action--primary:hover) {
          background: linear-gradient(180deg, #ffe084 0%, #ffae31 100%);
          transform: translateY(-1px);
        }
        :global(.vt-profile-action--ghost) {
          background: transparent;
          color: var(--vt-fg, #f4f4f5);
          border: 1px solid rgba(255, 255, 255, 0.18);
          font-weight: 600;
        }
        :global(.vt-profile-action--ghost:hover) {
          border-color: rgba(255, 255, 255, 0.32);
          background: rgba(255, 255, 255, 0.04);
        }
      `}</style>

      <PhoneLinkModal
        open={phoneLinkOpen}
        onClose={() => setPhoneLinkOpen(false)}
        onLinked={(updated) => {
          setServerUser(updated);
          setDraft(initialDraft(updated));
          setPhoneLinkOpen(false);
          setToast({ kind: "ok", text: "Phone linked ✓" });
          window.setTimeout(() => setToast(null), 2000);
        }}
      />
    </>
  );
}

/* ---------------- my pools ---------------- */

interface MyPool {
  readonly slug: string;
  readonly name: string;
  readonly role: "owner" | "member";
  readonly member_count: number;
}

interface MyPoolsState {
  status: "loading" | "ready" | "error";
  pools: MyPool[];
  message?: string;
}

function MyPoolsSection() {
  const t = useTranslations();
  const [state, setState] = useState<MyPoolsState>({
    status: "loading",
    pools: [],
  });

  // Deep-link scroll. The whole ProfilePage is a client component, so
  // by the time the <section id="profile-pools"> exists in the DOM the
  // browser has already given up on resolving the URL hash. Re-do the
  // scroll manually once after the section mounts. Honour
  // prefers-reduced-motion to match the in-page Manage button.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#profile-pools") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // One animation frame defer so the surrounding layout has settled
    // before we measure the section's position.
    const raf = window.requestAnimationFrame(() => {
      const target = document.getElementById("profile-pools");
      target?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        // Tim 2026-06-02: switched from /v1/syndicates/mine (owner-only)
        // to /v1/profile/syndicates which also returns pools the user
        // joined as a member. The owner-only list left users wondering
        // why pools they joined never showed up here.
        const r = await fetch("/api/v1/profile/syndicates", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: ac.signal,
        });
        if (!r.ok) {
          setState({
            status: "error",
            pools: [],
            message: r.status === 401 ? safeT(t, "profile_page.error_sign_in_to_pools", "Sign in to see your pools.") : `Server returned ${r.status}`,
          });
          return;
        }
        const body = (await r.json()) as { syndicates?: MyPool[] };
        setState({ status: "ready", pools: body.syndicates ?? [] });
      } catch (e) {
        if (ac.signal.aborted) return;
        setState({
          status: "error",
          pools: [],
          message: e instanceof Error ? e.message : "Network error",
        });
      }
    })();
    return () => ac.abort();
  }, [t]);

  return (
    <section className="vt-section" id="profile-pools">
      <h2 className="vt-section-title">{safeT(t, "profile_page.my_pools_section_title", "Pools I'm in")}</h2>
      <p style={{ color: "var(--vt-fg-muted)", margin: "0 0 12px", fontSize: 13 }}>
        {safeT(t, "profile_page.my_pools_description", "Pools you run or have joined. Owners can manage; members can view the leaderboard and other picks.")}
      </p>
      {state.status === "loading" ? (
        <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 13 }}>{safeT(t, "profile_page.my_pools_loading", "Loading…")}</p>
      ) : state.status === "error" ? (
        <p style={{ color: "var(--vt-danger, #ef4444)", margin: 0, fontSize: 13 }}>
          {state.message}
        </p>
      ) : state.pools.length === 0 ? (
        <div className="vt-mypools-empty">
          <p style={{ color: "var(--vt-fg-muted)", margin: "0 0 12px", fontSize: 13 }}>
            {safeT(t, "profile_page.my_pools_empty", "You haven't set up a pool yet. They're free for friend groups under 100 members.")}
          </p>
          <a href="/syndicates/new" className="vt-profile-cta vt-profile-cta--primary">
            {safeT(t, "profile_page.create_a_pool", "Create a pool")}
          </a>
        </div>
      ) : (
        <>
          <ul className="vt-mypools-list">
            {state.pools.map((p) => {
              const isOwner = p.role === "owner";
              const nameHref = isOwner ? `/dashboard/pools/${p.slug}` : `/s/${p.slug}`;
              return (
                <li key={p.slug} className="vt-mypools-row">
                  <div className="vt-mypools-row-main">
                    <a href={nameHref} className="vt-mypools-name">
                      {p.name}
                    </a>
                    <p className="vt-mypools-meta">
                      {p.member_count} {p.member_count === 1 ? safeT(t, "profile_page.my_pools_member_singular", "member") : safeT(t, "profile_page.my_pools_member_plural", "members")}
                      {" · "}
                      {isOwner
                        ? safeT(t, "profile_page.my_pools_role_owner", "Owner")
                        : safeT(t, "profile_page.my_pools_role_member", "Member")}
                    </p>
                  </div>
                  <div className="vt-mypools-actions">
                    {isOwner ? (
                      <>
                        <a
                          href={`/s/${p.slug}`}
                          className="vt-profile-cta vt-profile-cta--ghost"
                        >
                          {safeT(t, "profile_page.my_pools_share", "View")}
                        </a>
                        <a
                          href={`/dashboard/pools/${p.slug}`}
                          className="vt-profile-cta vt-profile-cta--primary"
                        >
                          {safeT(t, "profile_page.my_pools_manage", "Manage")}
                        </a>
                      </>
                    ) : (
                      <a
                        href={`/s/${p.slug}`}
                        className="vt-profile-cta vt-profile-cta--primary"
                      >
                        {safeT(t, "profile_page.my_pools_view", "View pool")}
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 12 }}>
            <a href="/syndicates/new" className="vt-profile-cta vt-profile-cta--ghost">
              {safeT(t, "profile_page.my_pools_new_pool_btn", "+ New pool")}
            </a>
          </div>
        </>
      )}
      <style jsx>{`
        .vt-mypools-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 8px;
        }
        .vt-mypools-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          background: var(--vt-surface-1, #1c1c22);
          border: 1px solid var(--vt-border, #2a2a31);
          border-radius: 10px;
        }
        .vt-mypools-row-main {
          min-width: 0;
          flex: 1 1 auto;
        }
        .vt-mypools-name {
          color: var(--vt-fg, #f4f4f5);
          text-decoration: none;
          font-weight: 700;
          font-size: 15px;
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vt-mypools-name:hover {
          color: var(--vt-gold-300, #fcd34d);
        }
        .vt-mypools-meta {
          margin: 2px 0 0;
          color: var(--vt-fg-muted, #9ca3af);
          font-size: 12px;
        }
        .vt-mypools-actions {
          display: flex;
          gap: 6px;
          flex: 0 0 auto;
        }
        @media (max-width: 480px) {
          .vt-mypools-row {
            flex-direction: column;
            align-items: stretch;
          }
          .vt-mypools-actions {
            justify-content: flex-end;
          }
        }
      `}</style>
    </section>
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
  // Tim 2026-06-04: email is intentionally NOT diffed. The auth-sms
  // PATCH /v1/auth/me silently strips email (SEC-AUTH-09) and the
  // verify-and-merge path doesn't exist yet, so submitting it here
  // would just be a wasted field. The Email input is rendered readOnly
  // above; tracked in IDEAS.md.
  cmp(server.country, draft.country, "country");
  cmp(server.city, draft.city, "city");
  cmp(server.favouriteTeamCode, draft.favouriteTeamCode, "favourite_team_code");
  return out;
}

function humaniseError(err: string, t: ReturnType<typeof useTranslations>): string {
  switch (err) {
    case "bad-email":
      return safeT(t, "profile_page.error_bad_email", "That email doesn't look right.");
    case "email-taken":
      return safeT(t, "profile_page.error_email_taken", "That email is already linked to another account.");
    case "display_name_taken":
      return safeT(t, "profile_page.error_display_name_taken", "Someone else already uses that display name. Pick a different one.");
    case "unauthorized":
      return safeT(t, "profile_page.error_unauthorized", "Your session expired. Sign in again to save changes.");
    case "network":
      return safeT(t, "profile_page.error_network", "Couldn't reach the profile service. Check your connection.");
    default:
      return safeT(t, "profile_page.error_generic", "Couldn't save changes. Try again.");
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
  const t = useTranslations();
  const sb = useMemo(() => browserClient(), []);
  return (
    <section className="vt-section">
      <h2 className="vt-section-title">{safeT(t, "profile_page.supabase_notice_title", "Profile")}</h2>
      <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
        {safeT(t, "profile_page.supabase_notice_lede", "You signed in through the legacy email flow. The new profile editor is only wired into the WhatsApp / SMS sign-in for now. Sign out and sign back in with WhatsApp to use it.")}
      </p>
      <button
        type="button"
        className="vt-profile-cta vt-profile-cta--ghost"
        onClick={() => {
          if (sb) void signOut();
        }}
      >
        {safeT(t, "profile_page.supabase_notice_sign_out", "Sign out")}
      </button>
    </section>
  );
}
