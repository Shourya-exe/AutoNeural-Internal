import { prisma } from "@/lib/prisma";
import { stableHash } from "@/lib/utils";
import { writeActivity, writeAudit } from "./audit";
import { notify } from "./notifications";
import { runAutomations } from "./automations";
import { resolveIdentity, type InboundIdentity } from "./identity";
import { resolveAssignment } from "./assignment";
import type { Actor } from "@/server/auth/permissions";
import { ForbiddenError, can } from "@/server/auth/permissions";
import type { Channel, Prisma, Priority } from "@prisma/client";

/** Window during which a new inbound from the same contact is treated as the
 *  SAME lead rather than spawning a new one (prevents a lead per message). */
const LEAD_REOPEN_WINDOW_DAYS = 45;

async function firstStageId(organizationId: string, tx: Prisma.TransactionClient = prisma) {
  const stage = await tx.pipelineStage.findFirst({
    where: { organizationId, isLost: false, isWon: false },
    orderBy: { order: "asc" },
  });
  if (!stage) throw new Error("No pipeline stages configured for organization.");
  return stage.id;
}

export interface CreateLeadInput {
  contactId: string;
  title?: string;
  ownerId?: string | null;
  serviceId?: string | null;
  interestedService?: string | null;
  priority?: Priority;
  estimatedValue?: number | null;
  sourceChannel: Channel;
  sourceDetail?: string | null;
  campaignName?: string | null;
  campaignId?: string | null;
  formId?: string | null;
  adId?: string | null;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  };
  referrerUrl?: string | null;
  landingUrl?: string | null;
}

export async function createLead(
  organizationId: string,
  input: CreateLeadInput,
  opts: { actor?: Actor | null; runAutomations?: boolean } = {},
) {
  const lead = await prisma.$transaction(async (tx) => {
    const stageId = await firstStageId(organizationId, tx);
    const contact = await tx.contact.findFirst({
      where: { id: input.contactId, organizationId },
    });
    if (!contact) throw new Error("Contact not found in organization.");

    const created = await tx.lead.create({
      data: {
        organizationId,
        contactId: input.contactId,
        ownerId: input.ownerId ?? null,
        stageId,
        serviceId: input.serviceId ?? null,
        interestedService: input.interestedService ?? null,
        priority: input.priority ?? "MEDIUM",
        estimatedValue: input.estimatedValue ?? null,
        title:
          input.title?.trim() ||
          `${contact.fullName}${contact.company ? ` · ${contact.company}` : ""}`,
        sourceChannel: input.sourceChannel,
        sourceDetail: input.sourceDetail ?? null,
        campaignName: input.campaignName ?? null,
        campaignId: input.campaignId ?? null,
        formId: input.formId ?? null,
        adId: input.adId ?? null,
        utmSource: input.utm?.source ?? null,
        utmMedium: input.utm?.medium ?? null,
        utmCampaign: input.utm?.campaign ?? null,
        utmContent: input.utm?.content ?? null,
        utmTerm: input.utm?.term ?? null,
        referrerUrl: input.referrerUrl ?? null,
        landingUrl: input.landingUrl ?? null,
      },
    });

    return created;
  });

  // Timeline + audit are written AFTER the transaction commits: they reference
  // the new lead row by foreign key, so they must not run inside it.
  await writeActivity({
    organizationId,
    leadId: lead.id,
    actorUserId: opts.actor?.id ?? null,
    type: "LEAD_CREATED",
    summary: `Lead created from ${labelChannel(input.sourceChannel)}${
      input.sourceDetail ? ` (${input.sourceDetail})` : ""
    }`,
    meta: { sourceChannel: input.sourceChannel },
  });
  await writeAudit({
    organizationId,
    actorUserId: opts.actor?.id ?? null,
    action: "lead.create",
    entityType: "Lead",
    entityId: lead.id,
    after: { title: lead.title, sourceChannel: lead.sourceChannel },
  });

  if (opts.runAutomations !== false) {
    await runAutomations({ organizationId, trigger: "LEAD_CREATED", leadId: lead.id });
  }
  return lead;
}

