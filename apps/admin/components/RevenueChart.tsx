"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface RevenueChartProps {
  data: { day: string; count: number }[];
  /** Y-axis label, eg "signups" or "revenue ($)" */
  metric?: string;
}

export function RevenueChart({ data, metric = "signups" }: RevenueChartProps) {
  return (
    <div
      className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 h-72"
      aria-label={`${metric} over time`}
    >
      <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
        Last 7 days — {metric}
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5a96d8" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#5a96d8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a2238" />
          <XAxis dataKey="day" stroke="#cdd5e7" fontSize={11} />
          <YAxis stroke="#cdd5e7" fontSize={11} />
          <Tooltip
            contentStyle={{
              background: "#101626",
              border: "1px solid #1a2238",
              borderRadius: 6,
              color: "#e7ecf7",
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="#5a96d8"
            fill="url(#revGradient)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
