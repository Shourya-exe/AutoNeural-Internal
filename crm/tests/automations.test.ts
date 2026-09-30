import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDatabase, seedDefaultAutomations, type TestOrg } from "./fixtures";
import { runAutomations } from "@/server/services/automations";
import { createLead } from "@/server/services/leads";
import { createTask } from "@/server/services/tasks";

let org: TestOrg;

async function makeLead() {
  const contact = await prisma.contact.create({
    data: { organizationId: org.orgId, fullName: "Automation Target", primaryPhone: "+919876666666" },
  });
  return createLead(
    org.orgId,
    { contactId: contact.id, sourceChannel: "WEBSITE_FORM" },
    { runAutomations: false },
  );
}

beforeEach(async () => {
  org = await resetDatabase();
  await seedDefaultAutomations(org.orgId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("automation idempotency", () => {
  it("running the same trigger repeatedly performs the work only once", async () => {
    const lead = await makeLead();

    for (let i = 0; i < 5; i++) {
      await runAutomations({ organizationId: org.orgId, trigger: "LEAD_CREATED", leadId: lead.id });
    }

    // One follow-up task, not five.
    expect(await prisma.task.count({ where: { leadId: lead.id } })).toBe(1);
    // One assignment notification, not five.
    expect(
      await prisma.notification.count({ where: { organizationId: org.orgId, type: "LEAD_ASSIGNED" } }),
    ).toBe(1);
    // One recorded run for the LEAD_CREATED rule.
    const rule = await prisma.automationRule.findFirstOrThrow({
      where: { organizationId: org.orgId, trigger: "LEAD_CREATED" },
    });
    expect(await prisma.automationRun.count({ where: { ruleId: rule.id } })).toBe(1);
  });

  it("a disabled rule does nothing and records no run", async () => {
    const rule = await prisma.automationRule.findFirstOrThrow({
      where: { organizationId: org.orgId, trigger: "LEAD_CREATED" },
    });
    await prisma.automationRule.update({ where: { id: rule.id }, data: { isEnabled: false } });

    const lead = await makeLead();
    await runAutomations({ organizationId: org.orgId, trigger: "LEAD_CREATED", leadId: lead.id });

    expect(await prisma.task.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await prisma.automationRun.count({ where: { ruleId: rule.id } })).toBe(0);

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.ownerId).toBeNull();
  });

  it("task creation is idempotent on its dedupe key", async () => {
    const lead = await makeLead();
    for (let i = 0; i < 3; i++) {
      await createTask(org.orgId, {
        leadId: lead.id,
        title: "Call them",
        dedupeKey: `call:${lead.id}`,
      });
    }
    expect(await prisma.task.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("the NO_RESPONSE sweep reminds once per SLA bucket, not once per sweep", async () => {
    await prisma.automationRule.create({
      data: {
        organizationId: org.orgId,
        name: "No response reminder",
        trigger: "NO_RESPONSE",
        isEnabled: true,
        config: { slaMinutes: 120, escalateToManagers: true },
      },
    });

    const lead = await makeLead();
    await prisma.lead.update({
      where: { id: lead.id },
      data: { ownerId: org.repId, firstInboundAt: new Date(Date.now() - 3 * 3600 * 1000) },
    });

    // The worker sweeps every minute — same SLA bucket each time.
    for (let i = 0; i < 4; i++) {
      await runAutomations({
        organizationId: org.orgId,
        trigger: "NO_RESPONSE",
        leadId: lead.id,
        dedupeSuffix: "noresp:bucket-1",
      });
    }
    expect(
      await prisma.notification.count({
        where: { organizationId: org.orgId, type: "NO_RESPONSE" },
      }),
    ).toBe(1);

    // A later bucket is allowed to remind again.
    await runAutomations({
      organizationId: org.orgId,
      trigger: "NO_RESPONSE",
      leadId: lead.id,
      dedupeSuffix: "noresp:bucket-2",
    });
    expect(
      await prisma.notification.count({
        where: { organizationId: org.orgId, type: "NO_RESPONSE" },
      }),
    ).toBe(2);
  });

  it("skips the no-response reminder once a human has replied", async () => {
    await prisma.automationRule.create({
      data: {
        organizationId: org.orgId,
        name: "No response reminder",
        trigger: "NO_RESPONSE",
        isEnabled: true,
        config: { slaMinutes: 120 },
      },
    });
    const lead = await makeLead();
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ownerId: org.repId,
        firstInboundAt: new Date(Date.now() - 3 * 3600 * 1000),
        firstResponseAt: new Date(),
      },
    });

    await runAutomations({
      organizationId: org.orgId,
      trigger: "NO_RESPONSE",
      leadId: lead.id,
      dedupeSuffix: "b1",
    });

    expect(
      await prisma.notification.count({ where: { organizationId: org.orgId, type: "NO_RESPONSE" } }),
    ).toBe(0);
    const run = await prisma.automationRun.findFirstOrThrow({
      where: { organizationId: org.orgId },
    });
    expect(run.detail).toMatch(/already responded/i);
  });

  it("records a FAILED run instead of throwing when a rule handler errors", async () => {
    const rule = await prisma.automationRule.create({
      data: {
        organizationId: org.orgId,
        name: "Broken stage rule",
        trigger: "STAGE_CHANGED",
        isEnabled: true,
        config: { stageKey: "qualified" },
      },
    });

    // leadId points at a lead that does not exist -> handler returns "lead missing"
    await expect(
      runAutomations({
        organizationId: org.orgId,
        trigger: "STAGE_CHANGED",
        leadId: "does-not-exist",
        context: { toStageKey: "qualified" },
      }),
    ).resolves.toBeUndefined();

    const runs = await prisma.automationRun.findMany({ where: { ruleId: rule.id } });
    expect(runs).toHaveLength(1);
    expect(["SUCCESS", "FAILED"]).toContain(runs[0].status);
  });

  it("no seeded rule is allowed to send a customer-facing message", async () => {
    const rules = await prisma.automationRule.findMany({ where: { organizationId: org.orgId } });
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.sendsCustomerMessage).toBe(false);
    }
    // And no automation run ever produced an outbound customer message.
    const lead = await makeLead();
    await runAutomations({ organizationId: org.orgId, trigger: "LEAD_CREATED", leadId: lead.id });
    expect(
      await prisma.message.count({ where: { direction: "OUTBOUND", isInternalNote: false } }),
    ).toBe(0);
  });
});
