"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const GOLD = "#8C1C2B"; // maroon
const TOOLTIP = {
  borderRadius: 12,
  border: "1px solid rgba(140,28,43,0.3)",
  background: "rgba(255,252,248,0.97)",
  color: "#24101A",
  fontSize: 12,
};
const CHAMPAGNE = "#C98895"; // dusty rose

export function SourceVolumeChart({
  data,
}: {
  data: { source: string; label: string; count: number }[];
}) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={92}
          tick={{ fontSize: 11, fill: "#7A5B62" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(140,28,43,0.1)" }}
          contentStyle={TOOLTIP}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} fill={GOLD} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StageDistributionChart({
  data,
}: {
  data: { name: string; count: number; isWon: boolean; isLost: boolean }[];
}) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: -18, right: 8, top: 8 }}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: "#7A5B62" }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={54}
        />
        <YAxis tick={{ fontSize: 11, fill: "#7A5B62" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "rgba(140,28,43,0.1)" }}
          contentStyle={TOOLTIP}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={26}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.isWon ? "#0F7A52" : d.isLost ? "#C0392B" : i % 2 ? CHAMPAGNE : GOLD}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Empty() {
  return (
    <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
      No data in this period.
    </div>
  );
}
