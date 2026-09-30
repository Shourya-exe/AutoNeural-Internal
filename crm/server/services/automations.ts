import { prisma } from "@/lib/prisma";
import { stableHash } from "@/lib/utils";
import { resolveAssignment } from "./assignment";
import { createTask } from "./tasks";
import { notify, notifyManagers } from "./notifications";
import { writeActivity } from "./audit";
import type { AutomationTrigger } from "@prisma/client";

/**
 * Rule-based automation engine.
 *
 * Design guarantees:
 *  - Idempotent: every rule execution writes an AutomationRun with a unique
 *    (ruleId, dedupeKey). A repeated trigger for the same key is SKIPPED, so
 *    retries never double-assign, double-task, or double-message.
 *  - Customer-facing messages are OFF unless rule.sendsCustomerMessage === true
 *    AND the channel/consent checks pass (enforced in the messaging service).
 *  - Failures are captured on the AutomationRun (status FAILED) and never throw
 *    out of here — ingestion / API flows continue.
 */

export interface RunAutomationsArgs {
  organizationId: string;
  trigger: AutomationTrigger;
  leadId?: string;
  /** Extra trigger context, e.g. { toStageKey: "demo_scheduled" }. */
  context?: Record<string, unknown>;
  /** Override the natural dedupe key (used by scheduled sweeps). */
  dedupeSuffix?: string;
}

export async function runAutomations(args: RunAutomationsArgs): Promise<void> {
  const rules = await prisma.automationRule.findMany({
    where: { organizationId: args.organizationId, trigger: args.trigger, isEnabled: true },
    orderBy: { order: "asc" },
  });
  for (const rule of rules) {
    await executeRule(rule.id, args).catch(() => {
      /* executeRule already records FAILED runs */
    });
  }
}

async function executeRule(ruleId: string, args: RunAutomationsArgs) {
  const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
  if (!rule || !rule.isEnabled) return;

  const dedupeKey = stableHash(
    [rule.id, rule.trigger, args.leadId ?? "-", args.dedupeSuffix ?? "-"].join("|"),
  );

  // Idempotency gate.
  const already = await prisma.automationRun.findUnique({
    where: { ruleId_dedupeKey: { ruleId: rule.id, dedupeKey } },
  });
  if (already) return;

  // Only link the run to a lead that actually exists — a run must still be
  // recorded (for failure visibility) when the lead was deleted or never valid.
  const leadExists = args.leadId
    ? (await prisma.lead.count({ where: { id: args.leadId } })) > 0
    : false;

  const record = async (
    status: "SUCCESS" | "FAILED" | "SKIPPED",
    detail: string,
  ) => {
    await prisma.automationRun
      .create({
        data: {
          organizationId: rule.organizationId,
          ruleId: rule.id,
          leadId: leadExists ? args.leadId! : null,
          status,
          detail,
          dedupeKey,
        },
      })
      .catch((e) => {
        // A unique-constraint race means another worker recorded it first.
        if (e?.code !== "P2002") {
          console.error("[automations] could not record run", e);
        }
      });
  };

  try {
    const cfg = (rule.config ?? {}) as Record<string, any>;
    switch (rule.trigger) {
      case "LEAD_CREATED": {
        const detail = await onLeadCreated(rule.organizationId, args.leadId!, cfg);
        await record("SUCCESS", detail);
        break;
      }
      case "LEAD_ASSIGNED": {
        const detail = await onLeadAssigned(rule.organizationId, args.leadId!, cfg);
        await record("SUCCESS", detail);
        break;
      }
      case "STAGE_CHANGED": {
        const toStageKey = String(args.context?.toStageKey ?? "");
        if (cfg.stageKey && cfg.stageKey !== toStageKey) {
          await record("SKIPPED", `Stage ${toStageKey} does not match rule stage ${cfg.stageKey}`);
          break;
        }
        const detail = await onStageChanged(rule.organizationId, args.leadId!, toStageKey, cfg);
        await record("SUCCESS", detail);
        break;
      }
      case "NO_RESPONSE": {
        const detail = await onNoResponse(rule.organizationId, args.leadId!, cfg);
        await record("SUCCESS", detail);
        break;
      }
      case "FOLLOW_UP_OVERDUE": {
        const detail = await onFollowUpOverdue(rule.organizationId, args.leadId!, cfg);
        await record("SUCCESS", detail);
        break;
      }
      default:
        await record("SKIPPED", `No handler for trigger ${rule.trigger}`);
    }
  } catch (err) {
    await record("FAILED", err instanceof Error ? err.message : String(err));
  }
}

// ───────────────────────── handlers ─────────────────────────

