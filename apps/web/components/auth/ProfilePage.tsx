"use client";

/**
 * Authenticated profile editor — replaces the old placeholder
 * `/profile` page when a Supabase user is signed in.
 *
 * Save model: optimistic UI. Each field is editable inline; on blur we
 * fire a Supabase update and surface a toast (success/failure). On
 * failure we roll back the local state to the last-known-good value.
 *
 * Guest view: shows the SignupModal trigger and a short pitch instead.
 * Unconfigured view: same pitch but the modal banner explains that
 * sign-in is deferred.
 */

import { useEffect, useState } from "react";

import { browserClient } from "@/lib/auth/supabase";
import { useUser } from "@/lib/auth/useUser";
import { signOut } from "@/lib/auth/signIn";
import { SignupModal } from "./SignupModal";
import type {
  AgeBucket,
  EngagementBand,
  Gender,
  UserProfile,
  WatchesVia,
} from "@/lib/auth/types";

const AGE_BUCKETS: AgeBucket[] = [
  "<18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+",
];

const GENDERS: Gender[] = [
  "male",
  "female",
  "non-binary",
  "prefer-not-to-say",
];

const WATCH_OPTIONS: WatchesVia[] = [
  "streaming",
  "free-to-air",
  "stadium",
  "highlights",
  "mixed",
];

const ENGAGEMENT_TONE: Record<EngagementBand, string> = {
  cold: "Just visiting",
  warm: "Locked in",
  hot: "Superfan",
};

export function ProfilePage() {
  const { status, user, profile, loading, refresh } = useUser();
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
            style={{
              alignSelf: "flex-start",
              padding: "10px 16px",
              borderRadius: 999,
              background: "var(--vt-accent)",
              color: "var(--vt-accent-on)",
              fontWeight: 700,
              border: 0,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Sign in
          </button>
        </section>
        <SignupModal open={showModal} onClose={() => setShowModal(false)} />
      </>
    );
  }

  if (!profile || !user) {
    return (
      <section className="vt-section">
        <h2 className="vt-section-title">Profile</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
          We couldn&apos;t load your profile. Try refreshing the page.
        </p>
      </section>
    );
  }

  return <ProfileEditor profile={profile} email={user.email} onChange={refresh} />;
}

interface ProfileEditorProps {
  readonly profile: UserProfile;
  readonly email: string | null;
  readonly onChange: () => Promise<void>;
}

function ProfileEditor({ profile, email, onChange }: ProfileEditorProps) {
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const save = async (patch: Partial<UserProfile>) => {
    const sb = browserClient();
    if (!sb) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    const { error } = await sb
      .from("user_profiles")
      .update(patch)
      .eq("id", profile.id);
    if (error) {
      setDraft(profile);
      setToast({ kind: "err", text: "Couldn't save — please try again." });
      window.setTimeout(() => setToast(null), 2500);
      return;
    }
    setToast({ kind: "ok", text: "Saved" });
    window.setTimeout(() => setToast(null), 1500);
    await onChange();
  };

  return (
    <>
      <section className="vt-section">
        <h2 className="vt-section-title">{draft.display_name || draft.handle}</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 14 }}>
          {ENGAGEMENT_TONE[draft.engagement_band]} ·
          {draft.country_code ? ` ${draft.country_code}` : ""} · joined{" "}
          {new Date(draft.created_at).toLocaleDateString()}
        </p>
        {email && (
          <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 13 }}>
            {email}
          </p>
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
        <h2 className="vt-section-title">Display</h2>
        <Field label="Handle">
          <input
            className="auth-input"
            type="text"
            value={draft.handle}
            onChange={(e) => setDraft({ ...draft, handle: e.target.value })}
            onBlur={(e) => {
              if (e.target.value !== profile.handle) {
                void save({ handle: e.target.value });
              }
            }}
            maxLength={20}
            pattern="[a-z0-9_]{3,20}"
          />
        </Field>
        <Field label="Display name">
          <input
            className="auth-input"
            type="text"
            value={draft.display_name ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, display_name: e.target.value || null })
            }
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v !== profile.display_name) void save({ display_name: v });
            }}
            maxLength={50}
          />
        </Field>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">About you</h2>
        <Field label="Age">
          <select
            className="auth-input"
            value={draft.age_bucket ?? ""}
            onChange={(e) =>
              void save({ age_bucket: (e.target.value || null) as AgeBucket | null })
            }
          >
            <option value="">prefer not to say</option>
            {AGE_BUCKETS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gender">
          <select
            className="auth-input"
            value={draft.gender ?? ""}
            onChange={(e) =>
              void save({ gender: (e.target.value || null) as Gender | null })
            }
          >
            <option value="">prefer not to say</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Country (ISO-2)">
          <input
            className="auth-input"
            type="text"
            value={draft.country_code ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, country_code: e.target.value || null })
            }
            onBlur={(e) => {
              const v = e.target.value ? e.target.value.toUpperCase() : null;
              if (v !== profile.country_code) void save({ country_code: v });
            }}
            maxLength={2}
            placeholder="NZ"
          />
        </Field>
        <Field label="City">
          <input
            className="auth-input"
            type="text"
            value={draft.city ?? ""}
            onChange={(e) => setDraft({ ...draft, city: e.target.value || null })}
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v !== profile.city) void save({ city: v });
            }}
            maxLength={64}
            placeholder="Auckland"
          />
        </Field>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">Football</h2>
        <Field label="Favourite team (FIFA code)">
          <input
            className="auth-input"
            type="text"
            value={draft.favourite_team_code ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                favourite_team_code: e.target.value || null,
              })
            }
            onBlur={(e) => {
              const v = e.target.value ? e.target.value.toUpperCase() : null;
              if (v !== profile.favourite_team_code)
                void save({ favourite_team_code: v });
            }}
            maxLength={3}
            placeholder="ARG"
          />
        </Field>
        <Field label="I watch via">
          <select
            className="auth-input"
            value={draft.watches_via ?? ""}
            onChange={(e) =>
              void save({
                watches_via: (e.target.value || null) as WatchesVia | null,
              })
            }
          >
            <option value="">no preference</option>
            {WATCH_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">Privacy</h2>
        <CheckboxField
          label="Send me marketing updates"
          checked={draft.marketing_consent}
          onChange={(v) => void save({ marketing_consent: v })}
        />
        <CheckboxField
          label="Allow analytics on my usage"
          checked={draft.analytics_consent}
          onChange={(v) => void save({ analytics_consent: v })}
        />
        <CheckboxField
          label="Find friends via my phone contacts (hashed)"
          checked={draft.phone_match_consent}
          onChange={(v) => void save({ phone_match_consent: v })}
        />
      </section>

      <section className="vt-section">
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          style={{
            alignSelf: "flex-start",
            padding: "10px 16px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.06)",
            color: "var(--vt-fg)",
            fontWeight: 600,
            border: "1px solid rgba(255,255,255,0.12)",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Sign out
        </button>
      </section>
    </>
  );
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

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 14,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
