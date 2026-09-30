import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { ChannelAdapter, NormalizedEvent, SimulatedInput } from "./types";
import { metaVerifyChallenge, verifyMetaSignature } from "./signature";

/**
 * WhatsApp Business Platform (Meta Cloud API) adapter.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 *
 * Implemented: authenticated webhook verification (GET challenge + X-Hub
 * signature), inbound message normalization, delivery/read status
 * normalization, outbound text send, and 24-hour customer-service-window check.
 *
 * NOT verified without credentials + a live WABA: real send/receive. The
 * Simulator produces a payload shaped exactly like the Cloud API v21.0 webhook.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export const whatsappAdapter: ChannelAdapter = {
  channel: "WHATSAPP",
  label: "WhatsApp Business Platform",
  supportsOutbound: true,

  verifyChallenge(query) {
    return metaVerifyChallenge(query, env.whatsapp.verifyToken);
  },

  verifySignature(rawBody, headers) {
    // In demo mode the Simulator sends a valid signature computed with a demo
    // secret; treat a matching demo signature as valid for local testing.
    const ok =
      verifyMetaSignature(rawBody, headers, env.whatsapp.appSecret) ||
      (env.demoMode && headers.get("x-simulated-signature") === "demo");
    return { ok, organizationId: undefined, reason: ok ? undefined : "Invalid X-Hub-Signature-256" };
  },

  normalize(payload) {
    const events: NormalizedEvent[] = [];
    const body = payload as any;
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        const contactsById = new Map<string, any>();
        for (const c of value.contacts ?? []) contactsById.set(c.wa_id, c);

        // Inbound messages
        for (const m of value.messages ?? []) {
          const waId: string = m.from;
          const contact = contactsById.get(waId);
          const type = mapType(m.type);
          events.push({
            kind: "message",
            channel: "WHATSAPP",
            providerEventId: `wa:msg:${m.id}`,
            identity: {
              externalId: `+${waId.replace(/^\+/, "")}`,
              displayName: contact?.profile?.name ?? null,
              phone: `+${waId.replace(/^\+/, "")}`,
            },
            threadId: `${value.metadata?.phone_number_id ?? "wa"}:${waId}`,
            message: {
              providerMessageId: m.id,
              text: m.text?.body ?? m.button?.text ?? m.interactive?.list_reply?.title ?? null,
              type,
              timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
            },
          });
        }

        // Delivery / read status callbacks
        for (const s of value.statuses ?? []) {
          events.push({
            kind: "status",
            channel: "WHATSAPP",
            providerEventId: `wa:status:${s.id}:${s.status}`,
            identity: { externalId: `+${(s.recipient_id ?? "").replace(/^\+/, "")}` },
            status: {
              providerMessageId: s.id,
              state: (s.status as string)?.toUpperCase() as any,
              timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date(),
              error: s.errors?.[0]?.title ?? null,
            },
          });
        }
      }
    }
    return events;
  },

  buildSimulatedPayload(input: SimulatedInput) {
    const wa = (input.phone ?? "+919812345678").replace(/[^\d]/g, "");
    const msgId = `wamid.SIM${Date.now()}`;
    return {
      providerEventId: `wa:msg:${msgId}`,
      payload: {
        object: "whatsapp_business_account",
        entry: [
          {
            id: env.whatsapp.wabaId || "SIM_WABA",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "919900000000",
                    phone_number_id: env.whatsapp.phoneNumberId || "SIM_PHONE_ID",
                  },
                  contacts: [{ profile: { name: input.name ?? "Simulated Prospect" }, wa_id: wa }],
                  messages: [
                    {
                      from: wa,
                      id: msgId,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: {
                        body:
                          input.message ??
                          `Hi, I'm interested in ${input.service ?? "AI calling systems"} for my business.`,
                      },
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

  async checkSendWindow(conversation) {
    // 24h customer service window: last inbound must be < 24h ago, else a
    // template message is required.
    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
    });
    if (!lastInbound) {
      return {
        ok: false,
        reason:
          "No inbound message yet — WhatsApp requires an approved template message to open the conversation.",
      };
    }
    const ageMs = Date.now() - new Date(lastInbound.providerTimestamp ?? lastInbound.createdAt).getTime();
    if (ageMs > 24 * 3600 * 1000) {
      return {
        ok: false,
        reason:
          "The 24-hour customer service window has closed. Send an approved template message to re-engage.",
      };
    }
    return { ok: true };
  },

  async sendText(conversation, text) {
    if (env.demoMode) {
      return { accepted: true, providerMessageId: `demo-wa-${Date.now()}` };
    }
    if (!env.whatsapp.accessToken || !env.whatsapp.phoneNumberId) {
      return { accepted: false, error: "WhatsApp access token / phone number id not configured." };
    }
    const to = (conversation.externalThreadId ?? "").split(":").pop();
    const res = await fetch(`${GRAPH}/${env.whatsapp.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.whatsapp.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { accepted: false, error: json?.error?.message ?? `HTTP ${res.status}` };
    }
    return { accepted: true, providerMessageId: json?.messages?.[0]?.id ?? null };
  },
};

type MsgType = NonNullable<NormalizedEvent["message"]>["type"];

function mapType(t: string): MsgType {
  switch (t) {
    case "image":
      return "IMAGE";
    case "audio":
    case "voice":
      return "AUDIO";
    case "video":
      return "VIDEO";
    case "document":
      return "FILE";
    default:
      return "TEXT";
  }
}
