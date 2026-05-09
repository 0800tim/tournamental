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

export interface FunnelChartProps {
  steps: { step: string; users: number }[];
}

export function FunnelChart({ steps }: FunnelChartProps) {
  return (
    <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 h-96">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={steps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a2238" />
          <XAxis dataKey="step" stroke="#cdd5e7" fontSize={11} angle={-15} textAnchor="end" height={60} />
          <YAxis stroke="#cdd5e7" fontSize={11} />
          <Tooltip
            contentStyle={{
              background: "#101626",
              border: "1px solid #1a2238",
              borderRadius: 6,
              color: "#e7ecf7",
            }}
          />
          <Bar dataKey="users" fill="#5a96d8" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
