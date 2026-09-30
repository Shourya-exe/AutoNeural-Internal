"use server";

import { env } from "@/lib/env";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor, requireCan } from "@/server/auth/context";
import { encryptJson } from "@/lib/crypto";
import { writeAudit } from "@/server/services/audit";
import { getAdapter } from "@/server/integrations/registry";
import { processWebhookEvent } from "@/server/services/ingestion";
import { slugify } from "@/lib/utils";
import type { Channel } from "@prisma/client";

type Result = { ok: true; detail?: string } | { ok: false; error: string };
const fail = (e: unknown): Result => ({
  ok: false,
  error: e instanceof Error ? e.message : "Something went wrong.",
});

// ─────────────── Integrations ───────────────

/**
 * Fire a SIMULATED provider event through the REAL ingestion pipeline.
 * The stored WebhookEvent is flagged isSimulated so it is never mistaken for a
 * live provider delivery.
 */
export async function simulateEventAction(
  channel: Channel,
  input: { name?: string; phone?: string; email?: string; message?: string; service?: string },
): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.integrations");
    if (!env.demoMode) throw new Error("Simulated events are disabled in the company workspace.");
    const adapter = getAdapter(channel);
    if (!adapter) throw new Error(`No adapter for ${channel}`);

    const { payload, providerEventId } = adapter.buildSimulatedPayload(input);

    const event = await prisma.webhookEvent.upsert({
      where: {
        organizationId_channel_providerEventId: {
          organizationId: actor.organizationId,
          channel,
          providerEventId,
        },
      },
      update: {},
      create: {
        organizationId: actor.organizationId,
        channel,
        providerEventId,
        signatureValid: true,
        status: "RECEIVED",
        payload: payload as any,
        isSimulated: true,
      },
    });

    const res = await processWebhookEvent(event.id);
    revalidatePath("/settings/integrations");
    revalidatePath("/leads");
    revalidatePath("/inbox");
    revalidatePath("/");
    return {
      ok: true,
      detail: `Simulated event processed (${res.status})${res.detail ? `: ${res.detail}` : ""}`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function replayWebhookEventAction(eventId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "webhook.replay");
    const event = await prisma.webhookEvent.findFirst({
      where: { id: eventId, organizationId: actor.organizationId },
    });
    if (!event) throw new Error("Event not found.");
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { status: "RECEIVED", error: null, nextRetryAt: null },
    });
    const res = await processWebhookEvent(eventId);
    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "webhook.replay",
      entityType: "WebhookEvent",
      entityId: eventId,
      after: { status: res.status },
    });
    revalidatePath("/settings/integrations");
    return { ok: true, detail: `Replay result: ${res.status}` };
  } catch (e) {
    return fail(e);
  }
}

const connSchema = z.object({
  channel: z.enum(["WHATSAPP", "META_LEAD_ADS", "MESSENGER", "INSTAGRAM", "WEBSITE_FORM"]),
  label: z.string().min(1),
  status: z.enum([
    "NOT_CONFIGURED",
    "SETUP_INCOMPLETE",
    "CONNECTED",
    "PERMISSION_REQUIRED",
    "ERROR",
  ]),
  // Secrets are encrypted at rest and never returned to the client.
  secrets: z.record(z.string()).optional(),
  publicConfig: z.record(z.string()).optional(),
});

export async function saveIntegrationAction(input: unknown): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.integrations");
    const data = connSchema.parse(input);

    await prisma.integrationConnection.upsert({
      where: {
        organizationId_channel: { organizationId: actor.organizationId, channel: data.channel },
      },
      update: {
        label: data.label,
        status: data.status,
        publicConfig: (data.publicConfig ?? {}) as any,
        ...(data.secrets && Object.keys(data.secrets).length
          ? { encryptedConfig: encryptJson(data.secrets) }
          : {}),
      },
      create: {
        organizationId: actor.organizationId,
        channel: data.channel,
        label: data.label,
        status: data.status,
        publicConfig: (data.publicConfig ?? {}) as any,
        encryptedConfig: data.secrets ? encryptJson(data.secrets) : null,
      },
    });

    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "integration.save",
      entityType: "IntegrationConnection",
      entityId: data.channel,
      after: { label: data.label, status: data.status }, // secrets are redacted by writeAudit
    });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─────────────── Automations ───────────────