/**
 * Used by the ingestion pipeline. Finds an OPEN lead for the contact within the
 * reopen window; only creates a new one when there is none. Preserves the
 * original lead source — a later channel is recorded as a Touchpoint.
 */
export async function findOrCreateLeadForContact(params: {
  organizationId: string;
  contactId: string;
  channel: Channel;
  sourceDetail?: string | null;
  campaignName?: string | null;
  serviceHint?: string | null;
}) {
  const { organizationId, contactId, channel } = params;
  const cutoff = new Date(Date.now() - LEAD_REOPEN_WINDOW_DAYS * 24 * 3600 * 1000);

  const open = await prisma.lead.findFirst({
    where: {
      organizationId,
      contactId,
      status: "OPEN",
      archivedAt: null,
      OR: [{ lastActivityAt: { gte: cutoff } }, { createdAt: { gte: cutoff } }],
    },
    orderBy: { lastActivityAt: "desc" },
  });

  if (open) {
    // Record the additional touchpoint without altering the original source.
    await prisma.touchpoint.create({
      data: {
        leadId: open.id,
        channel,
        detail: params.sourceDetail ?? null,
        campaignName: params.campaignName ?? null,
      },
    });
    await writeActivity({
      organizationId,
      leadId: open.id,
      type: "TOUCHPOINT",
      summary: `New ${labelChannel(channel)} touchpoint on existing lead`,
      meta: { channel },
    });
    return { lead: open, created: false };
  }

  const lead = await createLead(
    organizationId,
    {
      contactId,
      sourceChannel: channel,
      sourceDetail: params.sourceDetail ?? null,
      campaignName: params.campaignName ?? null,
      interestedService: params.serviceHint ?? null,
    },
    { runAutomations: true },
  );
  return { lead, created: true };
}

export async function assignLead(
  actor: Actor,
  leadId: string,
  ownerId: string | null,
) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: actor.organizationId },
  });
  if (!lead) throw new Error("Lead not found.");

  const assigningOther = ownerId && ownerId !== actor.id;
  if (assigningOther && !can(actor, "lead.assign.others")) {
    throw new ForbiddenError("Only Managers and Admins can assign leads to other people.");
  }

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { ownerId, lastActivityAt: new Date() },
  });

  await writeActivity({
    organizationId: actor.organizationId,
    leadId,
    actorUserId: actor.id,
    type: ownerId ? "ASSIGNED" : "UNASSIGNED",
    summary: ownerId
      ? `Assigned to ${(await userName(ownerId)) ?? "someone"}`
      : "Unassigned",
  });
  await writeAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    action: "lead.assign",
    entityType: "Lead",
    entityId: leadId,
    before: { ownerId: lead.ownerId },
    after: { ownerId },
  });

  if (ownerId) {
    await notify({
      organizationId: actor.organizationId,
      userId: ownerId,
      type: "LEAD_ASSIGNED",
      title: `Lead assigned: ${updated.title}`,
      linkUrl: `/leads/${leadId}`,
    });
    await runAutomations({
      organizationId: actor.organizationId,
      trigger: "LEAD_ASSIGNED",
      leadId,
    });
  }
  return updated;
}

export async function changeStage(
  actor: Actor,
  leadId: string,
  toStageId: string,
  reason?: string,
) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: actor.organizationId },
    include: { stage: true },
  });
  if (!lead) throw new Error("Lead not found.");

  const toStage = await prisma.pipelineStage.findFirst({
    where: { id: toStageId, organizationId: actor.organizationId },
  });
  if (!toStage) throw new Error("Target stage not found.");
  if (toStage.id === lead.stageId) return lead;

  if (toStage.isLost && !reason?.trim()) {
    throw new Error("A reason is required when marking a lead Lost.");
  }

  const now = new Date();
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      stageId: toStage.id,
      status: toStage.isWon ? "WON" : toStage.isLost ? "LOST" : "OPEN",
      wonAt: toStage.isWon ? now : null,
      lostAt: toStage.isLost ? now : null,
      lostReason: toStage.isLost ? reason?.trim() ?? null : null,
      lastActivityAt: now,
    },
  });

  await writeActivity({
    organizationId: actor.organizationId,
    leadId,
    actorUserId: actor.id,
    type: toStage.isWon ? "WON" : toStage.isLost ? "LOST" : "STAGE_CHANGED",
    summary: `Stage: ${lead.stage.name} → ${toStage.name}${
      toStage.isLost && reason ? ` — ${reason.trim()}` : ""
    }`,
    meta: { fromStage: lead.stage.key, toStage: toStage.key, reason: reason ?? null },
  });
  await writeAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    action: "lead.stage",
    entityType: "Lead",
    entityId: leadId,
    before: { stage: lead.stage.key },
    after: { stage: toStage.key, reason: reason ?? null },
  });

  await runAutomations({
    organizationId: actor.organizationId,
    trigger: "STAGE_CHANGED",
    leadId,
    context: { toStageKey: toStage.key },
  });
  return updated;
}

