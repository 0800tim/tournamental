"use client";

import { useState } from "react";
import type { FeatureFlag } from "@/lib/api";
import type { Role } from "@/lib/perms";

export function FlagsList({ rows, role }: { rows: FeatureFlag[]; role: Role }) {
  const [list, setList] = useState(rows);
  const [error, setError] = useState<string | null>(null);
  const canWrite = role === "super-admin";

  return (
    <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 divide-y divide-ink-700">
      {error && (
        <div role="alert" className="px-4 py-2 text-xs text-danger-500">
          {error}
        </div>
      )}
      {list.map((f) => (
        <div key={f.key} className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-sm text-ink-50">{f.key}</div>
            <div className="text-xs text-ink-200">{f.description}</div>
            {Object.keys(f.geo_overrides).length > 0 && (
              <div className="text-xs text-flame-500 mt-1">
                Overrides:{" "}
                {Object.entries(f.geo_overrides)
                  .map(([k, v]) => `${k}=${v ? "on" : "off"}`)
                  .join(", ")}
              </div>
            )}
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-ink-200">{f.enabled ? "ON" : "off"}</span>
            <input
              type="checkbox"
              checked={f.enabled}
              disabled={!canWrite}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setError(null);
                const res = await fetch(`/api/feature-flags/${encodeURIComponent(f.key)}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ enabled }),
                });
                if (!res.ok) {
                  setError(`Toggle failed (${res.status}).`);
                  return;
                }
                setList((prev) =>
                  prev.map((p) => (p.key === f.key ? { ...p, enabled } : p)),
                );
              }}
              className="h-5 w-5 accent-accent-500 disabled:opacity-30"
              aria-label={`Toggle ${f.key}`}
            />
          </label>
        </div>
      ))}
    </div>
  );
}
