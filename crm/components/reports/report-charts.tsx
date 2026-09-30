"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

const GOLD = "#8C1C2B"; // maroon
const CHAMPAGNE = "#C98895"; // dusty rose

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid rgba(140,28,43,0.3)",
  background: "rgba(255,252,248,0.97)",
  color: "#24101A",
  fontSize: 12,
};

export function ConversionFunnel({
  data,
}: {
  data: { name: string; reached: number; rateFromStart: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ left: 12, right: 24 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={104}
          tick={{ fontSize: 11, fill: "#7A5B62" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(140,28,43,0.1)" }}
          contentStyle={tooltipStyle}
          formatter={(v: any, _n, p: any) => [`${v} leads (${p.payload.rateFromStart}%)`, "Reached"]}
        />
        <Bar dataKey="reached" radius={[0, 6, 6, 0]} barSize={18}>
          {data.map((_, i) => (
            <Cell key={i} fill={i % 2 ? CHAMPAGNE : GOLD} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function WorkloadChart({
  data,
}: {
  data: { name: string; openLeads: number; overdueTasks: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ left: -18, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,16,26,0.1)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: "#7A5B62" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: "#7A5B62" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: "rgba(140,28,43,0.1)" }} contentStyle={tooltipStyle} />
        <Bar dataKey="openLeads" name="Open leads" fill={GOLD} radius={[6, 6, 0, 0]} barSize={20} />
        <Bar
          dataKey="overdueTasks"
          name="Overdue tasks"
          fill="#C0392B"
          radius={[6, 6, 0, 0]}
          barSize={20}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChannelChart({
  data,
}: {
  data: { label: string; total: number; won: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ left: -18, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,16,26,0.1)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: "#7A5B62" }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-18}
          textAnchor="end"
          height={56}
        />
        <YAxis tick={{ fontSize: 11, fill: "#7A5B62" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: "rgba(140,28,43,0.1)" }} contentStyle={tooltipStyle} />
        <Bar dataKey="total" name="Leads" fill={CHAMPAGNE} radius={[6, 6, 0, 0]} barSize={18} />
        <Bar dataKey="won" name="Won" fill="#0F7A52" radius={[6, 6, 0, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
