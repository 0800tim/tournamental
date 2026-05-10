"use client";

import { useState } from "react";
import type { OperatorRecord } from "@/lib/ops-store";

const KINDS: OperatorRecord["kind"][] = [
  "sportsbook",
  "prediction-market",
  "paytv-stream",
];

const STATUSES: OperatorRecord["status"][] = ["active", "paused"];

export function OperatorEditForm({
  operator,
  canWrite,
}: {
  operator: OperatorRecord;
  canWrite: boolean;
}) {
  const [form, setForm] = useState(operator);
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
      const res = await fetch(`/api/operators/${encodeURIComponent(form.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          kind: form.kind,
          affiliate_url_pattern: form.affiliate_url_pattern,
          geo_allow: form.geo_allow,
          geo_deny: form.geo_deny,
          revenue_share_pct: form.revenue_share_pct,
          status: form.status,
          contact_email: form.contact_email,
          notes: form.notes,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 422) {
          setError(`Compliance violation: ${body.reason ?? "rule failed"}`);
        } else if (res.status === 403) {
          setError("Forbidden: super-admin only.");
        } else {
          setError(`Update failed (${res.status}).`);
        }
        return;
      }
      const updated = (await res.json()) as OperatorRecord;
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
      <h2 className="text-sm uppercase tracking-wider text-ink-500">Edit operator</h2>

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
        Name
        <input
          type="text"
          value={form.name}
          disabled={fieldDisabled}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-200">
        Kind
        <select
          value={form.kind}
          disabled={fieldDisabled}
          onChange={(e) =>
            setForm({ ...form, kind: e.target.value as OperatorRecord["kind"] })
          }
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-200">
        Affiliate URL pattern
        <input
          type="text"
          value={form.affiliate_url_pattern}
          disabled={fieldDisabled}
          onChange={(e) => setForm({ ...form, affiliate_url_pattern: e.target.value })}
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm font-mono text-ink-50 disabled:opacity-50"
        />
      </label>

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

      <label className="flex flex-col gap-1 text-xs text-ink-200">
        Geo deny (NZ required for sportsbooks)
        <input
          type="text"
          value={csv(form.geo_deny)}
          disabled={fieldDisabled}
          onChange={(e) => setForm({ ...form, geo_deny: parseCsv(e.target.value) })}
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm font-mono text-ink-50 disabled:opacity-50"
        />
        {form.kind === "sportsbook" && !form.geo_deny.includes("NZ") && (
          <span className="text-xs text-danger-500">
            Sportsbook must include NZ in geo_deny (TAB monopoly).
          </span>
        )}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-200">
          Revenue share %
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={form.revenue_share_pct}
            disabled={fieldDisabled}
            onChange={(e) =>
              setForm({ ...form, revenue_share_pct: Number(e.target.value) })
            }
            className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-200">
          Status
          <select
            value={form.status}
            disabled={fieldDisabled}
            onChange={(e) =>
              setForm({ ...form, status: e.target.value as OperatorRecord["status"] })
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
      </div>

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
