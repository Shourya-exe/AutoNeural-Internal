import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

const STAGES = [
  { key: "new", name: "New Enquiry", order: 1 },
  { key: "contacted", name: "Contacted", order: 2 },
  { key: "qualified", name: "Requirement Qualified", order: 3 },
  { key: "site_visit", name: "Site Visit Scheduled", order: 4 },
  { key: "negotiation", name: "Negotiation", order: 5 },
  { key: "won", name: "Deal Closed", order: 6, isWon: true },
  { key: "lost", name: "Lost", order: 7, isLost: true },
];

export interface TestOrg {
  orgId: string;
  adminId: string;
  managerId: string;
  repId: string;
  rep2Id: string;
  stageIds: Record<string, string>;
}

/** Wipe every table and create a fresh single-org fixture. */
export async function resetDatabase(): Promise<TestOrg> {
  await prisma.$transaction([
    prisma.automationRun.deleteMany(),
    prisma.automationRule.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.activity.deleteMany(),
    prisma.message.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.task.deleteMany(),
    prisma.note.deleteMany(),
    prisma.touchpoint.deleteMany(),
    prisma.leadTag.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.channelIdentity.deleteMany(),
    prisma.contact.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.service.deleteMany(),
    prisma.integrationConnection.deleteMany(),
    prisma.pipelineStage.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.user.deleteMany(),
    prisma.organization.deleteMany(),
  ]);

  const org = await prisma.organization.create({
    data: { name: "AutoNeural Test", slug: `test-${Date.now()}` },
  });

  const mk = async (name: string, email: string, role: any) => {
    const u = await prisma.user.create({
      data: { organizationId: org.id, name, email, passwordHash: "x" },
    });
    await prisma.membership.create({
      data: { organizationId: org.id, userId: u.id, role },
    });
    return u.id;
  };

  const adminId = await mk("Admin User", `admin-${Date.now()}@test.local`, "ADMIN");
  const managerId = await mk("Manager User", `manager-${Date.now()}@test.local`, "MANAGER");
  const repId = await mk("Rep One", `rep1-${Date.now()}@test.local`, "SALES_REP");
  const rep2Id = await mk("Rep Two", `rep2-${Date.now()}@test.local`, "SALES_REP");

  const stageIds: Record<string, string> = {};
  for (const s of STAGES) {
    const stage = await prisma.pipelineStage.create({
      data: {
        organizationId: org.id,
        key: s.key,
        name: s.name,
        order: s.order,
        isWon: (s as any).isWon ?? false,
        isLost: (s as any).isLost ?? false,
      },
    });
    stageIds[s.key] = stage.id;
  }

  // Connect every channel so send-eligibility tests aren't blocked by config.
  for (const channel of ["WHATSAPP", "META_LEAD_ADS", "MESSENGER", "INSTAGRAM", "WEBSITE_FORM"] as const) {
    await prisma.integrationConnection.create({
      data: { organizationId: org.id, channel, label: `${channel} test`, status: "CONNECTED" },
    });
  }

  return { orgId: org.id, adminId, managerId, repId, rep2Id, stageIds };
}

export function actorFor(
  org: TestOrg,
  role: "ADMIN" | "MANAGER" | "SALES_REP",
  userId?: string,
) {
  const id =
    userId ?? (role === "ADMIN" ? org.adminId : role === "MANAGER" ? org.managerId : org.repId);
  return {
    id,
    name: role,
    email: `${role}@test.local`,
    organizationId: org.orgId,
    role,
    isDemo: false,
  };
}

/** Default automation rules matching the production seed. */
export async function seedDefaultAutomations(orgId: string) {
  await prisma.automationRule.createMany({
    data: [
      {
        organizationId: orgId,
        name: "Assign + notify + follow-up",
        trigger: "LEAD_CREATED",
        isEnabled: true,
        order: 1,
        config: {
          assignment: { mode: "round_robin" },
          notify: true,
          createFollowUp: true,
          followUpHours: 4,
        },
      },
      {
        organizationId: orgId,
        name: "Site visit prep task",
        trigger: "STAGE_CHANGED",
        isEnabled: true,
        order: 2,
        config: { stageKey: "site_visit" },
      },
    ],
  });
}
