import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { writeActivity } from "./audit";
import { getAdapter } from "@/server/integrations/registry";
import type { Actor } from "@/server/auth/permissions";
import type { Channel, Prisma } from "@prisma/client";

export interface UpsertConversationArgs {
  organizationId: string;
  contactId: string;
  channel: Channel;
  externalThreadId?: string | null;
  leadId?: string | null;
}

export async function upsertConversation(
  args: UpsertConversationArgs,
  tx: Prisma.TransactionClient = prisma,
) {
  const threadId = args.externalThreadId ?? `${args.channel}:${args.contactId}`;
  const existing = await tx.conversation.findUnique({
    where: {
      organizationId_channel_externalThreadId: {
        organizationId: args.organizationId,
        channel: args.channel,
        externalThreadId: threadId,
      },
    },
  });
  if (existing) {
    if (args.leadId && !existing.leadId) {
      return tx.conversation.update({ where: { id: existing.id }, data: { leadId: args.leadId } });
    }
    return existing;
  }
  return tx.conversation.create({
    data: {
      organizationId: args.organizationId,
      contactId: args.contactId,
      channel: args.channel,
      externalThreadId: threadId,
      leadId: args.leadId ?? null,
    },
  });
}

export interface RecordInboundArgs {
  organizationId: string;
  conversationId: string;
  providerMessageId?: string | null;
  body?: string | null;
  type?: "TEXT" | "IMAGE" | "FILE" | "AUDIO" | "VIDEO" | "TEMPLATE" | "SYSTEM";
  providerTimestamp?: Date | null;
  attachments?: unknown;
}

/**
 * Persist an inbound message. Deduplicated on providerMessageId via the unique
 * (organizationId, providerMessageId) constraint — a duplicate webhook delivery
 * results in exactly one stored message.
 */
export async function recordInboundMessage(args: RecordInboundArgs) {
  try {
    const msg = await prisma.message.create({
      data: {
        organizationId: args.organizationId,
        conversationId: args.conversationId,
        direction: "INBOUND",
        type: args.type ?? "TEXT",
        body: args.body ?? null,
        providerMessageId: args.providerMessageId ?? null,
        deliveryStatus: "DELIVERED", // inbound = we have it
        providerTimestamp: args.providerTimestamp ?? new Date(),
        attachments: (args.attachments as any) ?? undefined,
      },
    });
    const convo = await prisma.conversation.update({
      where: { id: args.conversationId },
      data: { lastMessageAt: new Date(), unread: true, state: "OPEN" },
      include: { lead: true },
    });

    // Track first eligible inbound on the lead for response-time metrics.
    if (convo.leadId) {
      await prisma.lead.updateMany({
        where: { id: convo.leadId, firstInboundAt: null },
        data: { firstInboundAt: msg.providerTimestamp ?? new Date() },
      });
      await writeActivity({
        organizationId: args.organizationId,
        leadId: convo.leadId,
        type: "MESSAGE_IN",
        summary: truncate(args.body ?? "(attachment)"),
      });
    }
    return { message: msg, duplicate: false };
  } catch (e: any) {
    if (e?.code === "P2002") {
      const existing = await prisma.message.findFirst({
        where: {
          organizationId: args.organizationId,
          providerMessageId: args.providerMessageId ?? "__none__",
        },
      });
      return { message: existing, duplicate: true };
    }
    throw e;
  }
}

export interface SendEligibility {
  canSend: boolean;
  reason?: string;
}

/**
 * Whether an outbound reply may be sent on this conversation right now.
 * Sending is enabled ONLY for a CONNECTED integration with a valid window /
 * consent and an eligible recipient. Otherwise the UI shows `reason`.
 */