async function onLeadCreated(orgId: string, leadId: string, cfg: Record<string, any>) {
  const actions: string[] = [];
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return "Lead vanished before automation ran";

  // 1. Assign (round-robin or fixed) if not already owned.
  let ownerId = lead.ownerId;
  if (!ownerId && cfg.assign !== false) {
    ownerId = await resolveAssignment(orgId, cfg.assignment ?? { mode: "round_robin" });
    if (ownerId) {
      await prisma.lead.update({ where: { id: leadId }, data: { ownerId } });
      await writeActivity({
        organizationId: orgId,
        leadId,
        type: "ASSIGNED",
        summary: `Auto-assigned (${cfg.assignment?.mode ?? "round_robin"})`,
      });
      actions.push("assigned");
    }
  }

  // 2. Notify the owner.
  if (ownerId && cfg.notify !== false) {
    await notify({
      organizationId: orgId,
      userId: ownerId,
      type: "LEAD_ASSIGNED",
      title: `New lead: ${lead.title}`,
      body: `Source: ${lead.sourceChannel}`,
      linkUrl: `/leads/${leadId}`,
    });
    actions.push("notified owner");
  }

  // 3. Create the first follow-up task.
  if (cfg.createFollowUp !== false) {
    const hours = Number(cfg.followUpHours ?? 4);
    const dueAt = new Date(Date.now() + hours * 3600 * 1000);
    await createTask(orgId, {
      leadId,
      assigneeId: ownerId,
      type: "FOLLOW_UP",
      title: `First follow-up: ${lead.title}`,
      description: `Auto-created on lead capture. Contact within ${hours}h.`,
      dueAt,
      remindAt: dueAt,
      dedupeKey: `firstfollowup:${leadId}`,
    });
    await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: dueAt } });
    actions.push("follow-up task");
  }

  return actions.length ? actions.join(", ") : "no-op (all actions disabled)";
}

async function onLeadAssigned(orgId: string, leadId: string, _cfg: Record<string, any>) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead?.ownerId) return "no owner";
  await notify({
    organizationId: orgId,
    userId: lead.ownerId,
    type: "LEAD_ASSIGNED",
    title: `You now own: ${lead.title}`,
    linkUrl: `/leads/${leadId}`,
  });
  return "notified new owner";
}

async function onStageChanged(
  orgId: string,
  leadId: string,
  toStageKey: string,
  cfg: Record<string, any>,
) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return "lead missing";
  const targetKey = cfg.stageKey ?? "site_visit";
  if (toStageKey !== targetKey) return `stage ${toStageKey} != ${targetKey}, skipped`;

  await createTask(orgId, {
    leadId,
    assigneeId: lead.ownerId,
    type: "GENERIC",
    title: `Prep site visit: ${lead.title}`,
    description:
      "Auto-created when the opportunity reached Site Visit Scheduled. Confirm date/time, venue address, and documents.",
    dueAt: lead.nextFollowUpAt ?? new Date(Date.now() + 24 * 3600 * 1000),
    dedupeKey: `sitevisit:${leadId}`,
  });
  return "created demo-prep task";
}

async function onNoResponse(orgId: string, leadId: string, cfg: Record<string, any>) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return "lead missing";
  if (lead.firstResponseAt) return "already responded, skipped";

  if (lead.ownerId) {
    await notify({
      organizationId: orgId,
      userId: lead.ownerId,
      type: "NO_RESPONSE",
      title: `Awaiting first response: ${lead.title}`,
      body: `No human reply yet. SLA is ${cfg.slaMinutes ?? "configured"} minutes.`,
      linkUrl: `/leads/${leadId}`,
    });
  }
  if (cfg.escalateToManagers) {
    await notifyManagers({
      organizationId: orgId,
      type: "ESCALATION",
      title: `SLA breach — no first response: ${lead.title}`,
      linkUrl: `/leads/${leadId}`,
    });
  }
  return "reminded owner about missing first response";
}

async function onFollowUpOverdue(orgId: string, leadId: string, _cfg: Record<string, any>) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return "lead missing";
  await notifyManagers({
    organizationId: orgId,
    type: "ESCALATION",
    title: `Overdue follow-up: ${lead.title}`,
    body: lead.ownerId ? `Owner has an overdue follow-up.` : `Unassigned lead with overdue follow-up.`,
    linkUrl: `/leads/${leadId}`,
  });
  if (lead.ownerId) {
    await notify({
      organizationId: orgId,
      userId: lead.ownerId,
      type: "ESCALATION",
      title: `Your follow-up is overdue: ${lead.title}`,
      linkUrl: `/leads/${leadId}`,
    });
  }
  return "escalated overdue follow-up";
}
