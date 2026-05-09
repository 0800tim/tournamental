import type { ReactNode } from "react";

export interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { sign: "up" | "down" | "flat"; pct: number; window?: string };
  hint?: ReactNode;
  tone?: "default" | "danger" | "good";
}

const TONE_RING: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "ring-ink-700",
  danger: "ring-danger-500/40",
  good: "ring-emerald-500/40",
};

export function StatCard({ label, value, delta, hint, tone = "default" }: StatCardProps) {
  return (
    <div
      className={`rounded-lg bg-ink-800 ring-1 ${TONE_RING[tone]} p-4 flex flex-col gap-1`}
      role="group"
      aria-label={label}
    >
      <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
      <div className="text-2xl font-display font-semibold text-ink-50">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {delta && (
        <div
          className={`text-xs ${
            delta.sign === "up"
              ? "text-emerald-500"
              : delta.sign === "down"
                ? "text-danger-500"
                : "text-ink-200"
          }`}
        >
          {delta.sign === "up" ? "+" : delta.sign === "down" ? "-" : ""}
          {delta.pct.toFixed(1)}%
          {delta.window ? <span className="text-ink-500"> {delta.window}</span> : null}
        </div>
      )}
      {hint && <div className="text-xs text-ink-200">{hint}</div>}
    </div>
  );
}