export async function toggleAutomationAction(ruleId: string, enabled: boolean): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.automations");
    const rule = await prisma.automationRule.findFirst({
      where: { id: ruleId, organizationId: actor.organizationId },
    });
    if (!rule) throw new Error("Rule not found.");
    await prisma.automationRule.update({ where: { id: ruleId }, data: { isEnabled: enabled } });
    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "automation.toggle",
      entityType: "AutomationRule",
      entityId: ruleId,
      before: { isEnabled: rule.isEnabled },
      after: { isEnabled: enabled },
    });
    revalidatePath("/settings/automations");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateAutomationConfigAction(
  ruleId: string,
  config: Record<string, unknown>,
): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.automations");
    const rule = await prisma.automationRule.findFirst({
      where: { id: ruleId, organizationId: actor.organizationId },
    });
    if (!rule) throw new Error("Rule not found.");
    await prisma.automationRule.update({
      where: { id: ruleId },
      data: { config: { ...(rule.config as any), ...config } },
    });
    revalidatePath("/settings/automations");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─────────────── Team ───────────────

export async function changeRoleAction(
  userId: string,
  role: "ADMIN" | "MANAGER" | "SALES_REP",
): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.team");
    const membership = await prisma.membership.findFirst({
      where: { userId, organizationId: actor.organizationId },
    });
    if (!membership) throw new Error("Team member not found.");
    if (userId === actor.id && role !== "ADMIN") {
      throw new Error("You cannot remove your own Admin role.");
    }
    await prisma.membership.update({ where: { id: membership.id }, data: { role } });
    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "team.role",
      entityType: "Membership",
      entityId: membership.id,
      before: { role: membership.role },
      after: { role },
    });
    revalidatePath("/settings/team");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setUserActiveAction(userId: string, isActive: boolean): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.team");
    if (userId === actor.id && !isActive) throw new Error("You cannot deactivate yourself.");
    await prisma.user.updateMany({
      where: { id: userId, organizationId: actor.organizationId },
      data: { isActive },
    });
    revalidatePath("/settings/team");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─────────────── Pipeline / catalog ───────────────

export async function renameStageAction(stageId: string, name: string): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.pipeline");
    if (!name.trim()) throw new Error("Name is required.");
    await prisma.pipelineStage.updateMany({
      where: { id: stageId, organizationId: actor.organizationId },
      data: { name: name.trim() },
    });
    revalidatePath("/settings/pipeline");
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addServiceAction(name: string): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.services");
    if (!name.trim()) throw new Error("Name is required.");
    await prisma.service.create({
      data: { organizationId: actor.organizationId, name: name.trim() },
    });
    revalidatePath("/settings/catalog");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addTagAction(name: string, color: string): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.services");
    if (!name.trim()) throw new Error("Name is required.");
    await prisma.tag.create({
      data: { organizationId: actor.organizationId, name: name.trim(), color },
    });
    revalidatePath("/settings/catalog");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTagAction(tagId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.services");
    await prisma.tag.deleteMany({ where: { id: tagId, organizationId: actor.organizationId } });
    revalidatePath("/settings/catalog");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─────────────── Org preferences ───────────────

export async function updateOrgSlaAction(
  noResponseSlaMins: number,
  followUpSlaHours: number,
): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "settings.automations");
    await prisma.organization.update({
      where: { id: actor.organizationId },
      data: {
        noResponseSlaMins: Math.max(5, noResponseSlaMins),
        followUpSlaHours: Math.max(1, followUpSlaHours),
      },
    });
    revalidatePath("/settings/automations");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
