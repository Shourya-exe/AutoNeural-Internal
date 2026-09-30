import { prisma } from "@/lib/prisma";
import { getAdapter } from "@/server/integrations/registry";
import type { NormalizedEvent } from "@/server/integrations/types";
import { resolveIdentity } from "./identity";
import { findOrCreateLeadForContact } from "./leads";
import { upsertConversation, recordInboundMessage } from "./conversations";
import { writeActivity } from "./audit";
import type { Channel, WebhookEvent } from "@prisma/client";

const MAX_ATTEMPTS = 6;

/** Exponential backoff with jitter (seconds): ~10, 30, 90, 270, 810, 2430. */
function backoffMs(attempt: number): number {
  const base = 10_000 * Math.pow(3, attempt - 1);
  return base + Math.floor(Math.random() * 5_000);
}

/**
 * Idempotent processing of one persisted WebhookEvent. Safe to call multiple
 * times (duplicate deliveries, worker retries, admin replay).
 */
export async function processWebhookEvent(eventId: string): Promise<{
  status: "processed" | "duplicate" | "failed" | "dead_letter";
  detail?: string;
}> {
  const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event) return { status: "failed", detail: "event not found" };
  if (event.status === "PROCESSED") return { status: "processed", detail: "already processed" };
  if (event.status === "DUPLICATE") return { status: "duplicate" };

  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });

  try {
    const adapter = getAdapter(event.channel);
    if (!adapter) throw new Error(`No adapter for channel ${event.channel}`);

    let normalized = adapter.normalize(event.payload);

    // Lead Ads: hydrate missing field data via the provider (retryable).
    normalized = await hydrateLeadAds(adapter, normalized);

    for (const ne of normalized) {
      await applyNormalizedEvent(event, ne);
    }

    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { status: "PROCESSED", processedAt: new Date(), error: null, nextRetryAt: null },
    });
    return { status: "processed", detail: `${normalized.length} normalized event(s)` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fresh = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
    const attempts = fresh?.attempts ?? 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: dead ? "DEAD_LETTER" : "FAILED",
        error: message,
        nextRetryAt: dead ? null : new Date(Date.now() + backoffMs(attempts)),
      },
    });
    // Surface integration failure to managers via the connection record.
    await prisma.integrationConnection.updateMany({
      where: { organizationId: event.organizationId, channel: event.channel },
      data: { lastErrorAt: new Date(), lastErrorText: message.slice(0, 500) },
    });
    return { status: dead ? "dead_letter" : "failed", detail: message };
  }
}

async function hydrateLeadAds(
  adapter: ReturnType<typeof getAdapter>,
  events: NormalizedEvent[],
): Promise<NormalizedEvent[]> {
  if (!adapter?.fetchLeadDetail) return events;
  const out: NormalizedEvent[] = [];
  for (const e of events) {
    if (e.kind === "lead" && e.lead && Object.keys(e.lead.fields).length === 0) {
      const fields = await adapter.fetchLeadDetail(e.lead.providerLeadId); // may throw -> retry
      e.lead.fields = fields;
      e.identity.email = e.identity.email ?? fields.email ?? null;
      e.identity.phone = e.identity.phone ?? fields.phone_number ?? fields.phone ?? null;
      e.identity.displayName = e.identity.displayName ?? fields.full_name ?? fields.name ?? null;
      if (!e.identity.externalId || e.identity.externalId.startsWith("leadgen:")) {
        e.identity.externalId = (fields.email || e.identity.externalId).toLowerCase();
      }
    }
    out.push(e);
  }
  return out;
}