export async function setLeadArchived(actor: Actor, leadId: string, archived: boolean) {
  if (!can(actor, "lead.archive")) throw new ForbiddenError();
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: actor.organizationId },
  });
  if (!lead) throw new Error("Lead not found.");
  await prisma.lead.update({
    where: { id: leadId },
    data: { archivedAt: archived ? new Date() : null },
  });
  await writeActivity({
    organizationId: actor.organizationId,
    leadId,
    actorUserId: actor.id,
    type: archived ? "ARCHIVED" : "RESTORED",
    summary: archived ? "Lead archived" : "Lead restored",
  });
}

/**
 * Merge lead B into lead A. Contacts are only merged when the caller explicitly
 * confirms — never automatically. Moves conversations, notes, tasks, activities
 * and touchpoints onto A; keeps A's original source.
 */
export async function mergeLeads(actor: Actor, primaryId: string, dupeId: string) {
  if (!can(actor, "lead.merge")) throw new ForbiddenError();
  if (primaryId === dupeId) throw new Error("Cannot merge a lead into itself.");

  await prisma.$transaction(async (tx) => {
    const [primary, dupe] = await Promise.all([
      tx.lead.findFirst({ where: { id: primaryId, organizationId: actor.organizationId } }),
      tx.lead.findFirst({ where: { id: dupeId, organizationId: actor.organizationId } }),
    ]);
    if (!primary || !dupe) throw new Error("Both leads must exist in your organization.");

    await tx.conversation.updateMany({ where: { leadId: dupeId }, data: { leadId: primaryId } });
    await tx.note.updateMany({ where: { leadId: dupeId }, data: { leadId: primaryId } });
    await tx.task.updateMany({ where: { leadId: dupeId }, data: { leadId: primaryId } });
    await tx.activity.updateMany({ where: { leadId: dupeId }, data: { leadId: primaryId } });
    await tx.touchpoint.updateMany({ where: { leadId: dupeId }, data: { leadId: primaryId } });
    await tx.attachment.updateMany({ where: { leadId: dupeId }, data: { leadId: primaryId } });

    await tx.lead.update({
      where: { id: dupeId },
      data: { archivedAt: new Date(), status: "LOST", lostReason: `Merged into ${primaryId}` },
    });
    await tx.activity.create({
      data: {
        organizationId: actor.organizationId,
        leadId: primaryId,
        actorUserId: actor.id,
        type: "MERGED",
        summary: `Merged lead ${dupeId} into this lead`,
      },
    });
  });

  await writeAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    action: "lead.merge",
    entityType: "Lead",
    entityId: primaryId,
    after: { mergedFrom: dupeId },
  });
}

// ─── helpers ───
async function userName(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? null;
}

export function labelChannel(c: Channel): string {
  return (
    {
      WHATSAPP: "WhatsApp",
      META_LEAD_ADS: "Facebook/Instagram Lead Ads",
      MESSENGER: "Facebook Messenger",
      INSTAGRAM: "Instagram",
      WEBSITE_FORM: "Website form",
      SHEET_FEED: "Google Sheet / CSV feed",
      INDIAMART: "IndiaMART",
      LEAD_API: "Lead intake API",
      EMAIL: "Email",
      PHONE: "Phone",
      MANUAL: "Manual entry",
    } as Record<Channel, string>
  )[c];
}

export function leadDedupeKey(parts: (string | undefined | null)[]): string {
  return stableHash(parts.filter(Boolean).join("|"));
}
