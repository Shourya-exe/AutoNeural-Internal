import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getActor, can } from "@/server/auth/context";
import { listLeads, type LeadListParams } from "@/server/services/lead-queries";
import { writeAudit } from "@/server/services/audit";
import { fmtDateTime } from "@/lib/datetime";
import type { Channel } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE = 100;
const MAX_ROWS = 10_000;

export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(actor, "lead.export")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const filters: LeadListParams = {
    organizationId: actor.organizationId,
    q: sp.get("q") ?? undefined,
    source: (sp.get("source") as Channel) ?? undefined,
    stageKey: sp.get("stageKey") ?? undefined,
    ownerId: sp.get("ownerId") ?? undefined,
    serviceId: sp.get("serviceId") ?? undefined,
    priority: (sp.get("priority") as any) ?? undefined,
    tag: sp.get("tag") ?? undefined,
    overdueOnly: sp.get("overdueOnly") === "1",
    archived: sp.get("archived") === "1",
    status: "ALL",
    pageSize: PAGE,
  };

  const rows: Record<string, string | number>[] = [];
  let page = 1;
  let pageCount = 1;

  do {
    const chunk = await listLeads({ ...filters, page });
    pageCount = chunk.pageCount;
    for (const l of chunk.rows) {
      rows.push({
        name: l.contact.fullName,
        company: l.contact.company ?? "",
        phone: l.contact.primaryPhone ?? "",
        email: l.contact.primaryEmail ?? "",
        source_channel: l.sourceChannel,
        campaign: l.campaignName ?? "",
        interested_service: l.service?.name ?? l.interestedService ?? "",
        stage: l.stage.name,
        status: l.status,
        priority: l.priority,
        owner: l.owner?.name ?? "",
        estimated_value_inr: l.estimatedValue ? Number(l.estimatedValue) : "",
        tags: l.tags.map((t) => t.tag.name).join("|"),
        created_at_ist: fmtDateTime(l.createdAt),
        last_activity_ist: fmtDateTime(l.lastActivityAt),
        next_follow_up_ist: l.nextFollowUpAt ? fmtDateTime(l.nextFollowUpAt) : "",
        lost_reason: l.lostReason ?? "",
      });
    }
    page++;
  } while (page <= pageCount && rows.length < MAX_ROWS);

  const csv = Papa.unparse(rows);

  await writeAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    action: "lead.export",
    entityType: "Lead",
    entityId: "bulk",
    after: { count: rows.length },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="autoneural-leads-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
