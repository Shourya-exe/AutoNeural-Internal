import { prisma } from "@/lib/prisma";
import { pct } from "@/lib/utils";
import type { Channel } from "@prisma/client";

export interface Period {
  from: Date;
  to: Date;
}

/**
 * ─── Metric definitions (single source of truth) ───────────────────────────
 *
 * newLeads              Leads with createdAt in [from, to).
 * unassignedLeads       status OPEN, archivedAt null, ownerId null (point-in-time).
 * awaitingFirstResponse status OPEN, firstInboundAt set, firstResponseAt null.
 * overdueFollowUps      status OPEN, nextFollowUpAt < now (point-in-time).
 * openPipelineValue     Σ estimatedValue where status OPEN, archivedAt null.
 * wonValue              Σ estimatedValue where status WON and wonAt in [from, to).
 * conversionRate        wonInPeriod / (wonInPeriod + lostInPeriod) * 100,
 *                       counted by wonAt / lostAt in [from, to). If no closed
 *                       leads in the period, rate is 0.
 * firstResponseMins     For leads whose firstResponseAt is in [from, to):
 *                       (firstResponseAt - firstInboundAt) in minutes.
 *                       Reported as median and average. An automated
 *                       acknowledgement never sets firstResponseAt (see
 *                       conversations.sendReply / message.isAutomated).
 */

export async function getOverview(organizationId: string, period: Period) {
  const now = new Date();
  const inPeriod = { gte: period.from, lt: period.to };

  const [
    newLeads,
    unassignedLeads,
    awaitingFirstResponse,
    overdueFollowUps,
    openAgg,
    wonAgg,
    wonCount,
    lostCount,
  ] = await Promise.all([
    prisma.lead.count({ where: { organizationId, createdAt: inPeriod, archivedAt: null } }),
    prisma.lead.count({
      where: { organizationId, status: "OPEN", archivedAt: null, ownerId: null },
    }),
    prisma.lead.count({
      where: {
        organizationId,
        status: "OPEN",
        archivedAt: null,
        firstInboundAt: { not: null },
        firstResponseAt: null,
      },
    }),
    prisma.lead.count({
      where: {
        organizationId,
        status: "OPEN",
        archivedAt: null,
        nextFollowUpAt: { not: null, lt: now },
      },
    }),
    prisma.lead.aggregate({
      _sum: { estimatedValue: true },
      where: { organizationId, status: "OPEN", archivedAt: null },
    }),
    prisma.lead.aggregate({
      _sum: { estimatedValue: true },
      where: { organizationId, status: "WON", wonAt: inPeriod },
    }),
    prisma.lead.count({ where: { organizationId, status: "WON", wonAt: inPeriod } }),
    prisma.lead.count({ where: { organizationId, status: "LOST", lostAt: inPeriod } }),
  ]);

  const responseTimes = await responseTimeSeries(organizationId, period);

  return {
    newLeads,
    unassignedLeads,
    awaitingFirstResponse,
    overdueFollowUps,
    openPipelineValue: openAgg._sum.estimatedValue ?? 0,
    wonValue: wonAgg._sum.estimatedValue ?? 0,
    wonCount,
    lostCount,
    conversionRate: pct(wonCount, wonCount + lostCount),
    firstResponseMedianMins: median(responseTimes),
    firstResponseAvgMins: avg(responseTimes),
  };
}

async function responseTimeSeries(organizationId: string, period: Period): Promise<number[]> {
  const leads = await prisma.lead.findMany({
    where: {
      organizationId,
      firstResponseAt: { gte: period.from, lt: period.to },
      firstInboundAt: { not: null },
    },
    select: { firstInboundAt: true, firstResponseAt: true },
  });
  return leads
    .map((l) =>
      l.firstInboundAt && l.firstResponseAt
        ? (l.firstResponseAt.getTime() - l.firstInboundAt.getTime()) / 60000
        : null,
    )
    .filter((n): n is number => n != null && n >= 0);
}

