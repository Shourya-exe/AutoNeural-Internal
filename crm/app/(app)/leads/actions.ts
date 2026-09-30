"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor, requireCan, can, ForbiddenError } from "@/server/auth/context";
import {
  createLead,
  assignLead,
  changeStage,
  setLeadArchived,
  mergeLeads,
} from "@/server/services/leads";
import { createTask, completeTask } from "@/server/services/tasks";
import { writeActivity, writeAudit } from "@/server/services/audit";
import { runAutomations } from "@/server/services/automations";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(e: unknown): Result {
  const msg = e instanceof Error ? e.message : "Something went wrong.";
  return { ok: false, error: msg };
}

// ─── Create ───
const createSchema = z.object({
  fullName: z.string().min(1),
  company: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  serviceId: z.string().optional(),
  interestedService: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  estimatedValue: z.coerce.number().nonnegative().optional(),
  sourceChannel: z.enum([
    "WHATSAPP",
    "META_LEAD_ADS",
    "MESSENGER",
    "INSTAGRAM",
    "WEBSITE_FORM",
    "MANUAL",
  ]),
  ownerId: z.string().optional(),
  title: z.string().optional(),
});

export async function createLeadAction(input: unknown): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "lead.create");
    const data = createSchema.parse(input);

    const contact = await prisma.contact.create({
      data: {
        organizationId: actor.organizationId,
        fullName: data.fullName,
        company: data.company || null,
        primaryEmail: data.email || null,
        primaryPhone: data.phone || null,
      },
    });

    const lead = await createLead(
      actor.organizationId,
      {
        contactId: contact.id,
        title: data.title,
        ownerId: data.ownerId || null,
        serviceId: data.serviceId || null,
        interestedService: data.interestedService || null,
        priority: data.priority,
        estimatedValue: data.estimatedValue ?? null,
        sourceChannel: data.sourceChannel,
      },
      { actor },
    );
    revalidatePath("/leads");
    revalidatePath("/");
    return { ok: true, id: lead.id };
  } catch (e) {
    return fail(e);
  }
}

// ─── Edit core fields ───
const editSchema = z.object({
  leadId: z.string(),
  title: z.string().min(1).optional(),
  serviceId: z.string().nullable().optional(),
  interestedService: z.string().nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  estimatedValue: z.coerce.number().nonnegative().nullable().optional(),
  nextFollowUpAt: z.string().nullable().optional(),
  contact: z
    .object({
      fullName: z.string().min(1).optional(),
      company: z.string().nullable().optional(),
      primaryEmail: z.string().email().nullable().optional().or(z.literal("")),
      primaryPhone: z.string().nullable().optional(),
    })
    .optional(),
});

export async function updateLeadAction(input: unknown): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "lead.edit");
    const data = editSchema.parse(input);
    const lead = await prisma.lead.findFirst({
      where: { id: data.leadId, organizationId: actor.organizationId },
    });
    if (!lead) throw new Error("Lead not found.");

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        title: data.title ?? undefined,
        serviceId: data.serviceId === undefined ? undefined : data.serviceId,
        interestedService:
          data.interestedService === undefined ? undefined : data.interestedService,
        priority: data.priority ?? undefined,
        estimatedValue:
          data.estimatedValue === undefined ? undefined : data.estimatedValue,
        nextFollowUpAt:
          data.nextFollowUpAt === undefined
            ? undefined
            : data.nextFollowUpAt
              ? new Date(data.nextFollowUpAt)
              : null,
        lastActivityAt: new Date(),
      },
    });
    if (data.contact) {
      await prisma.contact.update({
        where: { id: lead.contactId },
        data: {
          fullName: data.contact.fullName ?? undefined,
          company: data.contact.company === undefined ? undefined : data.contact.company,
          primaryEmail:
            data.contact.primaryEmail === undefined
              ? undefined
              : data.contact.primaryEmail || null,
          primaryPhone:
            data.contact.primaryPhone === undefined ? undefined : data.contact.primaryPhone,
        },
      });
    }
    await writeActivity({
      organizationId: actor.organizationId,
      leadId: lead.id,
      actorUserId: actor.id,
      type: "FIELD_UPDATED",
      summary: "Lead details updated",
    });
    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "lead.update",
      entityType: "Lead",
      entityId: lead.id,
      after: { fields: Object.keys(data).filter((k) => k !== "leadId") },
    });
    revalidatePath(`/leads/${lead.id}`);
    return { ok: true, id: lead.id };
  } catch (e) {
    return fail(e);
  }
}

