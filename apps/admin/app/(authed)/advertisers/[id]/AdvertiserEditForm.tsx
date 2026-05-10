"use client";

import { useState } from "react";
import type { AdvertiserRecord } from "@/lib/ops-store";

const SURFACES: AdvertiserRecord["surface"][] = ["bracket", "leaderboard", "match"];
const STATUSES: AdvertiserRecord["status"][] = ["active", "paused"];

export function AdvertiserEditForm({
  advertiser,
  canWrite,
}: {
  advertiser: AdvertiserRecord;
  canWrite: boolean;
}) {
  const [form, setForm] = useState(advertiser);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function csv(v: string[]): string {
    return v.join(", ");
  }

  function parseCsv(s: string): string[] {
    return s
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/advertisers/${encodeURIComponent(form.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          surface: form.surface,
          tournament: form.tournament,
          geo_allow: form.geo_allow,
          status: form.status,
          ecpm_units: form.ecpm_units,
          fill_rate_pct: form.fill_rate_pct,
          flight_start: form.flight_start,
          flight_end: form.flight_end,
          contact_email: form.contact_email,
          creative_url: form.creative_url,
          notes: form.notes,
        }),
      });
      if (!res.ok) {
        if (res.status === 403) {
          setError("Forbidden: super-admin only.");
        } else {
          setError(`Update failed (${res.status}).`);
        }
        return;
      }
      const updated = (await res.json()) as AdvertiserRecord;
      setForm(updated);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const fieldDisabled = !canWrite || saving;

  return (
    <form
      onSubmit={submit}
      className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 flex flex-col gap-3"
    >
      <h2 className="text-sm uppercase tracking-wider text-ink-500">Edit campaign</h2>

      {error && (
        <div role="alert" className="text-xs text-danger-500">
          {error}
        </div>
      )}
      {saved && !error && (
        <div role="status" className="text-xs text-emerald-500">
          Saved.
        </div>
      )}

      <label className="flex flex-col gap-1 text-xs text-ink-200">
        Campaign name
        <input
          type="text"
          value={form.name}
          disabled={fieldDisabled}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-200">
          Surface
          <select
            value={form.surface}
            disabled={fieldDisabled}
            onChange={(e) =>
              setForm({ ...form, surface: e.target.value as AdvertiserRecord["surface"] })
            }
            className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
          >
            {SURFACES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-200">
          Tournament
          <input
            type="text"
            value={form.tournament}
            disabled={fieldDisabled}
            onChange={(e) => setForm({ ...form, tournament: e.target.value })}
            className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm font-mono text-ink-50 disabled:opacity-50"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-ink-200">
        Geo allow (ISO-3166 alpha-2, comma-separated)
        <input
          type="text"
          value={csv(form.geo_allow)}
          disabled={fieldDisabled}
          onChange={(e) => setForm({ ...form, geo_allow: parseCsv(e.target.value) })}
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm font-mono text-ink-50 disabled:opacity-50"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-200">
          eCPM (units)
          <input
            type="number"
            min={0}
            step={0.01}
            value={form.ecpm_units}
            disabled={fieldDisabled}
            onChange={(e) =>
              setForm({ ...form, ecpm_units: Number(e.target.value) })
            }
            className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-200">
          Fill rate %
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={form.fill_rate_pct}
            disabled={fieldDisabled}
            onChange={(e) =>
              setForm({ ...form, fill_rate_pct: Number(e.target.value) })
            }
            className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-200">
          Flight start
          <input
            type="date"
            value={form.flight_start}
            disabled={fieldDisabled}
            onChange={(e) => setForm({ ...form, flight_start: e.target.value })}
            className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-200">
          Flight end
          <input
            type="date"
            value={form.flight_end}
            disabled={fieldDisabled}
            onChange={(e) => setForm({ ...form, flight_end: e.target.value })}
            className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-ink-200">
        Status
        <select
          value={form.status}
          disabled={fieldDisabled}
          onChange={(e) =>
            setForm({ ...form, status: e.target.value as AdvertiserRecord["status"] })
          }
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-200">
        Contact email
        <input
          type="email"
          value={form.contact_email}
          disabled={fieldDisabled}
          onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-200">
        Creative URL
        <input
          type="url"
          value={form.creative_url}
          disabled={fieldDisabled}
          onChange={(e) => setForm({ ...form, creative_url: e.target.value })}
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm font-mono text-ink-50 disabled:opacity-50"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-200">
        Notes
        <textarea
          value={form.notes}
          disabled={fieldDisabled}
          rows={3}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
        />
      </label>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={fieldDisabled}
          className="px-3 py-1.5 rounded bg-accent-700 hover:bg-accent-600 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