export async function getSourceVolume(organizationId: string, period: Period) {
  const rows = await prisma.lead.groupBy({
    by: ["sourceChannel"],
    where: { organizationId, createdAt: { gte: period.from, lt: period.to } },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ source: r.sourceChannel as Channel, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

export async function getStageDistribution(organizationId: string) {
  const stages = await prisma.pipelineStage.findMany({
    where: { organizationId },
    orderBy: { order: "asc" },
  });
  const counts = await prisma.lead.groupBy({
    by: ["stageId"],
    where: { organizationId, status: "OPEN", archivedAt: null },
    _count: { _all: true },
    _sum: { estimatedValue: true },
  });
  const byId = new Map(counts.map((c) => [c.stageId, c]));
  return stages.map((s) => ({
    key: s.key,
    name: s.name,
    isWon: s.isWon,
    isLost: s.isLost,
    count: byId.get(s.id)?._count._all ?? 0,
    value: byId.get(s.id)?._sum.estimatedValue ?? 0,
  }));
}

export async function getRecentEnquiries(organizationId: string, take = 8) {
  return prisma.lead.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    include: { contact: true, owner: true, stage: true },
  });
}

export async function getUpcomingTasks(organizationId: string, take = 8) {
  return prisma.task.findMany({
    where: { organizationId, status: "OPEN", dueAt: { not: null } },
    orderBy: { dueAt: "asc" },
    take,
    include: { assignee: true, lead: { include: { contact: true } } },
  });
}

export async function getIntegrationFailures(organizationId: string) {
  const [connections, deadLetters] = await Promise.all([
    prisma.integrationConnection.findMany({
      where: { organizationId, OR: [{ status: "ERROR" }, { lastErrorAt: { not: null } }] },
    }),
    prisma.webhookEvent.count({
      where: { organizationId, status: { in: ["FAILED", "DEAD_LETTER"] } },
    }),
  ]);
  return { connections, deadLetters };
}

// ─── Reports ───

export async function getReportBundle(organizationId: string, period: Period) {
  const [byChannel, conversion, closed, workload, overdue, responseTimes] = await Promise.all([
    leadsByChannelCampaign(organizationId, period),
    pipelineConversion(organizationId, period),
    wonLost(organizationId, period),
    salespersonWorkload(organizationId),
    overdueByOwner(organizationId),
    responseTimeSeries(organizationId, period),
  ]);
  return {
    byChannel,
    conversion,
    closed,
    workload,
    overdue,
    firstResponse: {
      median: median(responseTimes),
      avg: avg(responseTimes),
      p90: percentile(responseTimes, 90),
      count: responseTimes.length,
    },
  };
}

async function leadsByChannelCampaign(organizationId: string, period: Period) {
  const leads = await prisma.lead.findMany({
    where: { organizationId, createdAt: { gte: period.from, lt: period.to } },
    select: { sourceChannel: true, campaignName: true, status: true },
  });
  const map = new Map<string, { channel: string; campaign: string; total: number; won: number }>();
  for (const l of leads) {
    const key = `${l.sourceChannel}::${l.campaignName ?? "—"}`;
    const e = map.get(key) ?? {
      channel: l.sourceChannel,
      campaign: l.campaignName ?? "—",
      total: 0,
      won: 0,
    };
    e.total++;
    if (l.status === "WON") e.won++;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

async function pipelineConversion(organizationId: string, period: Period) {
  const stages = await prisma.pipelineStage.findMany({
    where: { organizationId },
    orderBy: { order: "asc" },
  });
  // Count leads (created in period) that ever entered each stage, using the
  // STAGE_CHANGED / LEAD_CREATED activity trail.
  const leads = await prisma.lead.findMany({
    where: { organizationId, createdAt: { gte: period.from, lt: period.to } },
    select: { id: true, stageId: true },
  });
  const leadIds = leads.map((l) => l.id);
  const activities = await prisma.activity.findMany({
    where: { leadId: { in: leadIds }, type: { in: ["LEAD_CREATED", "STAGE_CHANGED", "WON", "LOST"] } },
    select: { leadId: true, meta: true, type: true },
  });
  const reached = new Map<string, Set<string>>(); // stageKey -> leadIds
  const stageKeys = stages.map((s) => s.key);
  for (const s of stageKeys) reached.set(s, new Set());
  // Everyone reached the first stage.
  const firstKey = stageKeys[0];
  for (const id of leadIds) reached.get(firstKey)!.add(id);
  for (const a of activities) {
    const meta = (a.meta ?? {}) as any;
    const toStage = meta.toStage ?? (a.type === "WON" ? "won" : a.type === "LOST" ? "lost" : null);
    if (toStage && reached.has(toStage)) reached.get(toStage)!.add(a.leadId!);
  }
  const total = leadIds.length || 1;
  return stages.map((s, i) => ({
    key: s.key,
    name: s.name,
    reached: reached.get(s.key)!.size,
    rateFromStart: pct(reached.get(s.key)!.size, total),
    rateFromPrev:
      i === 0
        ? 100
        : pct(reached.get(s.key)!.size, reached.get(stageKeys[i - 1])!.size || 1),
  }));
}

async function wonLost(organizationId: string, period: Period) {
  const [won, lost, lostReasons] = await Promise.all([
    prisma.lead.aggregate({
      _count: { _all: true },
      _sum: { estimatedValue: true },
      where: { organizationId, status: "WON", wonAt: { gte: period.from, lt: period.to } },
    }),
    prisma.lead.aggregate({
      _count: { _all: true },
      _sum: { estimatedValue: true },
      where: { organizationId, status: "LOST", lostAt: { gte: period.from, lt: period.to } },
    }),
    prisma.lead.groupBy({
      by: ["lostReason"],
      where: { organizationId, status: "LOST", lostAt: { gte: period.from, lt: period.to } },
      _count: { _all: true },
    }),
  ]);
  return {
    wonCount: won._count._all,
    wonValue: won._sum.estimatedValue ?? 0,
    lostCount: lost._count._all,
    lostValue: lost._sum.estimatedValue ?? 0,
    lostReasons: lostReasons
      .map((r) => ({ reason: r.lostReason ?? "Unspecified", count: r._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

async function salespersonWorkload(organizationId: string) {
  const members = await prisma.membership.findMany({
    where: { organizationId, role: { in: ["SALES_REP", "MANAGER"] } },
    include: { user: true },
  });
  const out = [];
  for (const m of members) {
    const [openLeads, openTasks, overdueTasks, wonThisMonth] = await Promise.all([
      prisma.lead.count({
        where: { organizationId, ownerId: m.userId, status: "OPEN", archivedAt: null },
      }),
      prisma.task.count({
        where: { organizationId, assigneeId: m.userId, status: "OPEN" },
      }),
      prisma.task.count({
        where: {
          organizationId,
          assigneeId: m.userId,
          status: "OPEN",
          dueAt: { lt: new Date() },
        },
      }),
      prisma.lead.count({
        where: {
          organizationId,
          ownerId: m.userId,
          status: "WON",
          wonAt: { gte: startOfMonth() },
        },
      }),
    ]);
    out.push({
      userId: m.userId,
      name: m.user.name,
      role: m.role,
      openLeads,
      openTasks,
      overdueTasks,
      wonThisMonth,
    });
  }
  return out.sort((a, b) => b.openLeads - a.openLeads);
}

async function overdueByOwner(organizationId: string) {
  const leads = await prisma.lead.findMany({
    where: {
      organizationId,
      status: "OPEN",
      archivedAt: null,
      nextFollowUpAt: { not: null, lt: new Date() },
    },
    include: { owner: true, contact: true },
    orderBy: { nextFollowUpAt: "asc" },
  });
  return leads;
}

// ─── math helpers ───
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}
function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}
function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return Math.round(s[Math.max(0, idx)]);
}
function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}
