import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { toE164 } from "@/lib/phone";
import { DISPLAY_TZ } from "@/lib/datetime";
import { logCallToSheet } from "@/lib/google-sheets";
import { writeActivity } from "./audit";
import { resolveIdentity } from "./identity";
import { findOrCreateLeadForContact } from "./leads";

export interface ListCallLogsArgs {
  organizationId: string;
  leadId?: string;
  direction?: string;
  status?: string;
  sentiment?: string;
  page?: number;
  pageSize?: number;
}

export async function listCallLogs(args: ListCallLogsArgs) {
  const { organizationId, leadId, direction, status, sentiment, page = 1, pageSize = 20 } = args;

  const where: Prisma.CallLogWhereInput = { organizationId };
  if (leadId) where.leadId = leadId;
  if (direction) where.direction = direction;
  if (status) where.status = status;
  if (sentiment) where.sentiment = sentiment;

  const [total, callLogs] = await Promise.all([
    prisma.callLog.count({ where }),
    prisma.callLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        lead: { include: { contact: { select: { fullName: true, primaryPhone: true } } } },
        contact: { select: { fullName: true, primaryPhone: true } },
      },
    }),
  ]);

  return { callLogs, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getCallLogStats(organizationId: string) {
  const [total, inbound, outbound, missed] = await Promise.all([
    prisma.callLog.count({ where: { organizationId } }),
    prisma.callLog.count({ where: { organizationId, direction: "inbound" } }),
    prisma.callLog.count({ where: { organizationId, direction: "outbound" } }),
    prisma.callLog.count({ where: { organizationId, status: "missed" } }),
  ]);

  const totalDuration = await prisma.callLog.aggregate({
    where: { organizationId },
    _sum: { duration: true },
  });

  return {
    total,
    inbound,
    outbound,
    missed,
    totalMinutes: Math.round((totalDuration._sum.duration ?? 0) / 60),
  };
}

export async function listAgentSessions(organizationId: string, limit = 20) {
  return prisma.agentSession.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { lead: { include: { contact: { select: { fullName: true, primaryPhone: true } } } } },
  });
}

// ─────────────────────────── Voice agent call ingestion ───────────────────────────

export interface AgentCallInput {
  organizationId?: string | null;
  leadId?: string | null;
  direction: "inbound" | "outbound";
  fromNumber?: string | null;
  toNumber?: string | null;
  /** The customer's side of the call, whichever direction it went. */
  customerNumber?: string | null;
  duration: number;
  status: string;
  outcome?: string | null;
  language?: string | null;
  transcript?: string | null;
  summary?: string | null;
  sentiment?: string | null;
  nextAction?: string | null;
  roomName: string;
  startedAt?: string | null;
  endedAt?: string | null;
  handoff?: Record<string, unknown> | null;
  failureReason?: string | null;
}

/**
 * The worker is shared by the whole deployment. Calls dispatched by the CRM carry their
 * organization; inbound calls do not, so they go to AGENT_DEFAULT_ORG_ID, or to the only
 * organization when there is exactly one.
 */
async function resolveCallOrganization(requested?: string | null): Promise<string | null> {
  const id = requested || process.env.AGENT_DEFAULT_ORG_ID || null;
  if (id) {
    const org = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    return org?.id ?? null;
  }
  const orgs = await prisma.organization.findMany({ select: { id: true }, take: 2 });
  return orgs.length === 1 ? orgs[0].id : null;
}

function fmtDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const capitalize = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : v);

/**
 * Store a finished voice-agent call: CallLog (Calls page), AgentSession (AI Agent page),
 * an activity on the lead, and a row in the Google Sheet. Unknown inbound callers get a
 * contact + lead through the same identity/dedupe path as every other channel.
 */
export async function recordAgentCall(input: AgentCallInput) {
  const organizationId = await resolveCallOrganization(input.organizationId);
  if (!organizationId) {
    throw new Error(
      "Could not determine the organization for this call. Set AGENT_DEFAULT_ORG_ID in .env.",
    );
  }

  const phone = toE164(input.customerNumber);

  let leadId: string | null = null;
  let contactId: string | null = null;
  if (input.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, organizationId },
      select: { id: true, contactId: true },
    });
    if (lead) {
      leadId = lead.id;
      contactId = lead.contactId;
    }
  }
  if (!leadId && phone) {
    const identity = await resolveIdentity(organizationId, { channel: "PHONE", externalId: phone, phone });
    contactId = identity.contactId;
    const { lead } = await findOrCreateLeadForContact({
      organizationId,
      contactId,
      channel: "PHONE",
      sourceDetail: `AI voice agent (${input.direction} call)`,
    });
    leadId = lead.id;
  }

  const metadata = {
    roomName: input.roomName,
    outcome: input.outcome ?? null,
    language: input.language ?? null,
    nextAction: input.nextAction ?? null,
    handoff: input.handoff ?? null,
    failureReason: input.failureReason ?? null,
  } as Prisma.InputJsonValue;

  const [callLog] = await prisma.$transaction([
    prisma.callLog.create({
      data: {
        organizationId,
        leadId,
        contactId,
        direction: input.direction,
        fromNumber: input.fromNumber ?? null,
        toNumber: input.toNumber ?? null,
        duration: input.duration,
        status: input.status,
        summary: input.summary ?? null,
        sentiment: input.sentiment ?? null,
        transcript: input.transcript ?? null,
        metadata,
      },
    }),
    prisma.agentSession.create({
      data: {
        organizationId,
        leadId,
        roomName: input.roomName,
        phone,
        status: input.status === "completed" ? "completed" : "failed",
        startTime: input.startedAt ? new Date(input.startedAt) : null,
        endTime: input.endedAt ? new Date(input.endedAt) : null,
        duration: input.duration,
        transcript: input.transcript ?? null,
        summary: input.summary ?? null,
        metadata,
      },
    }),
  ]);

  if (leadId) {
    await writeActivity({
      organizationId,
      leadId,
      type: "TOUCHPOINT",
      summary: `AI voice call (${input.direction}, ${input.status}, ${fmtDuration(input.duration)})${
        input.summary ? `: ${input.summary}` : ""
      }`,
      meta: { callLogId: callLog.id, channel: "PHONE" },
    });
  }

  const contactName = contactId
    ? (await prisma.contact.findUnique({ where: { id: contactId }, select: { fullName: true } }))?.fullName
    : null;
  // Same formatting as the rows the earlier calling agent wrote to this sheet.
  const sheet = await logCallToSheet({
    timestamp: formatInTimeZone(input.endedAt ? new Date(input.endedAt) : new Date(), DISPLAY_TZ, "yyyy-MM-dd HH:mm"),
    customer: contactName ?? "",
    phone: phone ?? input.customerNumber ?? "",
    direction: capitalize(input.direction),
    status: input.status,
    duration: fmtDuration(input.duration),
    language: capitalize(input.language ?? ""),
    summary: input.summary ?? "",
    nextAction: input.nextAction ?? "",
    transcript: input.transcript ?? "",
  });
  if (sheet.logged) {
    await prisma.callLog.update({ where: { id: callLog.id }, data: { sheetLogged: true } });
  }

  return { callLogId: callLog.id, leadId, sheetLogged: sheet.logged, sheetError: sheet.error ?? null };
}
