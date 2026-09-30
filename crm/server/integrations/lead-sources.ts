import type { Channel } from "@prisma/client";
import type { ChannelAdapter, NormalizedEvent, SimulatedInput } from "./types";

/**
 * Automatic lead sources that the CRM PULLS (sheet/CSV feeds, IndiaMART) or that
 * push through an API key (LEAD_API). They all store the same normalized
 * payload on the WebhookEvent, so one adapter shape covers them and every lead
 * still flows through the standard ingestion pipeline: identity resolution,
 * dedupe, assignment, automations and audit.
 */

export interface LeadSourcePayload {
  _id: string; // provider event id
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  service?: string;
  message?: string;
  city?: string;
  campaign?: string;
  sourceDetail?: string; // e.g. "Sheet: Facebook leads", "IndiaMART · Direct enquiry"
  formName?: string;
}

// Header aliases, compared after lower-casing and stripping non-alphanumerics.
// Covers hand-made sheets, Facebook/Instagram lead-form exports and common CRMs.
const ALIASES: Record<Exclude<keyof LeadSourcePayload, "_id" | "sourceDetail">, string[]> = {
  name: ["name", "fullname", "leadname", "contactname", "customername", "firstname", "sendername", "clientname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "mobileno", "whatsapp", "whatsappnumber", "contactnumber", "sendermobile", "contactno", "phoneno"],
  email: ["email", "emailaddress", "emailid", "mail", "senderemail"],
  company: ["company", "companyname", "business", "businessname", "organisation", "organization", "sendercompany", "firm"],
  service: ["service", "interest", "interestedin", "product", "productname", "requirement", "queryproductname", "course"],
  message: ["message", "comments", "comment", "notes", "enquiry", "inquiry", "querymessage", "remarks", "question"],
  city: ["city", "location", "sendercity", "town"],
  campaign: ["campaign", "campaignname", "utmcampaign", "adname", "adsetname"],
  formName: ["formname", "form"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map an arbitrary row (header -> value) onto lead fields. Returns null when unusable. */
export function mapRowToLead(row: Record<string, unknown>): Omit<LeadSourcePayload, "_id" | "sourceDetail"> | null {
  const byNorm = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    const value = v == null ? "" : String(v).trim();
    if (value) byNorm.set(norm(k), value);
  }
  const pick = (field: keyof typeof ALIASES) => {
    for (const alias of ALIASES[field]) {
      const v = byNorm.get(alias);
      if (v) return v.slice(0, field === "message" ? 4000 : 200);
    }
    return undefined;
  };
  // Facebook exports phone as "p:+919876543210"; strip that prefix.
  const phone = pick("phone")?.replace(/^p:/i, "");
  const email = pick("email")?.toLowerCase();
  if (!phone && !email) return null;
  const lastName = byNorm.get("lastname");
  const first = pick("name");
  return {
    name: (first && lastName && !first.includes(lastName) ? `${first} ${lastName}` : first) || phone || email!,
    phone,
    email,
    company: pick("company"),
    service: pick("service"),
    message: pick("message"),
    city: pick("city"),
    campaign: pick("campaign"),
    formName: pick("formName"),
  };
}

function makeAdapter(channel: Channel, label: string): ChannelAdapter {
  return {
    channel,
    label,
    supportsOutbound: false,

    // Events are created server-side (pull) or by an authenticated route (API key);
    // there is no provider webhook to verify for these channels.
    verifySignature() {
      return { ok: false, reason: `${label} does not accept provider webhooks` };
    },

    normalize(payload) {
      const p = payload as LeadSourcePayload;
      const event: NormalizedEvent = {
        kind: "lead",
        channel,
        providerEventId: p._id,
        identity: {
          externalId: (p.phone || p.email || p._id).toLowerCase(),
          displayName: p.name,
          email: p.email || null,
          phone: p.phone || null,
        },
        lead: {
          providerLeadId: p._id,
          formName: p.formName ?? label,
          campaignName: p.campaign ?? null,
          fields: {
            name: p.name,
            email: p.email ?? "",
            phone: p.phone ?? "",
            company: p.company ?? "",
            service: p.service ?? "",
            message: [p.message, p.city ? `City: ${p.city}` : ""].filter(Boolean).join("\n"),
          },
        },
        attribution: {
          campaignName: p.campaign ?? null,
          sourceDetail: p.sourceDetail ?? label,
        },
      };
      return [event];
    },

    buildSimulatedPayload(input: SimulatedInput) {
      const id = `${channel.toLowerCase()}:SIM${Date.now()}`;
      return {
        providerEventId: id,
        payload: {
          _id: id,
          name: input.name ?? `Simulated ${label} lead`,
          email: input.email ?? "lead@example.com",
          phone: input.phone ?? "+919822222222",
          service: input.service ?? "Websites",
          message: input.message ?? "Simulated lead for pipeline testing.",
          sourceDetail: `${label} (simulated)`,
        } satisfies LeadSourcePayload,
      };
    },
  };
}

export const sheetFeedAdapter = makeAdapter("SHEET_FEED", "Google Sheet / CSV feed");
export const indiamartAdapter = makeAdapter("INDIAMART", "IndiaMART");
export const leadApiAdapter = makeAdapter("LEAD_API", "Lead intake API");

export const LEAD_SOURCE_CHANNELS: Channel[] = ["SHEET_FEED", "INDIAMART", "LEAD_API"];

// ─── IndiaMART Lead Manager Pull API ─────────────────────────────────────────
// Verified against https://help.indiamart.com/knowledge-base/lms-crm-integration-v2
// (2026-09-25): GET https://mapi.indiamart.com/wservce/crm/crmListing/v2/
// ?glusr_crm_key=&start_time=&end_time= ; times in IST as d-MMM-yyyyHH:mm:ss;
// max 7-day window; ≥5 minutes between calls; >5 calls/minute blocks for 15 minutes.

export const INDIAMART_URL = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/";
export const INDIAMART_MIN_INTERVAL_MS = 10 * 60_000; // IndiaMART recommends 10–15 minutes
export const INDIAMART_MAX_WINDOW_MS = 7 * 86_400_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a Date as IndiaMART expects: IST, e.g. "05-Sep-202614:30:00". */
export function indiamartTime(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000); // UTC+05:30, no DST
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${p(ist.getUTCDate())}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()}` +
    `${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`
  );
}

const QUERY_TYPES: Record<string, string> = {
  W: "Direct enquiry",
  B: "Buy-lead",
  P: "PNS call",
  BIZ: "Catalog view",
  WA: "WhatsApp enquiry",
};

export function indiamartRecordToPayload(r: Record<string, unknown>): LeadSourcePayload | null {
  const s = (k: string) => (r[k] == null ? undefined : String(r[k]).trim() || undefined);
  const id = s("UNIQUE_QUERY_ID");
  const phone = s("SENDER_MOBILE") ?? s("SENDER_MOBILE_ALT");
  const email = s("SENDER_EMAIL") ?? s("SENDER_EMAIL_ALT");
  if (!id || (!phone && !email)) return null;
  const type = s("QUERY_TYPE");
  return {
    _id: `indiamart:${id}`,
    name: s("SENDER_NAME") ?? phone ?? email!,
    phone,
    email: email?.toLowerCase(),
    company: s("SENDER_COMPANY"),
    service: s("QUERY_PRODUCT_NAME"),
    message: [s("QUERY_SUBJECT"), s("QUERY_MESSAGE")].filter(Boolean).join("\n") || undefined,
    city: [s("SENDER_CITY"), s("SENDER_STATE")].filter(Boolean).join(", ") || undefined,
    sourceDetail: `IndiaMART · ${(type && QUERY_TYPES[type]) || "Enquiry"}`,
    formName: "IndiaMART Lead Manager",
  };
}
