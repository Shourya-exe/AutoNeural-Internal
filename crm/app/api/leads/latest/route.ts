import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor } from "@/server/auth/context";
import { labelChannel } from "@/server/services/leads";

export const dynamic = "force-dynamic";

/** Leads created after `since` — polled by the leads list to surface new arrivals live. */
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const since = new Date(req.nextUrl.searchParams.get("since") ?? "");
  if (Number.isNaN(since.getTime())) return NextResponse.json({ error: "Invalid since." }, { status: 400 });

  const where = { organizationId: actor.organizationId, archivedAt: null, createdAt: { gt: since } };
  const [count, latest] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, sourceChannel: true, contact: { select: { fullName: true } } },
    }),
  ]);
  return NextResponse.json(
    {
      count,
      latest: latest.map((l) => ({ id: l.id, name: l.contact?.fullName ?? "New lead", source: labelChannel(l.sourceChannel) })),
      now: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
