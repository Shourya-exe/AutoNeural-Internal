import Link from "next/link";
import { requireActor, can } from "@/server/auth/context";
import { listLeads, getFilterOptions } from "@/server/services/lead-queries";
import { money } from "@/lib/money";
import { fmtDate, fmtDateTime, isOverdue } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { LeadsFilters } from "@/components/leads/leads-filters";
import { LeadsTable, type LeadRow } from "@/components/leads/leads-table";
import { LiveLeads } from "@/components/leads/live-leads";
import { Plus, Upload, Download, Copy, Zap } from "lucide-react";
import type { Channel } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;
  const orgId = actor.organizationId;

  const options = await getFilterOptions(orgId);
  const result = await listLeads({
    organizationId: orgId,
    q: sp.q,
    source: sp.source as Channel | undefined,
    stageKey: sp.stageKey,
    ownerId: sp.ownerId,
    serviceId: sp.serviceId,
    priority: sp.priority as any,
    tag: sp.tag,
    status: (sp.status as any) ?? "ALL",
    overdueOnly: sp.overdueOnly === "1",
    archived: sp.archived === "1",
    sort: sp.sort,
    dir: (sp.dir as "asc" | "desc") ?? "desc",
    page: sp.page ? Number(sp.page) : 1,
  });

  const rows: LeadRow[] = result.rows.map((l) => ({
    id: l.id,
    title: l.title,
    contactName: l.contact.fullName,
    company: l.contact.company,
    phone: l.contact.primaryPhone,
    email: l.contact.primaryEmail,
    source: l.sourceChannel,
    campaign: l.campaignName,
    service: l.service?.name ?? l.interestedService ?? null,
    stageName: l.stage.name,
    isWon: l.stage.isWon,
    isLost: l.stage.isLost,
    priority: l.priority,
    ownerName: l.owner?.name ?? null,
    estimatedValue: l.estimatedValue ? money(l.estimatedValue) : "—",
    createdAt: fmtDate(l.createdAt),
    lastActivityAt: fmtDateTime(l.lastActivityAt),
    nextFollowUpAt: l.nextFollowUpAt ? fmtDateTime(l.nextFollowUpAt) : null,
    overdue: isOverdue(l.nextFollowUpAt),
    tags: l.tags.map((t) => ({ name: t.tag.name, color: t.tag.color })),
  }));

  const renderedAt = new Date().toISOString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-espresso">Leads</h1>
          <p className="text-xs text-muted-foreground">
            {result.total} lead{result.total === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          {can(actor, "settings.integrations") && (
            <Link href="/settings/integrations">
              <Button variant="outline" size="sm">
                <Zap className="size-3.5" /> Auto-load leads
              </Button>
            </Link>
          )}
          <Link href="/leads/duplicates">
            <Button variant="outline" size="sm">
              <Copy className="size-3.5" /> Duplicates
            </Button>
          </Link>
          {can(actor, "lead.import") && (
            <Link href="/leads/import">
              <Button variant="outline" size="sm">
                <Upload className="size-3.5" /> Import CSV
              </Button>
            </Link>
          )}
          {can(actor, "lead.export") && (
            <a href={`/api/leads/export?${new URLSearchParams(sp as any).toString()}`}>
              <Button variant="outline" size="sm">
                <Download className="size-3.5" /> Export
              </Button>
            </a>
          )}
          <Link href="/leads/new">
            <Button size="sm">
              <Plus className="size-3.5" /> New lead
            </Button>
          </Link>
        </div>
      </div>

      <LiveLeads since={renderedAt} />

      <LeadsFilters options={options} />

      <LeadsTable
        rows={rows}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        canBulk={can(actor, "lead.bulk")}
        members={options.members.map((m) => ({ userId: m.userId, name: m.user.name }))}
        stages={options.stages.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
