import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  prisma,
  resetDatabase,
  actorFor,
  seedDefaultAutomations,
  type TestOrg,
} from "./fixtures";
import { createLead, changeStage } from "@/server/services/leads";

let org: TestOrg;

async function makeLead(ownerId?: string) {
  const contact = await prisma.contact.create({
    data: { organizationId: org.orgId, fullName: "Pipeline Target", primaryPhone: "+919871111111" },
  });
  return createLead(
    org.orgId,
    { contactId: contact.id, sourceChannel: "MANUAL", ownerId: ownerId ?? org.repId },
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

describe("pipeline stage changes", () => {
  it("persists the stage and records it on the activity timeline", async () => {
    const lead = await makeLead();
    const admin = actorFor(org, "ADMIN");

    await changeStage(admin, lead.id, org.stageIds.qualified);

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stageId).toBe(org.stageIds.qualified);
    expect(after.status).toBe("OPEN");

    const activity = await prisma.activity.findFirst({
      where: { leadId: lead.id, type: "STAGE_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(activity).not.toBeNull();
    expect(activity!.summary).toMatch(/New Enquiry → Requirement Qualified/);
    expect((activity!.meta as any).toStage).toBe("qualified");
  });

  it("writes an audit entry for every stage change", async () => {
    const lead = await makeLead();
    const admin = actorFor(org, "ADMIN");
    await changeStage(admin, lead.id, org.stageIds.contacted);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Lead", entityId: lead.id, action: "lead.stage" },
    });
    expect(audit).not.toBeNull();
    expect((audit!.after as any).stage).toBe("contacted");
  });

  it("requires a reason to move a lead to Lost and stores it", async () => {
    const lead = await makeLead();
    const admin = actorFor(org, "ADMIN");

    await expect(changeStage(admin, lead.id, org.stageIds.lost)).rejects.toThrow(
      /reason is required/i,
    );
    // Nothing was persisted by the rejected attempt.
    let after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stageId).toBe(org.stageIds.new);

    await changeStage(admin, lead.id, org.stageIds.lost, "Chose a competitor");
    after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe("LOST");
    expect(after.lostReason).toBe("Chose a competitor");
    expect(after.lostAt).not.toBeNull();
  });

  it("marks a lead Won with a timestamp and no lost reason", async () => {
    const lead = await makeLead();
    const admin = actorFor(org, "ADMIN");
    await changeStage(admin, lead.id, org.stageIds.won);

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe("WON");
    expect(after.wonAt).not.toBeNull();
    expect(after.lostReason).toBeNull();
  });

  it("creates a site-visit task when the opportunity reaches Site Visit Scheduled", async () => {
    const lead = await makeLead();
    const admin = actorFor(org, "ADMIN");

    await changeStage(admin, lead.id, org.stageIds.site_visit);

    const tasks = await prisma.task.findMany({ where: { leadId: lead.id, title: { contains: "Prep site visit" } } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeId).toBe(org.repId);
    expect(tasks[0].title).toMatch(/Prep site visit/);
  });

  it("does not create a site-visit task for any other stage", async () => {
    const lead = await makeLead();
    const admin = actorFor(org, "ADMIN");
    await changeStage(admin, lead.id, org.stageIds.negotiation);
    expect(await prisma.task.count({ where: { title: { contains: "Prep site visit" } } })).toBe(0);
  });
});

describe("lead capture automations", () => {
  it("assigns round-robin, notifies the owner and creates a first follow-up task", async () => {
    const contact = await prisma.contact.create({
      data: { organizationId: org.orgId, fullName: "Auto Target", primaryPhone: "+919872222222" },
    });
    const lead = await createLead(
      org.orgId,
      { contactId: contact.id, sourceChannel: "WEBSITE_FORM" },
      { runAutomations: true },
    );

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.ownerId).not.toBeNull();
    expect(after.nextFollowUpAt).not.toBeNull();

    const tasks = await prisma.task.findMany({ where: { leadId: lead.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe("FOLLOW_UP");
    expect(tasks[0].assigneeId).toBe(after.ownerId);

    const notifications = await prisma.notification.findMany({
      where: { userId: after.ownerId!, type: "LEAD_ASSIGNED" },
    });
    expect(notifications.length).toBeGreaterThan(0);
  });

  it("rotates round-robin assignment across eligible members", async () => {
    const owners: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const contact = await prisma.contact.create({
        data: { organizationId: org.orgId, fullName: `RR ${i}`, primaryPhone: `+91987333000${i}` },
      });
      const lead = await createLead(
        org.orgId,
        { contactId: contact.id, sourceChannel: "WEBSITE_FORM" },
        { runAutomations: true },
      );
      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      owners.push(after.ownerId);
    }
    // Three different eligible members (manager + 2 reps) => no repeats.
    expect(new Set(owners).size).toBe(3);
  });
});
