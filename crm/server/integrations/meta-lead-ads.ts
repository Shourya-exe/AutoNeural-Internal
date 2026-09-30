import { env } from "@/lib/env";
import type { ChannelAdapter, NormalizedEvent, SimulatedInput } from "./types";
import { metaVerifyChallenge, verifyMetaSignature } from "./signature";

/**
 * Meta Lead Ads ingestion (Facebook & Instagram lead forms).
 * Docs: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
 *
 * The webhook only carries a `leadgen_id`; full field data is retrieved with a
 * Page access token via `GET /{leadgen_id}`. Retrieval failures are recorded on
 * the WebhookEvent and retried by the worker.
 *
 * This is an INGESTION source only — receiving a form submission does NOT grant
 * permission to message the person on WhatsApp/Messenger/etc.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export const metaLeadAdsAdapter: ChannelAdapter = {
  channel: "META_LEAD_ADS",
  label: "Facebook / Instagram Lead Ads",
  supportsOutbound: false,

  verifyChallenge(query) {
    return metaVerifyChallenge(query, env.metaLeadAds.verifyToken);
  },

  verifySignature(rawBody, headers) {
    const ok =
      verifyMetaSignature(rawBody, headers, env.metaLeadAds.appSecret) ||
      (env.demoMode && headers.get("x-simulated-signature") === "demo");
    return { ok, reason: ok ? undefined : "Invalid X-Hub-Signature-256" };
  },

  normalize(payload) {
    const events: NormalizedEvent[] = [];
    const body = payload as any;
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change.field !== "leadgen") continue;
        const v = change.value ?? {};
        // If the simulator inlined the field_data, use it; otherwise the worker
        // will call fetchLeadDetail(providerLeadId).
        const inlineFields: Record<string, string> = {};
        for (const f of v.field_data ?? []) {
          inlineFields[f.name] = Array.isArray(f.values) ? f.values.join(", ") : String(f.values ?? "");
        }
        events.push({
          kind: "lead",
          channel: "META_LEAD_ADS",
          providerEventId: `meta:leadgen:${v.leadgen_id}`,
          identity: {
            externalId: inlineFields.email || `leadgen:${v.leadgen_id}`,
            displayName: inlineFields.full_name || inlineFields.name || null,
            email: inlineFields.email || null,
            phone: inlineFields.phone_number || inlineFields.phone || null,
          },
          lead: {
            providerLeadId: v.leadgen_id,
            formId: v.form_id ?? null,
            formName: v.form_name ?? null,
            campaignId: v.campaign_id ?? null,
            campaignName: v.campaign_name ?? null,
            adId: v.ad_id ?? null,
            fields: inlineFields,
          },
          attribution: {
            campaignId: v.campaign_id ?? null,
            campaignName: v.campaign_name ?? null,
            adId: v.ad_id ?? null,
            sourceDetail: v.form_name ?? "Lead form",
          },
        });
      }
    }
    return events;
  },

  buildSimulatedPayload(input: SimulatedInput) {
    const leadgenId = `SIMLEAD${Date.now()}`;
    return {
      providerEventId: `meta:leadgen:${leadgenId}`,
      payload: {
        object: "page",
        entry: [
          {
            id: "SIM_PAGE",
            time: Math.floor(Date.now() / 1000),
            changes: [
              {
                field: "leadgen",
                value: {
                  leadgen_id: leadgenId,
                  page_id: "SIM_PAGE",
                  form_id: "SIM_FORM_001",
                  form_name: "AutoNeural — Book a consultation",
                  campaign_id: "234567",
                  campaign_name: input.campaignName ?? "Q3 AI Agents — Lead Gen",
                  ad_id: "345678",
                  adgroup_id: "456789",
                  created_time: Math.floor(Date.now() / 1000),
                  // Inlined for local simulation. Real webhooks omit this and
                  // require a Graph API fetch (see fetchLeadDetail).
                  field_data: [
                    { name: "full_name", values: [input.name ?? "Simulated Lead"] },
                    { name: "email", values: [input.email ?? "sim.lead@example.com"] },
                    { name: "phone_number", values: [input.phone ?? "+919811111111"] },
                    { name: "company_name", values: ["Simulated Pvt Ltd"] },
                    {
                      name: "which_service_are_you_interested_in?",
                      values: [input.service ?? "WhatsApp automation"],
                    },
                    {
                      name: "message",
                      values: [input.message ?? "Please call me to discuss pricing."],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
  },

  async fetchLeadDetail(providerLeadId: string) {
    if (env.demoMode || !env.metaLeadAds.pageAccessToken) {
      // Deterministic synthetic detail so the retry path is exercisable locally.
      return {
        full_name: "Retrieved Lead",
        email: "retrieved.lead@example.com",
        phone_number: "+919822222222",
        company_name: "Retrieved Pvt Ltd",
        "which_service_are_you_interested_in?": "AI calling systems",
      };
    }
    const url = `${GRAPH}/${providerLeadId}?access_token=${encodeURIComponent(
      env.metaLeadAds.pageAccessToken,
    )}`;
    const res = await fetch(url);
    const json: any = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `Lead retrieval failed (HTTP ${res.status})`);
    const out: Record<string, string> = {};
    for (const f of json.field_data ?? []) {
      out[f.name] = Array.isArray(f.values) ? f.values.join(", ") : String(f.values ?? "");
    }
    return out;
  },
};