export async function sendEligibility(
  organizationId: string,
  conversationId: string,
): Promise<SendEligibility> {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
  });
  if (!convo) return { canSend: false, reason: "Conversation not found." };

  const connection = await prisma.integrationConnection.findUnique({
    where: { organizationId_channel: { organizationId, channel: convo.channel } },
  });

  if (convo.channel === "META_LEAD_ADS") {
    return {
      canSend: false,
      reason:
        "Lead Ads is an ingestion source, not a messaging channel. Reply via the contact's WhatsApp/Messenger/Instagram, email or phone.",
    };
  }
  if (!connection || connection.status !== "CONNECTED") {
    return {
      canSend: false,
      reason: `${labelChannel(convo.channel)} is not connected. Connect it in Settings → Integrations to enable replies.`,
    };
  }
  if (env.demoMode) {
    return {
      canSend: true,
      reason:
        "DEMO MODE — replies are stored and shown as Sent but no real message leaves the system.",
    };
  }

  const adapter = getAdapter(convo.channel);
  if (adapter?.checkSendWindow) {
    const w = await adapter.checkSendWindow(convo);
    if (!w.ok) return { canSend: false, reason: w.reason };
  }
  return { canSend: true };
}

export async function sendReply(
  actor: Actor,
  conversationId: string,
  body: string,
  opts: { asInternalNote?: boolean } = {},
) {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: actor.organizationId },
    include: { lead: true },
  });
  if (!convo) throw new Error("Conversation not found.");

  if (opts.asInternalNote) {
    const note = await prisma.message.create({
      data: {
        organizationId: actor.organizationId,
        conversationId,
        direction: "OUTBOUND",
        type: "SYSTEM",
        body,
        isInternalNote: true,
        deliveryStatus: "UNKNOWN",
        senderUserId: actor.id,
      },
    });
    return { message: note, delivered: false, internal: true };
  }

  const elig = await sendEligibility(actor.organizationId, conversationId);
  if (!elig.canSend) {
    throw new Error(elig.reason ?? "Sending is not available on this conversation.");
  }

  // Store as PENDING first; only a provider callback promotes to DELIVERED/READ.
  const msg = await prisma.message.create({
    data: {
      organizationId: actor.organizationId,
      conversationId,
      direction: "OUTBOUND",
      type: "TEXT",
      body,
      deliveryStatus: "PENDING",
      senderUserId: actor.id,
      sentAt: new Date(),
    },
  });

  let providerMessageId: string | null = null;
  let status: "SENT" | "FAILED" = "SENT";
  let errorText: string | null = null;

  if (env.demoMode) {
    providerMessageId = `demo-out-${msg.id}`;
    status = "SENT"; // NOT "DELIVERED" — see enum comment
  } else {
    const adapter = getAdapter(convo.channel);
    try {
      const res = await adapter!.sendText!(convo, body);
      providerMessageId = res.providerMessageId ?? null;
      status = res.accepted ? "SENT" : "FAILED";
      errorText = res.error ?? null;
    } catch (e) {
      status = "FAILED";
      errorText = e instanceof Error ? e.message : String(e);
    }
  }

  const updated = await prisma.message.update({
    where: { id: msg.id },
    data: { providerMessageId, deliveryStatus: status, errorText },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), unread: false },
  });

  // First HUMAN outbound reply => firstResponseAt (used for response-time report).
  if (convo.leadId && status === "SENT") {
    await prisma.lead.updateMany({
      where: { id: convo.leadId, firstResponseAt: null },
      data: { firstResponseAt: new Date() },
    });
    await writeActivity({
      organizationId: actor.organizationId,
      leadId: convo.leadId,
      actorUserId: actor.id,
      type: "MESSAGE_OUT",
      summary: truncate(body),
    });
  }

  return { message: updated, delivered: false, sent: status === "SENT" };
}

function truncate(s: string, n = 140) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function labelChannel(c: Channel) {
  return (
    {
      WHATSAPP: "WhatsApp",
      MESSENGER: "Facebook Messenger",
      INSTAGRAM: "Instagram",
      META_LEAD_ADS: "Lead Ads",
      WEBSITE_FORM: "Website form",
      SHEET_FEED: "Sheet feed",
      INDIAMART: "IndiaMART",
      LEAD_API: "Lead API",
      EMAIL: "Email",
      PHONE: "Phone",
      MANUAL: "Manual",
    } as Record<Channel, string>
  )[c];
}
