import { z } from "zod";
import { requireAdmin } from "./store";
import { ldb } from "./leads";
import { audit, usageSince, type UsageKind } from "./platform";
import type { User } from "./types";

/**
 * Settings → Usage: metered AI credits, voice minutes and WhatsApp messages, priced with a
 * dated rate card the admin maintains (Meta and telecom rates change, so nothing is
 * hard-coded), plus monthly budgets that stop AI spend when reached.
 */

const rateSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  voicePerMinute: z.number().min(0).nullable(),
  aiCredit: z.number().min(0).nullable(),
  waMarketing: z.number().min(0).nullable(),
  waUtility: z.number().min(0).nullable(),
  waService: z.number().min(0).nullable(),
});
export type RateCard = z.infer<typeof rateSchema>;
const setting = <T>(key: string, fallback: T): T => {
  const row = ldb().prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
};
const put = (key: string, v: unknown) => ldb().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(v));

export const rateCards = () => setting<RateCard[]>("rate_cards", []);
/** The card in force today (latest effectiveFrom ≤ today). */
export function currentRates(): RateCard {
  const today = new Date().toISOString().slice(0, 10);
  return rateCards().filter((r) => r.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? { effectiveFrom: today, voicePerMinute: null, aiCredit: null, waMarketing: null, waUtility: null, waService: 0 };
}

export function addRateCard(user: User, input: unknown) {
  requireAdmin(user);
  const r = rateSchema.parse(input);
  put("rate_cards", [...rateCards().filter((c) => c.effectiveFrom !== r.effectiveFrom), r]);
  audit(user.name, "usage.rate_card", null, null, r);
}

export function saveBudgets(user: User, input: unknown) {
  requireAdmin(user);
  const b = z.object({ aiCreditsPerMonth: z.number().int().min(0).nullable(), voiceMinutesPerMonth: z.number().int().min(0).nullable() }).parse(input);
  put("budgets", b);
  audit(user.name, "usage.budgets", null, null, b);
}

const priceOf = (kind: UsageKind, r: RateCard) =>
  ({ ai_credit: r.aiCredit, voice_minute: r.voicePerMinute, whatsapp_marketing: r.waMarketing, whatsapp_utility: r.waUtility, whatsapp_service: r.waService, email: 0 })[kind];

export function usageReport(user: User, month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7)) {
  requireAdmin(user);
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.").parse(month);
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const r = currentRates();
  const rows = usageSince(`${month}-01`, `${next}-01`).map((u) => {
    const unit = priceOf(u.kind, r);
    return { ...u, unit, cost: unit == null ? null : Math.round(u.quantity * unit * 100) / 100 };
  });
  return { month, rows, rates: r, rateCards: rateCards(), budgets: setting("budgets", { aiCreditsPerMonth: null, voiceMinutesPerMonth: null }) };
}
