import { requireActor } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { moneyCompact, money } from "@/lib/money";
import { fmtDate, isOverdue } from "@/lib/datetime";
import { PipelineBoard, type BoardCard } from "@/components/pipeline/board";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const actor = await requireActor();
  const orgId = actor.organizationId;

  const [stages, leads] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { organizationId: orgId }, orderBy: { order: "asc" } }),
    prisma.lead.findMany({
      where: { organizationId: orgId, archivedAt: null },
      include: { contact: true, owner: true, service: true },
      orderBy: { lastActivityAt: "desc" },
      take: 400,
    }),
  ]);

  const cards: BoardCard[] = leads.map((l) => ({
    id: l.id,
    contactName: l.contact.fullName,
    company: l.contact.company,
    service: l.service?.name ?? l.interestedService ?? null,
    owner: l.owner?.name ?? null,
    value: l.estimatedValue ? moneyCompact(l.estimatedValue) : "—",
    nextFollowUp: l.nextFollowUpAt ? fmtDate(l.nextFollowUpAt) : null,
    overdue: isOverdue(l.nextFollowUpAt),
    stageId: l.stageId,
  }));

  const openValue = leads
    .filter((l) => l.status === "OPEN")
    .reduce((sum, l) => sum + Number(l.estimatedValue ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-espresso">Pipeline</h1>
          <p className="text-xs text-muted-foreground">
            Drag a card to change its stage — the move is persisted and recorded on the
            timeline. Moving to Lost asks for a reason.
          </p>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-1.5 text-xs shadow-sm">
          <span className="text-muted-foreground">Open pipeline </span>
          <span className="font-semibold tabular-nums text-espresso">{money(openValue)}</span>
        </div>
      </div>

      <PipelineBoard
        stages={stages.map((s) => ({
          id: s.id,
          name: s.name,
          isWon: s.isWon,
          isLost: s.isLost,
        }))}
        cards={cards}
      />
    </div>
  );
}
