/**
 * Lightweight country-distribution chart. We deliberately avoid pulling in
 * a real world-map library here — the admin overview only needs a quick
 * "where are users coming from" glance, and a horizontal bar chart by
 * ISO-2 country code is faster to render and easier to read at a glance.
 *
 * Uses Recharts (already a dep) and keeps everything client-side.
 */

"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface GeoMapProps {
  data: { country: string; users: number }[];
}

export function GeoMap({ data }: GeoMapProps) {
  return (
    <div
      className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 h-72"
      aria-label="User distribution by country"
    >
      <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
        Users by country
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a2238" />
          <XAxis type="number" stroke="#cdd5e7" fontSize={11} />
          <YAxis
            type="category"
            dataKey="country"
            stroke="#cdd5e7"
            fontSize={11}
            width={32}
          />
          <Tooltip
            contentStyle={{
              background: "#101626",
              border: "1px solid #1a2238",
              borderRadius: 6,
              color: "#e7ecf7",
            }}
          />
          <Bar dataKey="users" fill="#5a96d8" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
