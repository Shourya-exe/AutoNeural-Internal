import { env } from "./env";

const fmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: env.currency || "INR",
  maximumFractionDigits: 0,
});

const fmtCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: env.currency || "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

type Num = number | string | { toString(): string } | null | undefined;

function toNumber(v: Num): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

export function money(v: Num): string {
  return fmt.format(toNumber(v));
}

export function moneyCompact(v: Num): string {
  return fmtCompact.format(toNumber(v));
}
