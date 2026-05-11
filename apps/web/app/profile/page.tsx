/**
 * /profile — rich profile page.
 *
 * Shows the user's current profile in three bands:
 *   1. Identity (handle, display name, country, city, timezone).
 *   2. Engagement (band chip, visit count, last-visit date).
 *   3. Demographic + football (age bucket, gender, watches via,
 *      favourite team, follows leagues).
 *   4. Consent (marketing email opt-in, analytics opt-out).
 *   5. Account actions (export data, delete account).
 *
 * For a signed-out user the page renders the same `SignupModal` the
 * AppShell uses, so the flow is consistent across surfaces.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { SignupModal } from "@/components/auth/SignupModal";
import { AppShell } from "@/components/shell";
import { PillChip } from "@/components/ui";
import {
  deleteUser,
  downloadDataExport,
  patchProfile,
  type ProfilePatchInput,
} from "@/lib/user/api";
import { pushDataLayer } from "@/lib/user/storage";
import { useCurrentUser } from "@/lib/user/useCurrentUser";

const AGE_BUCKETS = [
  "<18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+",
] as const;

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non-binary", label: "Non-binary" },
  { value: "prefer-not-to-say", label: "Prefer not to say" },
];

const WATCHES_VIA = [
  { value: "tv", label: "TV" },
  { value: "streaming", label: "Streaming" },
  { value: "in-person", label: "In person" },
  { value: "highlights", label: "Highlights" },
];

function ChipRow({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: string; label: string } | string>;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div className="vsm-tabs">
      {options.map((opt) => {
        const v = typeof opt === "string" ? opt : opt.value;
        const label = typeof opt === "string" ? opt : opt.label;
        return (
          <button
            key={v}
            type="button"
            className="vsm-tab"
            aria-pressed={value === v}
            onClick={() => onChange(value === v ? null : v)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function ProfilePage() {
  const { user, profile, isLoading, isHydrated, refresh, signOutLocally } =
    useCurrentUser();
  const [signupOpen, setSignupOpen] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Open sign-up automatically if the user lands on /profile signed-out.
  useEffect(() => {
    if (isHydrated && !user) setSignupOpen(true);
  }, [isHydrated, user]);

  const initials = useMemo(() => {
    if (!user) return "T";
    const h = user.handle ?? "T";
    return h.slice(0, 2).toUpperCase();
  }, [user]);

  const onPatch = useCallback(
    async (field: string, patch: ProfilePatchInput) => {
      if (!user) return;
      setSavingField(field);
      setError(null);
      try {
        await patchProfile(user.id, patch);
        await refresh();
      } catch {
        setError("Couldn't save that. Try again in a moment.");
      } finally {
        setSavingField(null);
      }
    },
    [refresh, user],
  );

  const onExport = useCallback(async () => {
    if (!user) return;
    try {
      const data = await downloadDataExport(user.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tournamental-profile-${user.handle}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't download your data. Try again later.");
    }
  }, [user]);

  const onDelete = useCallback(async () => {
    if (!user) return;
    const ok = window.confirm(
      "This soft-deletes your profile and scrubs your data. You can re-register after 30 days. Continue?",
    );
    if (!ok) return;
    try {
      await deleteUser(user.id);
      signOutLocally();
      pushDataLayer("tournamental.profile.deleted", { user_id: user.id });
    } catch {
      setError("Couldn't delete your profile. Try again later.");
    }
  }, [signOutLocally, user]);

  if (!isHydrated) {
    return (
      <AppShell title="Profile" avatarInitials="T">
        <div className="vt-page-content">
          <p style={{ color: "var(--vt-fg-muted)" }}>Loading your profile…</p>
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell title="Profile" avatarInitials="T">
        <div className="vt-page-content">
          <section className="vt-section">
            <h2 className="vt-section-title">Sign in</h2>
            <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
              Pick a handle to save your bracket and join a leaderboard. It
              takes less than 30 seconds.
            </p>
            <button
              type="button"
              className="vsm-btn vsm-btn-primary"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setSignupOpen(true)}
            >
              Sign up
            </button>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <PillChip tone="accent">Telegram</PillChip>
              <PillChip tone="warm">Email · soon</PillChip>
              <PillChip tone="pitch">SMS · soon</PillChip>
            </div>
          </section>
        </div>
        <SignupModal
          open={signupOpen}
          onClose={() => setSignupOpen(false)}
          onComplete={() => {
            setSignupOpen(false);
            void refresh();
          }}
        />
      </AppShell>
    );
  }

  const p = profile?.profile;

  return (
    <AppShell title="Profile" avatarInitials={initials}>
      <div className="vt-page-content">
        <section className="vt-section">
          <h2 className="vt-section-title">@{user.handle}</h2>
          {profile ? (
            <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
              {profile.user.display_name ?? "No display name yet"}
              {profile.user.created_at
                ? ` · joined ${new Date(profile.user.created_at).toLocaleDateString()}`
                : ""}
            </p>
          ) : (
            <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
              {isLoading ? "Syncing profile…" : "Profile not loaded."}
            </p>
          )}
        </section>

        {p ? (
          <>
            <section className="vt-section">
              <h2 className="vt-section-title">
                Engagement{" "}
                <button
                  type="button"
                  aria-label="What is this?"
                  className="vsm-tab"
                  style={{
                    padding: "0 8px",
                    minWidth: "auto",
                    flex: "none",
                    fontSize: 12,
                  }}
                  onClick={() => setShowHelp((v) => !v)}
                >
                  ?
                </button>
              </h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <PillChip
                  tone={
                    p.engagement_band === "hot"
                      ? "warm"
                      : p.engagement_band === "warm"
                      ? "accent"
                      : "pitch"
                  }
                >
                  {p.engagement_band.toUpperCase()}
                </PillChip>
                <PillChip>{p.visit_count} visits</PillChip>
                {p.last_visit_date ? (
                  <PillChip>last seen {p.last_visit_date}</PillChip>
                ) : null}
              </div>
              {showHelp ? (
                <p className="vsm-hint" style={{ marginTop: 8 }}>
                  Cold: under 3 visits · Warm: 3–9 visits or last visit over
                  a week ago · Hot: 10+ visits within the last week.
                </p>
              ) : null}
            </section>

            <section className="vt-section">
              <h2 className="vt-section-title">Where you&apos;re from</h2>
              <label className="vsm-section-label" htmlFor="profile-country">
                Country
              </label>
              <input
                id="profile-country"
                className="vsm-input"
                maxLength={2}
                placeholder="NZ"
                defaultValue={p.country_code ?? ""}
                onBlur={(e) => {
                  const next = e.target.value.toUpperCase();
                  if (next === (p.country_code ?? "")) return;
                  void onPatch("country_code", { country_code: next || null });
                }}
              />
              <label className="vsm-section-label" htmlFor="profile-city">
                City
              </label>
              <input
                id="profile-city"
                className="vsm-input"
                placeholder="Wellington"
                defaultValue={p.city ?? ""}
                onBlur={(e) => {
                  const next = e.target.value;
                  if (next === (p.city ?? "")) return;
                  void onPatch("city", { city: next || null });
                }}
              />
              <p className="vsm-hint">
                Timezone (auto): {p.timezone ?? "not set"}.
              </p>
            </section>

            <section className="vt-section">
              <h2 className="vt-section-title">About you</h2>
              <p className="vsm-hint">
                Optional — share to improve your recommendations.
              </p>
              <span className="vsm-section-label">Age</span>
              <ChipRow
                options={AGE_BUCKETS as unknown as string[]}
                value={p.age_bucket}
                onChange={(next) => onPatch("age_bucket", { age_bucket: next })}
              />
              <span className="vsm-section-label">Gender</span>
              <ChipRow
                options={GENDERS}
                value={p.gender}
                onChange={(next) => onPatch("gender", { gender: next })}
              />
              <span className="vsm-section-label">How you watch</span>
              <ChipRow
                options={WATCHES_VIA}
                value={p.watches_via}
                onChange={(next) =>
                  onPatch("watches_via", { watches_via: next })
                }
              />
              <label className="vsm-section-label" htmlFor="profile-fav">
                Favourite team (FIFA-3 code)
              </label>
              <input
                id="profile-fav"
                className="vsm-input"
                maxLength={3}
                placeholder="ARG"
                defaultValue={p.favourite_team_code ?? ""}
                onBlur={(e) => {
                  const next = e.target.value.toUpperCase();
                  if (next === (p.favourite_team_code ?? "")) return;
                  void onPatch("favourite_team_code", {
                    favourite_team_code: next || null,
                  });
                }}
              />
            </section>

            <section className="vt-section">
              <h2 className="vt-section-title">Consent</h2>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                }}
              >
                <input
                  type="checkbox"
                  checked={p.marketing_consent}
                  onChange={(e) =>
                    onPatch("marketing_consent", {
                      marketing_consent: e.target.checked,
                    })
                  }
                />
                <span>Email me product updates and kickoff alerts</span>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                }}
              >
                <input
                  type="checkbox"
                  checked={p.analytics_consent}
                  onChange={(e) =>
                    onPatch("analytics_consent", {
                      analytics_consent: e.target.checked,
                    })
                  }
                />
                <span>Allow anonymous analytics (helps us improve the app)</span>
              </label>
            </section>

            <section className="vt-section">
              <h2 className="vt-section-title">Account</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="vsm-btn vsm-btn-secondary"
                  style={{ flex: "0 1 auto" }}
                  onClick={() => {
                    void onExport();
                  }}
                >
                  Export my data
                </button>
                <button
                  type="button"
                  className="vsm-btn vsm-btn-secondary"
                  style={{ flex: "0 1 auto" }}
                  onClick={signOutLocally}
                >
                  Sign out
                </button>
                <button
                  type="button"
                  className="vsm-btn vsm-btn-secondary"
                  style={{ flex: "0 1 auto", color: "#f87171" }}
                  onClick={() => {
                    void onDelete();
                  }}
                >
                  Delete account
                </button>
              </div>
              <p className="vsm-hint">
                Deleting your account scrubs PII immediately and removes the
                row 30 days later.
              </p>
            </section>

            {savingField ? (
              <p className="vsm-hint">Saving {savingField}…</p>
            ) : null}
            {error ? <p className="vsm-error">{error}</p> : null}
          </>
        ) : (
          <section className="vt-section">
            <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
              Couldn&apos;t load profile right now.{" "}
              <Link href="/profile">Retry</Link>
            </p>
          </section>
        )}
      </div>
      <SignupModal
        open={signupOpen}
        onClose={() => setSignupOpen(false)}
        onComplete={() => {
          setSignupOpen(false);
          void refresh();
        }}
      />
    </AppShell>
  );
}
