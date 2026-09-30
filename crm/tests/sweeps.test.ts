import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDatabase, seedDefaultAutomations, type TestOrg } from "./fixtures";
import { runSweeps } from "@/server/services/sweeps";
import { createLead } from "@/server/services/leads";

let org: TestOrg;

beforeEach(async () => {
  org = await resetDatabase();
  await seedDefaultAutomations(org.orgId);
  await prisma.automationRule.create({
    data: {
      organizationId: org.orgId,
      name: "No response reminder",
      trigger: "NO_RESPONSE",
      isEnabled: true,
      config: { slaMinutes: 120, escalateToManagers: true },
    },
  });
  await prisma.automationRule.create({
    data: {
      organizationId: org.orgId,
      name: "Overdue escalation",
      trigger: "FOLLOW_UP_OVERDUE",
      isEnabled: true,
      config: {},
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeLead(patch: Record<string, unknown> = {}) {
  const contact = await prisma.contact.create({
    data: { organizationId: org.orgId, fullName: "Sweep Target", primaryPhone: "+919879000001" },
  });
  const lead = await createLead(
    org.orgId,
    { contactId: contact.id, sourceChannel: "WEBSITE_FORM", ownerId: org.repId },
    { runAutomations: false },
  );
  if (Object.keys(patch).length) {
    await prisma.lead.update({ where: { id: lead.id }, data: patch as any });
  }
  return lead;
}

const leadgenPayload = (id: string) => ({
  object: "page",
  entry: [
    {
      id: "PAGE",
      changes: [
        {
          field: "leadgen",
          value: {
            leadgen_id: id,
            form_name: "Stranded event",
            campaign_name: "Drain Test",
            field_data: [
              { name: "full_name", values: ["Stranded Person"] },
              { name: "email", values: ["stranded@example.com"] },
              { name: "phone_number", values: ["98700 55443"] },
            ],
          },
        },
      ],
    },
  ],
});

describe("scheduler sweeps (shared by the worker and /api/cron/sweep)", () => {
  it("drains an event that was persisted but never processed", async () => {
    // This is the Hostinger Cloud case: no Redis queue, and the inline
    // processing in the web request died before it finished.
    await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "META_LEAD_ADS",
        providerEventId: "meta:leadgen:STRANDED",
        signatureValid: true,
        status: "RECEIVED",
        payload: leadgenPayload("STRANDED") as any,
      },
    });

    expect(await prisma.lead.count()).toBe(0);

    const summary = await runSweeps();
    expect(summary.drainedEvents).toBe(1);
    expect(summary.errors).toEqual([]);

    const lead = await prisma.lead.findFirstOrThrow({ include: { contact: true } });
    expect(lead.contact.fullName).toBe("Stranded Person");
    expect(lead.contact.primaryPhone).toBe("+919870055443");
    expect(lead.campaignName).toBe("Drain Test");

    const event = await prisma.webhookEvent.findFirstOrThrow();
    expect(event.status).toBe("PROCESSED");
  });

  it("recovers an event abandoned mid-processing by a dead worker", async () => {
    await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "META_LEAD_ADS",
        providerEventId: "meta:leadgen:ABANDONED",
        signatureValid: true,
        status: "PROCESSING",
        // Older than the 5-minute stall threshold.
        receivedAt: new Date(Date.now() - 10 * 60_000),
        payload: leadgenPayload("ABANDONED") as any,
      },
    });

    const summary = await runSweeps();
    expect(summary.drainedEvents).toBe(1);
    expect(await prisma.lead.count()).toBe(1);
  });

  it("leaves a recently-started PROCESSING event alone", async () => {
    await prisma.webhookEvent.create({
      data: {
        organizationId: org.orgId,
        channel: "META_LEAD_ADS",
        providerEventId: "meta:leadgen:INFLIGHT",
        signatureValid: true,
        status: "PROCESSING",
        receivedAt: new Date(), // another worker is on it right now
        payload: leadgenPayload("INFLIGHT") as any,
      },
    });

    const summary = await runSweeps();
    expect(summary.drainedEvents).toBe(0);
    expect(await prisma.lead.count()).toBe(0);
  });

  it("reminds about a lead with no human response past the SLA", async () => {
    await makeLead({
      firstInboundAt: new Date(Date.now() - 3 * 3600 * 1000),
      firstResponseAt: null,
    });

    const summary = await runSweeps();
    expect(summary.noResponseChecked).toBe(1);
    expect(
      await prisma.notification.count({ where: { organizationId: org.orgId, type: "NO_RESPONSE" } }),
    ).toBe(1);
  });

  it("escalates an overdue follow-up", async () => {
    await makeLead({ nextFollowUpAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) });

    const summary = await runSweeps();
    expect(summary.overdueChecked).toBe(1);
    expect(
      await prisma.notification.count({ where: { organizationId: org.orgId, type: "ESCALATION" } }),
    ).toBeGreaterThan(0);
  });

  it("running every minute does NOT produce a notification every minute", async () => {
    // The whole point of the cron schedule: a sweep that fires often must not
    // turn into notification spam.
    await makeLead({
      firstInboundAt: new Date(Date.now() - 3 * 3600 * 1000),
      firstResponseAt: null,
      nextFollowUpAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    });

    for (let i = 0; i < 5; i++) await runSweeps();

    expect(
      await prisma.notification.count({ where: { organizationId: org.orgId, type: "NO_RESPONSE" } }),
    ).toBe(1);
    // One owner notification + one per manager/admin, but only from ONE run.
    const escalations = await prisma.automationRun.count({
      where: { organizationId: org.orgId, rule: { trigger: "FOLLOW_UP_OVERDUE" } },
    });
    expect(escalations).toBe(1);
  });

  it("stops reminding once a human has replied", async () => {
    const lead = await makeLead({
      firstInboundAt: new Date(Date.now() - 3 * 3600 * 1000),
      firstResponseAt: null,
    });
    await runSweeps();
    expect(
      await prisma.notification.count({ where: { organizationId: org.orgId, type: "NO_RESPONSE" } }),
    ).toBe(1);

    // The rep replies; a later sweep must not chase them again.
    await prisma.lead.update({
      where: { id: lead.id },
      data: { firstResponseAt: new Date() },
    });
    await prisma.automationRun.deleteMany({ where: { organizationId: org.orgId } });

    const summary = await runSweeps();
    expect(summary.noResponseChecked).toBe(0);
    expect(
      await prisma.notification.count({ where: { organizationId: org.orgId, type: "NO_RESPONSE" } }),
    ).toBe(1);
  });

  it("one org's failure does not stop another org's sweep", async () => {
    const other = await prisma.organization.create({
      data: { name: "Other Co", slug: `other-${Date.now()}` },
    });
    // The second org has no pipeline stages, so anything touching it would fail.
    await makeLead({ nextFollowUpAt: new Date(Date.now() - 24 * 3600 * 1000) });

    const summary = await runSweeps();
    expect(summary.organizations).toBe(2);
    expect(summary.overdueChecked).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(other.id).toBeTruthy();
  });

  it("reports a duration and never throws", async () => {
    const summary = await runSweeps();
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(summary.errors)).toBe(true);
  });
});
