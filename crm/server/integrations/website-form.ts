import { z } from "zod";
import type { ChannelAdapter, NormalizedEvent, SimulatedInput } from "./types";
import { verifyFormSignature } from "./signature";
import { env } from "@/lib/env";
import { stableHash } from "@/lib/utils";

/**
 * Website enquiry form adapter.
 *
 * The public endpoint (app/api/public/enquiry) rate-limits per IP, checks a
 * honeypot field, and optionally verifies an HMAC signature. Privileged API
 * credentials are NEVER exposed to the browser — the example form posts plain
 * fields; attribution (UTM / referrer / landing) is captured client-side and
 * forwarded.
 */

export const websiteFormSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  company: z.string().max(200).optional().or(z.literal("")),
  service: z.string().max(200).optional().or(z.literal("")),
  message: z.string().max(4000).optional().or(z.literal("")),
  consent: z.boolean().optional(),
  // honeypot — must be empty
  website: z.string().optional(),
  // attribution
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_content: z.string().optional(),
  utm_term: z.string().optional(),
  referrer: z.string().optional(),
  landing: z.string().optional(),
  pageUrl: z.string().optional(),
});

export type WebsiteFormInput = z.infer<typeof websiteFormSchema>;

export const websiteFormAdapter: ChannelAdapter = {
  channel: "WEBSITE_FORM",
  label: "Website enquiry form",
  supportsOutbound: false,

  verifySignature(rawBody, headers) {
    const ok = verifyFormSignature(rawBody, headers, env.websiteForm.signingSecret);
    return { ok, reason: ok ? undefined : "Invalid x-form-signature" };
  },

  normalize(payload) {
    const data = payload as WebsiteFormInput & { _id?: string };
    const eventId =
      data._id ??
      `web:${stableHash(
        [data.email, data.phone, data.message, Math.floor(Date.now() / 60000)].join("|"),
      )}`;
    const events: NormalizedEvent[] = [
      {
        kind: "lead",
        channel: "WEBSITE_FORM",
        providerEventId: eventId,
        identity: {
          externalId: (data.email || data.phone || eventId).toLowerCase(),
          displayName: data.name,
          email: data.email || null,
          phone: data.phone || null,
        },
        lead: {
          providerLeadId: eventId,
          formName: "Website enquiry",
          fields: {
            name: data.name,
            email: data.email ?? "",
            phone: data.phone ?? "",
            company: data.company ?? "",
            service: data.service ?? "",
            message: data.message ?? "",
            consent: String(!!data.consent),
          },
        },
        attribution: {
          campaignName: data.utm_campaign ?? null,
          sourceDetail: data.pageUrl ?? data.landing ?? "Website",
          utmSource: data.utm_source ?? null,
          utmMedium: data.utm_medium ?? null,
          utmCampaign: data.utm_campaign ?? null,
          utmContent: data.utm_content ?? null,
          utmTerm: data.utm_term ?? null,
          referrerUrl: data.referrer || null,
          landingUrl: data.landing ?? data.pageUrl ?? null,
        },
      },
    ];
    return events;
  },

  buildSimulatedPayload(input: SimulatedInput) {
    const id = `web:SIM${Date.now()}`;
    return {
      providerEventId: id,
      payload: {
        _id: id,
        name: input.name ?? "Simulated Website Visitor",
        email: input.email ?? "visitor@example.com",
        phone: input.phone ?? "+919833333333",
        company: "Website Co",
        service: input.service ?? "Websites",
        message: input.message ?? "We need a new marketing website with a booking flow.",
        consent: true,
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: input.campaignName ?? "brand-search",
        referrer: "https://www.google.com/",
        landing: "https://autoneural.example/services/websites",
        pageUrl: "https://autoneural.example/contact",
      },
    };
  },
};
