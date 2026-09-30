import { prisma } from "@/lib/prisma";
import type { Channel, LeadStatus, Prisma, Priority } from "@prisma/client";

export interface LeadListParams {
  organizationId: string;
  q?: string;
  source?: Channel;
  stageKey?: string;
  ownerId?: string; // "unassigned" | userId
  serviceId?: string;
  priority?: Priority;
  tag?: string; // tag id
  status?: LeadStatus | "ALL";
  overdueOnly?: boolean;
  archived?: boolean;
  from?: Date;
  to?: Date;
  sort?: string; // createdAt|lastActivityAt|nextFollowUpAt|estimatedValue|title
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const SORTABLE: Record<string, keyof Prisma.LeadOrderByWithRelationInput> = {
  createdAt: "createdAt",
  lastActivityAt: "lastActivityAt",
  nextFollowUpAt: "nextFollowUpAt",
  estimatedValue: "estimatedValue",
  title: "title",
};

export async function listLeads(params: LeadListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25));

  const where: Prisma.LeadWhereInput = {
    organizationId: params.organizationId,
    archivedAt: params.archived ? { not: null } : null,
  };

  if (params.status && params.status !== "ALL") where.status = params.status;
  if (params.source) where.sourceChannel = params.source;
  if (params.serviceId) where.serviceId = params.serviceId;
  if (params.priority) where.priority = params.priority;
  if (params.stageKey) where.stage = { key: params.stageKey };
  if (params.ownerId === "unassigned") where.ownerId = null;
  else if (params.ownerId) where.ownerId = params.ownerId;
  if (params.tag) where.tags = { some: { tagId: params.tag } };
  if (params.overdueOnly) where.nextFollowUpAt = { not: null, lt: new Date() };
  if (params.from || params.to) {
    where.createdAt = {};
    if (params.from) (where.createdAt as any).gte = params.from;
    if (params.to) (where.createdAt as any).lt = params.to;
  }
  if (params.q?.trim()) {
    const q = params.q.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { interestedService: { contains: q, mode: "insensitive" } },
      { campaignName: { contains: q, mode: "insensitive" } },
      { contact: { is: { fullName: { contains: q, mode: "insensitive" } } } },
      { contact: { is: { company: { contains: q, mode: "insensitive" } } } },
      { contact: { is: { primaryEmail: { contains: q, mode: "insensitive" } } } },
      { contact: { is: { primaryPhone: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const orderKey = SORTABLE[params.sort ?? "lastActivityAt"] ?? "lastActivityAt";
  const orderBy: Prisma.LeadOrderByWithRelationInput = {
    [orderKey]: params.dir ?? "desc",
  };

  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        contact: true,
        owner: true,
        stage: true,
        service: true,
        tags: { include: { tag: true } },
      },
    }),
  ]);

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getLeadFull(organizationId: string, id: string) {
  return prisma.lead.findFirst({
    where: { id, organizationId },
    include: {
      contact: { include: { channelIdentities: true } },
      owner: true,
      stage: true,
      service: true,
      tags: { include: { tag: true } },
      notes: { include: { author: true }, orderBy: { createdAt: "desc" } },
      tasks: { include: { assignee: true }, orderBy: { dueAt: "asc" } },
      touchpoints: { orderBy: { occurredAt: "desc" } },
      attachments: true,
      activities: { include: { actor: true }, orderBy: { createdAt: "desc" }, take: 100 },
      conversations: {
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          assignee: true,
        },
      },
    },
  });
}

export async function getFilterOptions(organizationId: string) {
  const [stages, services, tags, members] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    prisma.service.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.membership.findMany({
      where: { organizationId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { stages, services, tags, members };
}
