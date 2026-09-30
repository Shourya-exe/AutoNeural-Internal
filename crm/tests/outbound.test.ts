import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDatabase, actorFor, type TestOrg } from "./fixtures";
import { sendReply, sendEligibility, upsertConversation } from "@/server/services/conversations";
import { whatsappAdapter } from "@/server/integrations/whatsapp";

let org: TestOrg;

async function makeConversation(channel: any = "WHATSAPP", withInbound = true) {
  const contact = await prisma.contact.create({
    data: { organizationId: org.orgId, fullName: "Chat Person", primaryPhone: "+919873333333" },
  });
  const convo = await upsertConversation({
    organizationId: org.orgId,
    contactId: contact.id,
    channel,
    externalThreadId: `PHONE_ID:919873333333`,
  });
  if (withInbound) {
    await prisma.message.create({
      data: {
        organizationId: org.orgId,
        conversationId: convo.id,
        direction: "INBOUND",
        body: "Hi there",
        providerMessageId: `in-${convo.id}`,
        deliveryStatus: "DELIVERED",
        providerTimestamp: new Date(),
      },
    });
  }
  return convo;
}

beforeEach(async () => {
  org = await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("outbound send eligibility", () => {
  it("blocks sending on a channel that is not CONNECTED", async () => {
    await prisma.integrationConnection.updateMany({
      where: { organizationId: org.orgId, channel: "WHATSAPP" },
      data: { status: "PERMISSION_REQUIRED" },
    });
    const convo = await makeConversation();

    const elig = await sendEligibility(org.orgId, convo.id);
    expect(elig.canSend).toBe(false);
    expect(elig.reason).toMatch(/not connected/i);
  });

  it("blocks sending on Lead Ads with a useful explanation", async () => {
    const contact = await prisma.contact.create({
      data: { organizationId: org.orgId, fullName: "Form Person" },
    });
    const convo = await upsertConversation({
      organizationId: org.orgId,
      contactId: contact.id,
      channel: "META_LEAD_ADS",
      externalThreadId: "form-thread",
    });

    const elig = await sendEligibility(org.orgId, convo.id);
    expect(elig.canSend).toBe(false);
    expect(elig.reason).toMatch(/ingestion source/i);
  });

  it("blocks WhatsApp sending outside the 24-hour customer service window", async () => {
    const convo = await makeConversation("WHATSAPP", false);
    // Inbound message from 30 hours ago.
    await prisma.message.create({
      data: {
        organizationId: org.orgId,
        conversationId: convo.id,
        direction: "INBOUND",
        body: "Old message",
        providerMessageId: "old-in",
        deliveryStatus: "DELIVERED",
        providerTimestamp: new Date(Date.now() - 30 * 3600 * 1000),
      },
    });

    const elig = await sendEligibility(org.orgId, convo.id);
    expect(elig.canSend).toBe(false);
    expect(elig.reason).toMatch(/24-hour|template/i);
  });

  it("blocks WhatsApp sending when there has been no inbound message at all", async () => {
    const convo = await makeConversation("WHATSAPP", false);
    const elig = await sendEligibility(org.orgId, convo.id);
    expect(elig.canSend).toBe(false);
    expect(elig.reason).toMatch(/template/i);
  });

  it("allows sending inside the window on a connected channel", async () => {
    const convo = await makeConversation();
    const elig = await sendEligibility(org.orgId, convo.id);
    expect(elig.canSend).toBe(true);
  });
});

describe("outbound message state", () => {
  it("stores an accepted send as SENT — never DELIVERED", async () => {
    const convo = await makeConversation();
    const spy = vi.spyOn(whatsappAdapter as Required<typeof whatsappAdapter>, "sendText")
      .mockResolvedValue({ accepted: true, providerMessageId: "wamid.OUT" });

    const actor = actorFor(org, "SALES_REP", org.repId);
    const res = await sendReply(actor, convo.id, "Thanks for reaching out!");

    expect(res.message.deliveryStatus).toBe("SENT");
    expect(res.message.deliveryStatus).not.toBe("DELIVERED");
    expect(res.message.providerMessageId).toBe("wamid.OUT");
    spy.mockRestore();
  });

  it("stores a rejected send as FAILED with the provider error", async () => {
    const convo = await makeConversation();
    const spy = vi.spyOn(whatsappAdapter as Required<typeof whatsappAdapter>, "sendText")
      .mockResolvedValue({ accepted: false, error: "(#131047) Re-engagement message" });

    const actor = actorFor(org, "SALES_REP", org.repId);
    const res = await sendReply(actor, convo.id, "Hello?");

    expect(res.message.deliveryStatus).toBe("FAILED");
    expect(res.message.errorText).toMatch(/131047/);
    spy.mockRestore();
  });

  it("stores a thrown transport error as FAILED, not SENT", async () => {
    const convo = await makeConversation();
    const spy = vi.spyOn(whatsappAdapter as Required<typeof whatsappAdapter>, "sendText")
      .mockRejectedValue(new Error("socket hang up"));

    const actor = actorFor(org, "SALES_REP", org.repId);
    const res = await sendReply(actor, convo.id, "Are you there?");

    expect(res.message.deliveryStatus).toBe("FAILED");
    expect(res.message.errorText).toMatch(/socket hang up/);
    spy.mockRestore();
  });

  it("a FAILED send does not set the lead's first-response timestamp", async () => {
    const contact = await prisma.contact.create({
      data: { organizationId: org.orgId, fullName: "SLA Person", primaryPhone: "+919874444444" },
    });
    const lead = await prisma.lead.create({
      data: {
        organizationId: org.orgId,
        contactId: contact.id,
        stageId: org.stageIds.new,
        title: "SLA lead",
        sourceChannel: "WHATSAPP",
        firstInboundAt: new Date(),
      },
    });
    const convo = await upsertConversation({
      organizationId: org.orgId,
      contactId: contact.id,
      channel: "WHATSAPP",
      externalThreadId: "PHONE_ID:919874444444",
      leadId: lead.id,
    });
    await prisma.message.create({
      data: {
        organizationId: org.orgId,
        conversationId: convo.id,
        direction: "INBOUND",
        body: "Hi",
        providerMessageId: "in-sla",
        deliveryStatus: "DELIVERED",
        providerTimestamp: new Date(),
      },
    });

    const spy = vi.spyOn(whatsappAdapter as Required<typeof whatsappAdapter>, "sendText")
      .mockResolvedValue({ accepted: false, error: "rate limited" });
    const actor = actorFor(org, "SALES_REP", org.repId);
    await sendReply(actor, convo.id, "Reply attempt");
    spy.mockRestore();

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.firstResponseAt).toBeNull();
  });

  it("a successful send sets first-response exactly once", async () => {
    const contact = await prisma.contact.create({
      data: { organizationId: org.orgId, fullName: "SLA OK", primaryPhone: "+919875555555" },
    });
    const lead = await prisma.lead.create({
      data: {
        organizationId: org.orgId,
        contactId: contact.id,
        stageId: org.stageIds.new,
        title: "SLA lead 2",
        sourceChannel: "WHATSAPP",
        firstInboundAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    const convo = await upsertConversation({
      organizationId: org.orgId,
      contactId: contact.id,
      channel: "WHATSAPP",
      externalThreadId: "PHONE_ID:919875555555",
      leadId: lead.id,
    });
    await prisma.message.create({
      data: {
        organizationId: org.orgId,
        conversationId: convo.id,
        direction: "INBOUND",
        body: "Hi",
        providerMessageId: "in-sla2",
        deliveryStatus: "DELIVERED",
        providerTimestamp: new Date(),
      },
    });

    const spy = vi.spyOn(whatsappAdapter as Required<typeof whatsappAdapter>, "sendText")
      .mockResolvedValue({ accepted: true, providerMessageId: "wamid.OK1" });
    const actor = actorFor(org, "SALES_REP", org.repId);

    await sendReply(actor, convo.id, "First reply");
    const first = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(first.firstResponseAt).not.toBeNull();

    spy.mockResolvedValue({ accepted: true, providerMessageId: "wamid.OK2" });
    await sendReply(actor, convo.id, "Second reply");
    const second = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(second.firstResponseAt!.getTime()).toBe(first.firstResponseAt!.getTime());
    spy.mockRestore();
  });

  it("internal notes are stored but never sent, even when sending is blocked", async () => {
    await prisma.integrationConnection.updateMany({
      where: { organizationId: org.orgId, channel: "WHATSAPP" },
      data: { status: "ERROR" },
    });
    const convo = await makeConversation();
    const spy = vi.spyOn(whatsappAdapter as Required<typeof whatsappAdapter>, "sendText");

    const actor = actorFor(org, "SALES_REP", org.repId);
    const res = await sendReply(actor, convo.id, "Watch out — price sensitive.", {
      asInternalNote: true,
    });

    expect(res.internal).toBe(true);
    expect(res.message.isInternalNote).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("refuses a customer-facing send when the channel is not eligible", async () => {
    await prisma.integrationConnection.updateMany({
      where: { organizationId: org.orgId, channel: "WHATSAPP" },
      data: { status: "ERROR" },
    });
    const convo = await makeConversation();
    const actor = actorFor(org, "SALES_REP", org.repId);

    await expect(sendReply(actor, convo.id, "Hello")).rejects.toThrow(/not connected/i);
    // Nothing customer-facing was stored.
    expect(
      await prisma.message.count({ where: { conversationId: convo.id, direction: "OUTBOUND" } }),
    ).toBe(0);
  });
});
