import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDatabase, actorFor, type TestOrg } from "./fixtures";
import { can, requireCan, ForbiddenError } from "@/server/auth/permissions";
import { assignLead, setLeadArchived, mergeLeads, createLead } from "@/server/services/leads";

let org: TestOrg;

async function makeLead(ownerId?: string | null) {
  const contact = await prisma.contact.create({
    data: { organizationId: org.orgId, fullName: "RBAC Target", primaryPhone: "+919870000001" },
  });
  return createLead(
    org.orgId,
    { contactId: contact.id, sourceChannel: "MANUAL", ownerId: ownerId ?? null },
    { runAutomations: false },
  );
}

beforeEach(async () => {
  org = await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("capability map", () => {
  it("gives Sales Reps the day-to-day capabilities only", () => {
    const rep = actorFor(org, "SALES_REP");
    expect(can(rep, "lead.create")).toBe(true);
    expect(can(rep, "lead.edit")).toBe(true);
    expect(can(rep, "pipeline.move")).toBe(true);
    expect(can(rep, "task.manage")).toBe(true);
    expect(can(rep, "inbox.send")).toBe(true);

    expect(can(rep, "lead.assign.others")).toBe(false);
    expect(can(rep, "lead.bulk")).toBe(false);
    expect(can(rep, "lead.archive")).toBe(false);
    expect(can(rep, "lead.merge")).toBe(false);
    expect(can(rep, "lead.import")).toBe(false);
    expect(can(rep, "lead.export")).toBe(false);
    expect(can(rep, "reports.view")).toBe(false);
    expect(can(rep, "settings.team")).toBe(false);
    expect(can(rep, "settings.integrations")).toBe(false);
    expect(can(rep, "webhook.replay")).toBe(false);
  });

  it("gives Managers team-level capabilities but not admin ones", () => {
    const mgr = actorFor(org, "MANAGER");
    expect(can(mgr, "lead.assign.others")).toBe(true);
    expect(can(mgr, "lead.bulk")).toBe(true);
    expect(can(mgr, "reports.view")).toBe(true);
    expect(can(mgr, "settings.audit")).toBe(true);

    expect(can(mgr, "settings.team")).toBe(false);
    expect(can(mgr, "settings.integrations")).toBe(false);
    expect(can(mgr, "settings.automations")).toBe(false);
    expect(can(mgr, "webhook.replay")).toBe(false);
  });

  it("gives Admins everything", () => {
    const admin = actorFor(org, "ADMIN");
    for (const cap of [
      "lead.create",
      "lead.bulk",
      "lead.merge",
      "reports.view",
      "settings.team",
      "settings.pipeline",
      "settings.integrations",
      "settings.automations",
      "settings.audit",
      "webhook.replay",
    ] as const) {
      expect(can(admin, cap)).toBe(true);
    }
  });

  it("requireCan throws ForbiddenError for a missing capability", () => {
    const rep = actorFor(org, "SALES_REP");
    expect(() => requireCan(rep, "settings.team")).toThrow(ForbiddenError);
    expect(() => requireCan(rep, "lead.create")).not.toThrow();
  });
});

describe("server-side enforcement (not just hidden UI)", () => {
  it("blocks a Sales Rep from assigning a lead to someone else", async () => {
    const lead = await makeLead();
    const rep = actorFor(org, "SALES_REP", org.repId);

    await expect(assignLead(rep, lead.id, org.rep2Id)).rejects.toBeInstanceOf(ForbiddenError);

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.ownerId).toBeNull(); // unchanged
  });

  it("allows a Sales Rep to assign a lead to themselves", async () => {
    const lead = await makeLead();
    const rep = actorFor(org, "SALES_REP", org.repId);

    await assignLead(rep, lead.id, org.repId);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.ownerId).toBe(org.repId);
  });

  it("allows a Manager to reassign to anyone", async () => {
    const lead = await makeLead(org.repId);
    const mgr = actorFor(org, "MANAGER");

    await assignLead(mgr, lead.id, org.rep2Id);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.ownerId).toBe(org.rep2Id);
  });

  it("blocks a Sales Rep from archiving or merging leads", async () => {
    const a = await makeLead();
    const b = await makeLead();
    const rep = actorFor(org, "SALES_REP", org.repId);

    await expect(setLeadArchived(rep, a.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(mergeLeads(rep, a.id, b.id)).rejects.toBeInstanceOf(ForbiddenError);

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.archivedAt).toBeNull();
  });

  it("never reaches a lead in another organization", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: "Other", slug: `o-${Date.now()}` },
    });
    const otherStage = await prisma.pipelineStage.create({
      data: { organizationId: otherOrg.id, key: "new", name: "New", order: 1 },
    });
    const otherContact = await prisma.contact.create({
      data: { organizationId: otherOrg.id, fullName: "Outsider" },
    });
    const otherLead = await prisma.lead.create({
      data: {
        organizationId: otherOrg.id,
        contactId: otherContact.id,
        stageId: otherStage.id,
        title: "Outsider lead",
        sourceChannel: "MANUAL",
      },
    });

    const admin = actorFor(org, "ADMIN"); // admin of a DIFFERENT org
    await expect(assignLead(admin, otherLead.id, org.repId)).rejects.toThrow(/not found/i);
  });
});
