import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { toE164 } from "@/lib/phone";
import { resolveIdentity } from "./identity";
import { upsertConversation } from "./conversations";

export interface VoiceWhatsAppRequest {
  organizationId: string;
  leadId?: string | null;
  phone: string;
  name?: string;
  message: string;
  requestId: string;
  confirmed: boolean;
}

export async function sendVoiceWhatsApp(input: VoiceWhatsAppRequest) {
  if (!input.confirmed) throw new Error("Confirm the recipient and ask permission before sending.");
  const phone = toE164(input.phone);
  if (!phone) throw new Error("The recipient number is invalid. Ask the caller to repeat it.");
  if (env.demoMode) throw new Error("Live WhatsApp sending is disabled in demo mode.");
  const twilio = env.whatsappProvider === "twilio";
  if (twilio ? !env.twilio.configured : !env.whatsapp.accessToken || !env.whatsapp.phoneNumberId) {
    throw new Error("Autoneural's WhatsApp Business API number is not connected. Nothing was sent.");
  }
  const org = await prisma.organization.findUnique({ where: { id: input.organizationId } });
  if (!org) throw new Error("Company workspace not found.");
  const id = `voicewa_${createHash("sha256").update(`${org.id}:${input.requestId}`).digest("hex")}`;
  const result = (m: { id: string; deliveryStatus: string; errorText: string | null }) => ({
    accepted: ["SENT", "DELIVERED", "READ"].includes(m.deliveryStatus),
    status: m.deliveryStatus,
    messageId: m.id,
    detail: m.errorText ?? (m.deliveryStatus === "PENDING" ? "Sending is in progress. Do not send again." : m.deliveryStatus === "SENT" ? "WhatsApp provider accepted the message; delivery is not yet confirmed." : `Message status: ${m.deliveryStatus}`),
  });
  const previous = await prisma.message.findUnique({ where: { id } });
  if (previous) return result(previous);
  if (input.leadId && !await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: org.id } })) {
    throw new Error("Lead does not belong to this workspace.");
  }
  const identity = await resolveIdentity(org.id, { channel: "WHATSAPP", externalId: twilio ? phone : phone.slice(1), phone, displayName: input.name });
  const lead = await prisma.lead.findFirst({ where: { organizationId: org.id, contactId: identity.contactId, ...(input.leadId ? { id: input.leadId } : {}), archivedAt: null }, orderBy: { createdAt: "desc" } });
  const convo = await upsertConversation({ organizationId: org.id, contactId: identity.contactId, channel: "WHATSAPP", externalThreadId: `${twilio ? "twilio" : env.whatsapp.phoneNumberId}:${phone.slice(1)}`, leadId: lead?.id });
  const inbound = await prisma.message.findFirst({ where: { conversationId: convo.id, direction: "INBOUND", isInternalNote: false }, orderBy: { createdAt: "desc" } });
  const age = inbound ? Date.now() - (inbound.providerTimestamp ?? inbound.createdAt).getTime() : Infinity;
  const useTemplate = age < 0 || age >= 24 * 60 * 60 * 1000;
  const template = process.env.VOICE_WHATSAPP_TEMPLATE_NAME ?? "";
  const contentSid = process.env.VOICE_WHATSAPP_CONTENT_SID ?? "";
  if (useTemplate && !(twilio ? contentSid : template)) {
    throw new Error("An approved WhatsApp call-follow-up template is required because the customer has not messaged within 24 hours. Ask them to message +916297927642 first. Nothing was sent.");
  }
  const name = (input.name || "there").replace(/\s+/g, " ").trim().slice(0, 80);
  const text = input.message.trim();
  if (!text || text.length > 1000) throw new Error("Message must contain 1 to 1000 characters.");
  const summary = text.replace(/\s+/g, " ");
  const body = useTemplate ? `Hi ${name}, this is Autoneural following up on your call. ${summary} Reply here if you need help.` : text;
  try {
    await prisma.message.create({ data: { id, organizationId: org.id, conversationId: convo.id, direction: "OUTBOUND", type: useTemplate ? "TEMPLATE" : "TEXT", body, isAutomated: true, deliveryStatus: "PENDING" } });
  } catch (e: any) {
    if (e.code !== "P2002") throw e;
    const concurrent = await prisma.message.findUniqueOrThrow({ where: { id } });
    return result(concurrent);
  }
  let status: "SENT" | "FAILED" | "UNKNOWN" = "UNKNOWN";
  let providerMessageId: string | null = null;
  let errorText: string | null = null;
  try {
    let response: Response;
    if (twilio) {
      const form = new URLSearchParams({ To: `whatsapp:${phone}`, StatusCallback: env.twilio.webhookUrl || `${env.appUrl.replace(/\/$/, "")}/api/webhooks/whatsapp` });
      if (env.twilio.messagingServiceSid) form.set("MessagingServiceSid", env.twilio.messagingServiceSid);
      else form.set("From", env.twilio.whatsappFrom.startsWith("whatsapp:") ? env.twilio.whatsappFrom : `whatsapp:${env.twilio.whatsappFrom}`);
      if (useTemplate) { form.set("ContentSid", contentSid); form.set("ContentVariables", JSON.stringify({ "1": name, "2": summary })); }
      else form.set("Body", text);
      response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilio.accountSid}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${env.twilio.accountSid}:${env.twilio.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(12000) });
    } else {
      const payload = useTemplate ? { type: "template", template: { name: template, language: { code: process.env.VOICE_WHATSAPP_TEMPLATE_LANGUAGE || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: name }, { type: "text", text: summary }] }] } } : { type: "text", text: { body: text, preview_url: false } };
      response = await fetch(`https://graph.facebook.com/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${env.whatsapp.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: phone.slice(1), ...payload }), signal: AbortSignal.timeout(12000) });
    }
    const data = await response.json();
    providerMessageId = twilio ? data.sid ?? null : data.messages?.[0]?.id ?? null;
    status = response.ok && providerMessageId ? "SENT" : response.ok ? "UNKNOWN" : "FAILED";
    if (status !== "SENT") errorText = response.ok ? "Provider response did not confirm acceptance. Check the inbox before retrying." : "WhatsApp provider rejected the message. Check provider configuration and the approved template.";
  } catch {
    errorText = "Provider confirmation was not received. The message may have been accepted; check the inbox before retrying.";
  }
  const updated = await prisma.message.update({ where: { id }, data: { deliveryStatus: status, providerMessageId, errorText, sentAt: status === "SENT" ? new Date() : null } });
  await prisma.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date() } });
  return result(updated);
}
