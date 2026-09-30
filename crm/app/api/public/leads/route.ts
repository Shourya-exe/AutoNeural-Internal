import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { mapRowToLead, type LeadSourcePayload } from "@/server/integrations/lead-sources";
import { organizationForIntakeKey, recordLeadEvents } from "@/server/services/lead-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lead intake API — lets Zapier, Pabbly, Make, JustDial/99acres exports, landing
 * page builders or any script add leads automatically.
 *
 *   POST /api/public/leads
 *   Authorization: Bearer anl_…            (Settings → Integrations → Lead intake API)
 *   { "name": "…", "phone": "…", "email": "…", "service": "…", "message": "…",
 *     "source": "Zapier – Google Ads form", "externalId": "optional-stable-id" }
 *   or { "leads": [ …up to 100… ] }
 *
 * Field names are matched loosely (e.g. "full_name", "mobile", "phone_number"),
 * so most tools can post their native payload unchanged. Leads then go through
 * the normal pipeline: identity match, dedupe, assignment and automations.
 */
const item = z.record(z.unknown());
const body = z.union([z.object({ leads: z.array(item).min(1).max(100) }), item]);

export async function POST(req: NextRequest) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const organizationId = key ? await organizationForIntakeKey(key) : null;
  if (!organizationId) {
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }
  const limit = rateLimit(`lead-api:${organizationId}`, 120);
  if (!limit.ok) {
    return NextResponse.json({ error: "Rate limit: 120 requests per minute." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let json: unknown;
  try {
    json = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Send a lead object or { leads: [...] } with at most 100 leads." }, { status: 422 });
  }
  const rows = "leads" in parsed.data && Array.isArray(parsed.data.leads) ? parsed.data.leads : [parsed.data];

  const payloads: LeadSourcePayload[] = [];
  const rejected: { index: number; error: string }[] = [];
  rows.forEach((row, index) => {
    const lead = mapRowToLead(row as Record<string, unknown>);
    if (!lead) {
      rejected.push({ index, error: "A phone number or email is required." });
      return;
    }
    const r = row as Record<string, unknown>;
    const externalId = typeof r.externalId === "string" && r.externalId.trim() ? r.externalId.trim().slice(0, 200) : null;
    // Without an externalId, identical content within the same minute is treated as a retry.
    const id = externalId ?? `${JSON.stringify(lead)}|${Math.floor(Date.now() / 60_000)}`;
    payloads.push({
      ...lead,
      _id: `api:${createHash("sha256").update(id).digest("hex").slice(0, 32)}`,
      sourceDetail: typeof r.source === "string" && r.source.trim() ? r.source.trim().slice(0, 120) : "Lead intake API",
    });
  });

  try {
    const { created, duplicates } = await recordLeadEvents(organizationId, "LEAD_API", payloads);
    return NextResponse.json({ ok: true, accepted: created, duplicates, rejected }, { status: created ? 201 : 200 });
  } catch (e) {
    console.error("[lead-api] failed to persist", e);
    return NextResponse.json({ error: "Storage failure; retry later." }, { status: 500 });
  }
}