async function applyNormalizedEvent(event: WebhookEvent, ne: NormalizedEvent) {
  const organizationId = event.organizationId;

  // ── Duplicate guard (message id / event id) ──
  if (ne.kind === "message" && ne.message?.providerMessageId) {
    const dup = await prisma.message.findFirst({
      where: { organizationId, providerMessageId: ne.message.providerMessageId },
      select: { id: true },
    });
    if (dup) return; // exactly-once
  }

  // ── Status callbacks: update delivery state, tolerate out-of-order ──
  if (ne.kind === "status" && ne.status) {
    await applyStatus(organizationId, ne);
    return;
  }

  // ── Resolve identity (find-or-create contact + channel identity) ──
  const resolved = await prisma.$transaction((tx) =>
    resolveIdentity(
      organizationId,
      {
        channel: ne.channel,
        externalId: ne.identity.externalId,
        displayName: ne.identity.displayName,
        email: ne.identity.email,
        phone: ne.identity.phone,
        metadata: { via: "webhook", providerEventId: ne.providerEventId },
      },
      tx,
    ),
  );

  // ── Lead: find open lead in window or create; map fields ──
  const serviceHint = ne.lead ? extractServiceHint(ne.lead.fields) : null;
  const { lead, created } = await findOrCreateLeadForContact({
    organizationId,
    contactId: resolved.contactId,
    channel: ne.channel,
    sourceDetail: ne.attribution?.sourceDetail ?? ne.lead?.formName ?? null,
    campaignName: ne.attribution?.campaignName ?? ne.lead?.campaignName ?? null,
    serviceHint,
  });

  // Persist provider + campaign attribution on a freshly-created lead.
  // Only on creation: an existing lead keeps the attribution it was captured
  // with, and the new contact is recorded as a Touchpoint instead.
  if (created) {
    const a = ne.attribution;
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        formId: ne.lead?.formId ?? undefined,
        campaignId: ne.lead?.campaignId ?? a?.campaignId ?? undefined,
        adId: ne.lead?.adId ?? a?.adId ?? undefined,
        interestedService: serviceHint ?? undefined,
        utmSource: a?.utmSource ?? undefined,
        utmMedium: a?.utmMedium ?? undefined,
        utmCampaign: a?.utmCampaign ?? undefined,
        utmContent: a?.utmContent ?? undefined,
        utmTerm: a?.utmTerm ?? undefined,
        referrerUrl: a?.referrerUrl ?? undefined,
        landingUrl: a?.landingUrl ?? undefined,
      },
    });
    if (ne.lead?.fields.message) {
      await writeActivity({
        organizationId,
        leadId: lead.id,
        type: "NOTE_ADDED",
        summary: `Form message: ${ne.lead.fields.message.slice(0, 500)}`,
      });
    }
  }

  if (resolved.needsReview) {
    await writeActivity({
      organizationId,
      leadId: lead.id,
      type: "TOUCHPOINT",
      summary:
        "Identity match is uncertain — linked provisionally. Review in the lead's contact panel before merging.",
    });
  }

  // ── Message: upsert conversation + record inbound ──
  if (ne.kind === "message" && ne.message) {
    const convo = await upsertConversation({
      organizationId,
      contactId: resolved.contactId,
      channel: ne.channel,
      externalThreadId: ne.threadId,
      leadId: lead.id,
    });
    await recordInboundMessage({
      organizationId,
      conversationId: convo.id,
      providerMessageId: ne.message.providerMessageId,
      body: ne.message.text,
      type: ne.message.type,
      providerTimestamp: ne.message.timestamp,
      attachments: ne.message.attachments,
    });
  }

  await prisma.integrationConnection.updateMany({
    where: { organizationId, channel: ne.channel },
    data: { lastEventAt: new Date(), lastErrorAt: null, lastErrorText: null },
  });
}

async function applyStatus(organizationId: string, ne: NormalizedEvent) {
  const st = ne.status!;
  if (st.providerMessageId.startsWith("watermark:")) return; // IG/FB read watermark, skip granular
  const msg = await prisma.message.findFirst({
    where: { organizationId, providerMessageId: st.providerMessageId },
  });
  if (!msg) return; // status for a message we didn't send / haven't stored yet

  // Monotonic state machine: never downgrade READ -> DELIVERED -> SENT.
  const rank: Record<string, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 1, UNKNOWN: 0 };
  if ((rank[st.state] ?? 0) <= (rank[msg.deliveryStatus] ?? 0) && st.state !== "FAILED") return;

  await prisma.message.update({
    where: { id: msg.id },
    data: {
      deliveryStatus: st.state,
      errorText: st.error ?? msg.errorText,
      providerTimestamp: st.timestamp ?? msg.providerTimestamp,
    },
  });
}

/** Map common Lead Ads / form field labels to a service hint. */
function extractServiceHint(fields: Record<string, string>): string | null {
  const key = Object.keys(fields).find((k) =>
    /service|interested|product|requirement/i.test(k),
  );
  const raw = (key ? fields[key] : fields.service) ?? "";
  return raw.trim() || null;
}

/** Called by the scheduled worker to retry FAILED events whose backoff elapsed. */
export async function retryDueWebhookEvents(limit = 25): Promise<number> {
  const due = await prisma.webhookEvent.findMany({
    where: { status: "FAILED", nextRetryAt: { lte: new Date() } },
    orderBy: { nextRetryAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const e of due) await processWebhookEvent(e.id);
  return due.length;
}
