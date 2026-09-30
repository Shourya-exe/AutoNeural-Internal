import { createHash } from "node:crypto";
import { addLeads, checkIntakeKey, mapRowToLead, pullLeadSources, type LeadInput } from "@/lib/leads";
import { retryFacebookLeads } from "@/lib/facebook";
import { failure } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public lead intake — website forms, Zapier/Make/Pabbly, Meta Lead Ads via Zapier,
 * landing pages or scripts add leads straight into the workspace.
 *
 *   POST /api/leads/intake
 *   Authorization: Bearer anl_…   (or a "key" field / ?key= for plain HTML forms)
 *   JSON  { "name", "phone", "email", "service", "message", "source", "externalId" }
 *         or { "leads": [ …up to 100… ] }
 *   Form  application/x-www-form-urlencoded with the same fields; "_redirect" (https)
 *         sends the visitor to a thank-you page. A filled "_gotcha" field is treated as spam.
 *
 *   GET  /api/leads/intake — runs the Google Sheet / IndiaMART pulls (each throttles
 *        itself) and retries queued Facebook leads, so a Hostinger cron can call it
 *        every few minutes.
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

// ponytail: per-process limiter; fine for one Passenger process.
const hits = new Map<number, number>();
function limited() {
  const minute = Math.floor(Date.now() / 60_000);
  for (const k of hits.keys()) if (k < minute) hits.delete(k);
  const n = (hits.get(minute) ?? 0) + 1;
  hits.set(minute, n);
  return n > 120;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    // Portals such as JustDial push each enquiry as a GET with the lead in the query string.
    if (q.get("key") && (q.get("mobile") || q.get("phone") || q.get("email"))) {
      if (!checkIntakeKey(q.get("key"))) return new Response("INVALID KEY", { status: 401 });
      const row = Object.fromEntries(q);
      const lead = mapRowToLead(row);
      if (!lead) return new Response("MISSING PHONE", { status: 422 });
      const id = row.leadid || row.lead_id || row.id || `${JSON.stringify(lead)}|${Math.floor(Date.now() / 60_000)}`;
      addLeads([{ ...lead, externalId: `push:${createHash("sha256").update(id).digest("hex").slice(0, 32)}`, sourceDetail: row.source || "JustDial / portal push" }], "Website / API");
      return new Response("RECEIVED", { headers: cors });
    }
    const [r, fb] = await Promise.all([pullLeadSources(), retryFacebookLeads()]);
    return json({ ok: true, created: r.sheets.created + r.indiamart.created + fb.created });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    const type = req.headers.get("content-type") ?? "";
    const isForm = type.includes("form");
    const text = await req.text();
    if (text.length > 1_000_000) return json({ error: "Body too large." }, 413);
    let data: Record<string, unknown>;
    try {
      data = isForm ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text);
    } catch {
      return json({ error: "Send JSON or a form post." }, 400);
    }
    if (!data || typeof data !== "object") return json({ error: "Send a lead object." }, 422);

    // Google Ads lead form webhook: { lead_id, user_column_data: [{ column_id, string_value }], google_key, is_test }
    if (Array.isArray(data.user_column_data)) {
      if (!checkIntakeKey(String(data.google_key ?? ""))) return json({ error: "Invalid google_key." }, 401);
      const row = Object.fromEntries(
        (data.user_column_data as { column_id?: string; column_name?: string; string_value?: string }[]).map((c) => [c.column_id || c.column_name || "", c.string_value ?? ""]),
      );
      const lead = mapRowToLead(row);
      if (!lead) return json({ error: "The lead has no phone or email." }, 400);
      addLeads(
        [{ ...lead, externalId: `gads:${String(data.lead_id ?? createHash("sha256").update(JSON.stringify(row)).digest("hex"))}`, sourceDetail: `Google Ads lead form${data.is_test ? " (test)" : ""}` }],
        "Website / API",
      );
      return json({}, 200);
    }

    const key =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
      new URL(req.url).searchParams.get("key") ||
      (typeof data.key === "string" ? data.key : "");
    if (!checkIntakeKey(key)) return json({ error: "Invalid or missing API key." }, 401);
    if (limited()) return json({ error: "Rate limit: 120 requests per minute." }, 429);

    const redirect = typeof data._redirect === "string" && data._redirect.startsWith("https://") ? data._redirect : null;
    const done = (body: unknown, status: number) => (redirect ? Response.redirect(redirect, 303) : json(body, status));
    if (data._gotcha) return done({ ok: true, accepted: 0, duplicates: 0, rejected: [] }, 200);

    const rows = Array.isArray(data.leads) ? (data.leads as Record<string, unknown>[]).slice(0, 100) : [data];
    const leads: LeadInput[] = [];
    const rejected: { index: number; error: string }[] = [];
    rows.forEach((row, index) => {
      const lead = row && typeof row === "object" ? mapRowToLead(row) : null;
      if (!lead) return rejected.push({ index, error: "A phone number or email is required." });
      const ext = typeof row.externalId === "string" && row.externalId.trim() ? row.externalId.trim().slice(0, 200) : null;
      // Without an externalId, identical content in the same minute is treated as a retry.
      const id = ext ?? `${JSON.stringify(lead)}|${Math.floor(Date.now() / 60_000)}`;
      const source = row.source ?? row.utm_source;
      leads.push({
        ...lead,
        externalId: `api:${createHash("sha256").update(id).digest("hex").slice(0, 32)}`,
        sourceDetail: typeof source === "string" && source.trim() ? source.trim().slice(0, 120) : isForm ? "Website form" : "Lead API",
      });
    });
    const r = addLeads(leads, "Website / API");
    return done({ ok: true, accepted: r.created, duplicates: r.duplicates, rejected }, r.created ? 201 : 200);
  } catch (e) {
    return failure(e);
  }
}
