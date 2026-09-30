import { prisma } from "@/lib/prisma";
import { redact } from "@/lib/crypto";
import type { ActivityType } from "@prisma/client";

export async function writeAudit(params: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before ? (redact(params.before) as any) : undefined,
      after: params.after ? (redact(params.after) as any) : undefined,
      ip: params.ip ?? null,
    },
  });
}

export async function writeActivity(params: {
  organizationId: string;
  leadId?: string | null;
  actorUserId?: string | null;
  type: ActivityType;
  summary: string;
  meta?: Record<string, unknown>;
}) {
  await prisma.activity.create({
    data: {
      organizationId: params.organizationId,
      leadId: params.leadId ?? null,
      actorUserId: params.actorUserId ?? null,
      type: params.type,
      summary: params.summary,
      meta: (params.meta as any) ?? undefined,
    },
  });
  if (params.leadId) {
    await prisma.lead.update({
      where: { id: params.leadId },
      data: { lastActivityAt: new Date() },
    });
  }
}
