import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDatabase, seedDefaultAutomations, type TestOrg } from "./fixtures";
import { processWebhookEvent } from "@/server/services/ingestion";
import { whatsappAdapter } from "@/server/integrations/whatsapp";

let org: TestOrg;

async function storeEvent(providerEventId: string, payload: unknown, channel: any = "WHATSAPP") {
  return prisma.webhookEvent.create({
    data: {
      organizationId: org.orgId,
      channel,
      providerEventId,
      signatureValid: true,
      status: "RECEIVED",
      payload: payload as any,
    },
  });
}

function waPayload(waId: string, msgId: string, text: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PHONE_ID" },
              contacts: [{ profile: { name: "Test Prospect" }, wa_id: waId }],
              messages: [
                {
                  from: waId,
                  id: msgId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

beforeEach(async () => {
  org = await resetDatabase();
  await seedDefaultAutomations(org.orgId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("webhook ingestion", () => {
  it("creates exactly one contact, lead, conversation and message from one delivery", async () => {
    const e = await storeEvent("wa:msg:M1", waPayload("919812345678", "wamid.M1", "Hi, pricing?"));
    const res = await processWebhookEvent(e.id);
    expect(res.status).toBe("processed");

    expect(await prisma.contact.count()).toBe(1);
    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(1);

    const contact = await prisma.contact.findFirstOrThrow();
    // Phone is normalised to E.164 from the raw wa_id.
    expect(contact.primaryPhone).toBe("+919812345678");
  });

  it("processing the SAME event twice stores only one message and one lead", async () => {
    const payload = waPayload("919812345678", "wamid.DUP", "Same message");
    const e = await storeEvent("wa:msg:DUP", payload);

    await processWebhookEvent(e.id);
    const second = await processWebhookEvent(e.id); // worker retry / replay

    expect(second.status).toBe("processed");
    expect(await prisma.message.count()).toBe(1);
    expect(await prisma.lead.count()).toBe(1);
  });

  it("a re-delivered webhook with the same provider message id is a no-op", async () => {
    const payload = waPayload("919812345678", "wamid.REDELIVER", "Hello");
    const first = await storeEvent("wa:msg:REDELIVER:a", payload);
    await processWebhookEvent(first.id);

    // Provider re-delivers the identical message under a new envelope id.
    const second = await storeEvent("wa:msg:REDELIVER:b", payload);
    await processWebhookEvent(second.id);

    expect(await prisma.message.count()).toBe(1);
    expect(await prisma.lead.count()).toBe(1);
  });

  it("a second message from the same person does NOT create a second lead", async () => {
    const a = await storeEvent("wa:msg:A", waPayload("919812345678", "wamid.A", "First"));
    await processWebhookEvent(a.id);
    const b = await storeEvent("wa:msg:B", waPayload("919812345678", "wamid.B", "Second"));
    await processWebhookEvent(b.id);

    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.message.count()).toBe(2);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("records the original source and adds later channels as touchpoints", async () => {
    // 1. Website form lead.
    const web = await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "WEBSITE_FORM",
        providerEventId: "web:1",
        signatureValid: true,
        status: "RECEIVED",
        payload: {
          _id: "web:1",
          name: "Cross Channel Person",
          email: "cross@example.com",
          phone: "+919812345678",
          message: "Interested",
        } as any,
      },
    });
    await processWebhookEvent(web.id);

    const leadAfterWeb = await prisma.lead.findFirstOrThrow();
    expect(leadAfterWeb.sourceChannel).toBe("WEBSITE_FORM");

    // 2. Same phone reaches out on WhatsApp.
    const wa = await storeEvent("wa:msg:X", waPayload("919812345678", "wamid.X", "Following up"));
    await processWebhookEvent(wa.id);

    const leads = await prisma.lead.findMany({ include: { touchpoints: true } });
    expect(leads).toHaveLength(1);
    // Original source preserved…
    expect(leads[0].sourceChannel).toBe("WEBSITE_FORM");
    // …and the WhatsApp contact recorded as a touchpoint.
    expect(leads[0].touchpoints.map((t) => t.channel)).toContain("WHATSAPP");
  });

  it("applies delivery status callbacks and never downgrades the state", async () => {
    // Seed an outbound message we can receive statuses for.
    const e = await storeEvent("wa:msg:S", waPayload("919812345678", "wamid.S", "Hi"));
    await processWebhookEvent(e.id);
    const convo = await prisma.conversation.findFirstOrThrow();
    await prisma.message.create({
      data: {
        organizationId: org.orgId,
        conversationId: convo.id,
        direction: "OUTBOUND",
        body: "Our reply",
        providerMessageId: "wamid.OUT1",
        deliveryStatus: "SENT",
      },
    });

    const statusEvent = (status: string, id: string) =>
      prisma.webhookEvent.create({
        data: {
          organizationId: org.orgId,
          channel: "WHATSAPP",
          providerEventId: id,
          signatureValid: true,
          status: "RECEIVED",
          payload: {
            object: "whatsapp_business_account",
            entry: [
              {
                id: "WABA",
                changes: [
                  {
                    field: "messages",
                    value: {
                      statuses: [
                        {
                          id: "wamid.OUT1",
                          status,
                          recipient_id: "919812345678",
                          timestamp: String(Math.floor(Date.now() / 1000)),
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          } as any,
        },
      });

    const read = await statusEvent("read", "wa:status:read");
    await processWebhookEvent(read.id);
    expect((await prisma.message.findFirstOrThrow({ where: { providerMessageId: "wamid.OUT1" } })).deliveryStatus).toBe("READ");

    // An out-of-order "delivered" arriving after "read" must NOT downgrade it.
    const delivered = await statusEvent("delivered", "wa:status:delivered");
    await processWebhookEvent(delivered.id);
    expect((await prisma.message.findFirstOrThrow({ where: { providerMessageId: "wamid.OUT1" } })).deliveryStatus).toBe("READ");
  });

  it("marks an unprocessable event FAILED with a retry time, then DEAD_LETTER", async () => {
    const bad = await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "META_LEAD_ADS",
        providerEventId: "meta:leadgen:BROKEN",
        signatureValid: true,
        status: "RECEIVED",
        // normalize() will produce a lead event with no fields; fetchLeadDetail
        // is stubbed below to throw so the retry path is exercised.
        payload: {
          object: "page",
          entry: [
            {
              id: "PAGE",
              changes: [{ field: "leadgen", value: { leadgen_id: "BROKEN" } }],
            },
          ],
        } as any,
      },
    });

    const { metaLeadAdsAdapter } = await import("@/server/integrations/meta-lead-ads");
    const original = metaLeadAdsAdapter.fetchLeadDetail;
    metaLeadAdsAdapter.fetchLeadDetail = async () => {
      throw new Error("Lead retrieval failed (HTTP 500)");
    };

    try {
      const first = await processWebhookEvent(bad.id);
      expect(first.status).toBe("failed");
      let row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: bad.id } });
      expect(row.status).toBe("FAILED");
      expect(row.nextRetryAt).not.toBeNull();
      expect(row.error).toMatch(/retrieval failed/i);

      // Exhaust the retry budget.
      for (let i = 0; i < 6; i++) await processWebhookEvent(bad.id);
      row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: bad.id } });
      expect(row.status).toBe("DEAD_LETTER");
      expect(row.nextRetryAt).toBeNull();
    } finally {
      metaLeadAdsAdapter.fetchLeadDetail = original;
    }
  });

  it("recovers a dead-lettered event on replay once the provider works again", async () => {
    const ev = await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "META_LEAD_ADS",
        providerEventId: "meta:leadgen:RECOVER",
        signatureValid: true,
        status: "DEAD_LETTER",
        attempts: 6,
        error: "Lead retrieval failed",
        payload: {
          object: "page",
          entry: [
            {
              id: "PAGE",
              changes: [
                {
                  field: "leadgen",
                  value: {
                    leadgen_id: "RECOVER",
                    form_name: "Book a consultation",
                    field_data: [
                      { name: "full_name", values: ["Recovered Person"] },
                      { name: "email", values: ["recovered@example.com"] },
                      { name: "phone_number", values: ["+919800000001"] },
                    ],
                  },
                },
              ],
            },
          ],
        } as any,
      },
    });

    // Admin replay resets the status, then processing succeeds.
    await prisma.webhookEvent.update({
      where: { id: ev.id },
      data: { status: "RECEIVED", error: null },
    });
    const res = await processWebhookEvent(ev.id);
    expect(res.status).toBe("processed");
    expect(await prisma.lead.count()).toBe(1);
  });

  it("persists UTM, referrer and landing attribution from a website form", async () => {
    const ev = await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "WEBSITE_FORM",
        providerEventId: "web:attribution",
        signatureValid: true,
        status: "RECEIVED",
        payload: {
          _id: "web:attribution",
          name: "Meera Iyer",
          email: "meera@example.com",
          phone: "98765 43210",
          company: "Brightpath Clinics",
          service: "AI Calling Systems",
          message: "We need an AI receptionist.",
          consent: true,
          utm_source: "google",
          utm_medium: "cpc",
          utm_campaign: "brand-search",
          utm_content: "ad-variant-b",
          utm_term: "ai receptionist",
          referrer: "https://www.google.com/",
          landing: "https://autoneural.in/services",
          pageUrl: "https://autoneural.in/contact",
        } as any,
      },
    });
    await processWebhookEvent(ev.id);

    const lead = await prisma.lead.findFirstOrThrow({ include: { contact: true } });
    expect(lead.sourceChannel).toBe("WEBSITE_FORM");
    expect(lead.utmSource).toBe("google");
    expect(lead.utmMedium).toBe("cpc");
    expect(lead.utmCampaign).toBe("brand-search");
    expect(lead.utmContent).toBe("ad-variant-b");
    expect(lead.utmTerm).toBe("ai receptionist");
    expect(lead.referrerUrl).toBe("https://www.google.com/");
    expect(lead.landingUrl).toBe("https://autoneural.in/services");
    expect(lead.sourceDetail).toBe("https://autoneural.in/contact");
    expect(lead.interestedService).toBe("AI Calling Systems");
    expect(lead.contact.primaryPhone).toBe("+919876543210");
  });

  it("the adapter's simulated payload flows through the real pipeline", async () => {
    const { payload, providerEventId } = whatsappAdapter.buildSimulatedPayload({
      name: "Simulated Person",
      phone: "+919888777666",
      message: "Simulated enquiry",
    });
    const e = await storeEvent(providerEventId, payload);
    const res = await processWebhookEvent(e.id);
    expect(res.status).toBe("processed");
    const contact = await prisma.contact.findFirstOrThrow();
    expect(contact.fullName).toBe("Simulated Person");
    expect(contact.primaryPhone).toBe("+919888777666");
  });
});
