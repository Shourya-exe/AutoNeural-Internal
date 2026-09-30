import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { prisma, resetDatabase, type TestOrg } from "./fixtures";
import { env } from "@/lib/env";
import { sendVoiceWhatsApp } from "@/server/services/voice-whatsapp";
let org: TestOrg;
const original = { ...env.whatsapp };
const originalTwilio = { ...env.twilio };
let fetchMock: ReturnType<typeof vi.fn>;
const input = () => ({ organizationId: org.orgId, phone: "+919873333333", message: "You asked about WhatsApp automation.", requestId: "call-1:message-1", confirmed: true });
beforeEach(async () => {
  org = await resetDatabase();
  env.whatsappProvider = "meta";
  env.whatsapp.accessToken = "unit-test-token";
  env.whatsapp.phoneNumberId = "PHONE_ID";
  delete process.env.VOICE_WHATSAPP_TEMPLATE_NAME;
  delete process.env.VOICE_WHATSAPP_CONTENT_SID;
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid-test" }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); Object.assign(env.whatsapp, original); env.whatsappProvider = "meta"; env.twilio.accountSid = originalTwilio.accountSid; env.twilio.authToken = originalTwilio.authToken; env.twilio.whatsappFrom = originalTwilio.whatsappFrom; env.twilio.messagingServiceSid = originalTwilio.messagingServiceSid; delete process.env.VOICE_WHATSAPP_TEMPLATE_NAME; delete process.env.VOICE_WHATSAPP_CONTENT_SID; });
afterAll(async () => { await prisma.$disconnect(); });
async function inbound(hoursAgo = 0) {
  const contact = await prisma.contact.create({ data: { organizationId: org.orgId, fullName: "Test caller", primaryPhone: input().phone } });
  const convo = await prisma.conversation.create({ data: { organizationId: org.orgId, contactId: contact.id, channel: "WHATSAPP", externalThreadId: "PHONE_ID:919873333333" } });
  await prisma.message.create({ data: { organizationId: org.orgId, conversationId: convo.id, direction: "INBOUND", body: "Hello", providerTimestamp: new Date(Date.now() - hoursAgo * 3600000) } });
  return convo;
}
describe("voice WhatsApp follow-up", () => {
  it("refuses an unconfirmed recipient without sending", async () => {
    await expect(sendVoiceWhatsApp({ ...input(), confirmed: false })).rejects.toThrow(/confirm/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails honestly when the company API number is missing", async () => {
    env.whatsapp.phoneNumberId = "";
    await expect(sendVoiceWhatsApp(input())).rejects.toThrow(/not connected/i);
    expect(await prisma.message.count()).toBe(0);
  });
  it("requires a template for a caller who has not messaged on WhatsApp", async () => {
    await expect(sendVoiceWhatsApp(input())).rejects.toThrow(/template/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends a free-form reply in the real inbound window and logs it as automated", async () => {
    const convo = await inbound();
    const result = await sendVoiceWhatsApp(input());
    expect(result.accepted).toBe(true);
    expect(result.status).toBe("SENT");
    const sent = await prisma.message.findUniqueOrThrow({ where: { id: result.messageId } });
    expect(sent.conversationId).toBe(convo.id);
    expect(sent.isAutomated).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).type).toBe("text");
  });
  it("sends the approved template outside the window, with two parameters", async () => {
    await inbound(25);
    process.env.VOICE_WHATSAPP_TEMPLATE_NAME = "autoneural_call_followup";
    const result = await sendVoiceWhatsApp({ ...input(), name: "Caller" });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(result.accepted).toBe(true);
    expect(sentBody.type).toBe("template");
    expect(sentBody.template.components[0].parameters).toHaveLength(2);
  });
  it("never sends twice when the same call request is retried", async () => {
    await inbound();
    const first = await sendVoiceWhatsApp(input());
    const second = await sendVoiceWhatsApp(input());
    expect(second.messageId).toBe(first.messageId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("records provider rejection as failed, not sent", async () => {
    await inbound();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: {} }), { status: 400 }));
    const result = await sendVoiceWhatsApp(input());
    expect(result.accepted).toBe(false);
    expect(result.status).toBe("FAILED");
  });
  it("does not retry an ambiguous timeout", async () => {
    await inbound();
    fetchMock.mockRejectedValue(new Error("timeout"));
    const result = await sendVoiceWhatsApp(input());
    expect(result.status).toBe("UNKNOWN");
    await sendVoiceWhatsApp(input());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("supports Twilio approved templates without sending free-form text outside a window", async () => {
    env.whatsappProvider = "twilio";
    env.twilio.accountSid = "AC_TEST"; env.twilio.authToken = "test"; env.twilio.whatsappFrom = "whatsapp:+916297927642";
    env.twilio.messagingServiceSid = "";
    process.env.VOICE_WHATSAPP_CONTENT_SID = "HX_TEST";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sid: "SM_TEST" }), { status: 201 }));
    expect((await sendVoiceWhatsApp(input())).accepted).toBe(true);
    const form = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(form.get("ContentSid")).toBe("HX_TEST"); expect(form.has("Body")).toBe(false);
  });
  it("refuses to link a foreign workspace lead", async () => {
    await expect(sendVoiceWhatsApp({ ...input(), leadId: "foreign-lead" })).rejects.toThrow(/workspace/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