// ─── Assign ───
export async function assignLeadAction(leadId: string, ownerId: string | null): Promise<Result> {
  try {
    const actor = await requireActor();
    await assignLead(actor, leadId, ownerId);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─── Stage change ───
export async function changeStageAction(
  leadId: string,
  stageId: string,
  reason?: string,
): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "pipeline.move");
    await changeStage(actor, leadId, stageId, reason);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/pipeline");
    revalidatePath("/leads");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─── Notes ───
export async function addNoteAction(leadId: string, body: string): Promise<Result> {
  try {
    const actor = await requireActor();
    if (!body.trim()) throw new Error("Note is empty.");
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: actor.organizationId },
    });
    if (!lead) throw new Error("Lead not found.");
    await prisma.note.create({
      data: {
        organizationId: actor.organizationId,
        leadId,
        contactId: lead.contactId,
        authorId: actor.id,
        body: body.trim(),
      },
    });
    await writeActivity({
      organizationId: actor.organizationId,
      leadId,
      actorUserId: actor.id,
      type: "NOTE_ADDED",
      summary: body.trim().slice(0, 140),
    });
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─── Tasks ───
export async function scheduleFollowUpAction(
  leadId: string,
  dueAt: string,
  title: string,
): Promise<Result> {
  try {
    const actor = await requireActor();
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: actor.organizationId },
    });
    if (!lead) throw new Error("Lead not found.");
    await createTask(actor.organizationId, {
      leadId,
      assigneeId: lead.ownerId ?? actor.id,
      creatorId: actor.id,
      type: "FOLLOW_UP",
      title: title || `Follow up: ${lead.title}`,
      dueAt: new Date(dueAt),
      remindAt: new Date(dueAt),
    });
    await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: new Date(dueAt) } });
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function completeTaskAction(taskId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    await completeTask(actor, taskId);
    revalidatePath("/tasks");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─── Bulk ───
export async function bulkAssignAction(leadIds: string[], ownerId: string | null): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "lead.bulk");
    for (const id of leadIds) await assignLead(actor, id, ownerId);
    revalidatePath("/leads");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function bulkStageAction(
  leadIds: string[],
  stageId: string,
  reason?: string,
): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "lead.bulk");
    for (const id of leadIds) await changeStage(actor, id, stageId, reason);
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─── Archive / restore / merge ───
export async function archiveLeadAction(leadId: string, archived: boolean): Promise<Result> {
  try {
    const actor = await requireActor();
    await setLeadArchived(actor, leadId, archived);
    revalidatePath("/leads");
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function mergeLeadsAction(primaryId: string, dupeId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    await mergeLeads(actor, primaryId, dupeId);
    revalidatePath("/leads");
    return { ok: true, id: primaryId };
  } catch (e) {
    return fail(e);
  }
}

// ─── Tags ───
export async function toggleTagAction(leadId: string, tagId: string, on: boolean): Promise<Result> {
  try {
    const actor = await requireActor();
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: actor.organizationId },
    });
    if (!lead) throw new Error("Lead not found.");
    if (on) {
      await prisma.leadTag.upsert({
        where: { leadId_tagId: { leadId, tagId } },
        create: { leadId, tagId },
        update: {},
      });
    } else {
      await prisma.leadTag.deleteMany({ where: { leadId, tagId } });
    }
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
