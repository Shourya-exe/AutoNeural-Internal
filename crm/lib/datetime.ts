import { formatInTimeZone } from "date-fns-tz";
import { env } from "./env";

/**
 * All timestamps are STORED in UTC (Prisma DateTime). This module is the only
 * place the display timezone (default Asia/Kolkata) is applied.
 */
export const DISPLAY_TZ = env.displayTimezone;

export function fmtDateTime(d: Date | string | null | undefined, tz = DISPLAY_TZ): string {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), tz, "dd MMM yyyy, HH:mm");
}

export function fmtDate(d: Date | string | null | undefined, tz = DISPLAY_TZ): string {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), tz, "dd MMM yyyy");
}

export function fmtTime(d: Date | string | null | undefined, tz = DISPLAY_TZ): string {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), tz, "HH:mm");
}

export function relativeTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const then = new Date(d).getTime();
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < min) return "just now";
  if (abs < hr) return `${Math.round(abs / min)}m ${suffix}`;
  if (abs < day) return `${Math.round(abs / hr)}h ${suffix}`;
  if (abs < 30 * day) return `${Math.round(abs / day)}d ${suffix}`;
  return fmtDate(d);
}

export function isOverdue(d: Date | string | null | undefined): boolean {
  if (!d) return false;
  return new Date(d).getTime() < Date.now();
}

/** Resolve a dashboard period string to a [from, to) UTC range. */
export function resolvePeriod(period: string | undefined): {
  from: Date;
  to: Date;
  label: string;
  key: string;
} {
  const to = new Date();
  const from = new Date();
  switch (period) {
    case "today":
      from.setHours(0, 0, 0, 0);
      return { from, to, label: "Today", key: "today" };
    case "7d":
      from.setDate(from.getDate() - 7);
      return { from, to, label: "Last 7 days", key: "7d" };
    case "90d":
      from.setDate(from.getDate() - 90);
      return { from, to, label: "Last 90 days", key: "90d" };
    case "mtd":
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      return { from, to, label: "Month to date", key: "mtd" };
    case "30d":
    default:
      from.setDate(from.getDate() - 30);
      return { from, to, label: "Last 30 days", key: "30d" };
  }
}

export const PERIOD_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "Month to date" },
  { key: "90d", label: "90 days" },
];
