import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor } from "@/server/auth/context";
import { markNotificationsRead } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ notifications: [], unread: 0 }, { status: 401 });

  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);
  return NextResponse.json({ notifications, unread });
}

export async function POST() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  await markNotificationsRead(actor.id);
  return NextResponse.json({ ok: true });
}
