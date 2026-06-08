"use client";

/**
 * Leaderboard badge: "🔥 N bots still on a perfect track after match X".
 *
 * Polls /api/v1/perfect-track (edge-cached) once on mount and
 * surfaces the rolled-up summary. Renders nothing when no rows exist.
 *
 * Spec: A13 task brief , leaderboard UI badge for perfect-track alerts.
 */
import { useEffect, useState } from "react";

interface PerfectTrackSummary {
  highest_match: number | null;
  total_alive: number;
  operator_count: number;
}

export function PerfectTrackBadge(): JSX.Element | null {
  const [data, setData] = useState<PerfectTrackSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/perfect-track", {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as PerfectTrackSummary;
        if (!cancelled) setData(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || !data.highest_match || data.total_alive <= 0) return null;

  return (
    <aside
      className="vt-perfect-track-badge"
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        background: "rgba(246, 198, 79, 0.12)",
        border: "1px solid rgba(246, 198, 79, 0.45)",
        borderRadius: 8,
        color: "#f6c64f",
        fontFamily:
          '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
        fontSize: 13,
        letterSpacing: "0.02em",
      }}
      aria-live="polite"
    >
      <span aria-hidden="true">🔥</span>
      <span>
        <strong>{data.total_alive.toLocaleString("en-NZ")}</strong> bots
        still on a perfect track after match{" "}
        <strong>{data.highest_match}</strong>
        {data.operator_count > 1 && (
          <> across {data.operator_count} operators</>
        )}
      </span>
    </aside>
  );
}
