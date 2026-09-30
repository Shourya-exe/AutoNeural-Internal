import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@prisma/client";

export async function notify(params: {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
}) {
  if (!params.userId) return;
  await prisma.notification.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      linkUrl: params.linkUrl,
    },
  });
}

export async function notifyManagers(params: {
  organizationId: string;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
}) {
  const managers = await prisma.membership.findMany({
    where: { organizationId: params.organizationId, role: { in: ["MANAGER", "ADMIN"] } },
    select: { userId: true },
  });
  await Promise.all(
    managers.map((m) =>
      notify({ ...params, userId: m.userId }),
    ),
  );
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}
