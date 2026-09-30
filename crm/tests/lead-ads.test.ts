import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDatabase, seedDefaultAutomations, type TestOrg } from "./fixtures";
import { metaLeadAdsAdapter } from "@/server/integrations/meta-lead-ads";
import { processWebhookEvent } from "@/server/services/ingestion";

let org: TestOrg;

beforeEach(async () => {
  org = await resetDatabase();
  await seedDefaultAutomations(org.orgId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const leadgenPayload = (overrides: Record<string, unknown> = {}) => ({
  object: "page",
  entry: [
    {
      id: "PAGE_1",
      changes: [
        {
          field: "leadgen",
          value: {
            leadgen_id: "LEAD_123",
            page_id: "PAGE_1",
            form_id: "FORM_9",
            form_name: "AutoNeural — Book a consultation",
            campaign_id: "CAMP_1",
            campaign_name: "Q3 AI Agents — Lead Gen",
            ad_id: "AD_7",
            field_data: [
              { name: "full_name", values: ["Priya Sharma"] },
              { name: "email", values: ["PRIYA@Example.COM"] },
              { name: "phone_number", values: ["98123 45678"] },
              { name: "company_name", values: ["Nimbus Retail"] },
              { name: "which_service_are_you_interested_in?", values: ["WhatsApp automation"] },
            ],
            ...overrides,
          },
        },
      ],
    },
  ],
});

describe("Meta Lead Ads field mapping", () => {
  it("normalizes a leadgen webhook into a lead event with provider attribution", () => {
    const events = metaLeadAdsAdapter.normalize(leadgenPayload());
    expect(events).toHaveLength(1);
    const e = events[0];

    expect(e.kind).toBe("lead");
    expect(e.providerEventId).toBe("meta:leadgen:LEAD_123");
    expect(e.lead?.providerLeadId).toBe("LEAD_123");
    expect(e.lead?.formId).toBe("FORM_9");
    expect(e.lead?.campaignId).toBe("CAMP_1");
    expect(e.lead?.campaignName).toBe("Q3 AI Agents — Lead Gen");
    expect(e.lead?.adId).toBe("AD_7");
    expect(e.identity.displayName).toBe("Priya Sharma");
    expect(e.identity.email).toBe("PRIYA@Example.COM");
    expect(e.identity.phone).toBe("98123 45678");
  });

  it("maps form fields onto CRM fields when the event is applied", async () => {
    const ev = await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "META_LEAD_ADS",
        providerEventId: "meta:leadgen:LEAD_123",
        signatureValid: true,
        status: "RECEIVED",
        payload: leadgenPayload() as any,
      },
    });
    await processWebhookEvent(ev.id);

    const lead = await prisma.lead.findFirstOrThrow({ include: { contact: true } });
    expect(lead.sourceChannel).toBe("META_LEAD_ADS");
    expect(lead.campaignName).toBe("Q3 AI Agents — Lead Gen");
    expect(lead.formId).toBe("FORM_9");
    expect(lead.adId).toBe("AD_7");
    expect(lead.interestedService).toBe("WhatsApp automation");
    expect(lead.contact.fullName).toBe("Priya Sharma");
    // Email is lower-cased and the loose Indian mobile is normalised to E.164.
    expect(lead.contact.primaryEmail).toBe("priya@example.com");
    expect(lead.contact.primaryPhone).toBe("+919812345678");
  });

  it("does not import the same provider lead twice", async () => {
    const mk = (envelopeId: string) =>
      prisma.webhookEvent.create({
        data: {
          organizationId: org.orgId,
          channel: "META_LEAD_ADS",
          providerEventId: envelopeId,
          signatureValid: true,
          status: "RECEIVED",
          payload: leadgenPayload() as any,
        },
      });

    const a = await mk("meta:leadgen:LEAD_123");
    await processWebhookEvent(a.id);
    // Meta re-delivers the same leadgen_id.
    const b = await mk("meta:leadgen:LEAD_123:redelivery");
    await processWebhookEvent(b.id);

    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("retries retrieval when the Graph call fails, then succeeds", async () => {
    // A real webhook carries no field_data — detail must be fetched.
    const payload = {
      object: "page",
      entry: [
        {
          id: "PAGE_1",
          changes: [
            { field: "leadgen", value: { leadgen_id: "NEEDS_FETCH", form_id: "FORM_9" } },
          ],
        },
      ],
    };
    const ev = await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "META_LEAD_ADS",
        providerEventId: "meta:leadgen:NEEDS_FETCH",
        signatureValid: true,
        status: "RECEIVED",
        payload: payload as any,
      },
    });

    const original = metaLeadAdsAdapter.fetchLeadDetail;
    let calls = 0;
    metaLeadAdsAdapter.fetchLeadDetail = async () => {
      calls++;
      if (calls === 1) throw new Error("HTTP 500 from Graph API");
      return {
        full_name: "Fetched Person",
        email: "fetched@example.com",
        phone_number: "+919800000009",
        "which_service_are_you_interested_in?": "AI Agents",
      };
    };

    try {
      const first = await processWebhookEvent(ev.id);
      expect(first.status).toBe("failed");
      expect(await prisma.lead.count()).toBe(0);

      const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
      expect(row.status).toBe("FAILED");
      expect(row.nextRetryAt).not.toBeNull();

      // The scheduled retry succeeds.
      const second = await processWebhookEvent(ev.id);
      expect(second.status).toBe("processed");
      expect(calls).toBe(2);

      const lead = await prisma.lead.findFirstOrThrow({ include: { contact: true } });
      expect(lead.contact.fullName).toBe("Fetched Person");
      expect(lead.interestedService).toBe("AI Agents");
    } finally {
      metaLeadAdsAdapter.fetchLeadDetail = original;
    }
  });

  it("is an ingestion-only channel — it never offers outbound messaging", async () => {
    expect(metaLeadAdsAdapter.supportsOutbound).toBe(false);
    expect(metaLeadAdsAdapter.sendText).toBeUndefined();

    const ev = await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "META_LEAD_ADS",
        providerEventId: "meta:leadgen:NO_SEND",
        signatureValid: true,
        status: "RECEIVED",
        payload: leadgenPayload({ leadgen_id: "NO_SEND" }) as any,
      },
    });
    await processWebhookEvent(ev.id);

    // No messaging conversation is created for a lead-form submission.
    expect(await prisma.conversation.count()).toBe(0);
  });
});
