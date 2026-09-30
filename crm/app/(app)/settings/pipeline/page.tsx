import { requireActor, can } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StageRow } from "@/components/settings/stage-row";

export const dynamic = "force-dynamic";

export default async function PipelineSettingsPage() {
  const actor = await requireActor();
  if (!can(actor, "settings.pipeline")) {
    return (
      <Card>
        <CardContent className="p-6 text-xs text-espresso-500">
          Only Admins can edit pipeline stages.
        </CardContent>
      </Card>
    );
  }

  const stages = await prisma.pipelineStage.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { order: "asc" },
    include: { _count: { select: { leads: true } } },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline stages</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Stage <code className="rounded bg-champagne-50 px-1">key</code> values are stable and
          used by automations and reports — only the display name is editable. The Won and Lost
          stages drive deal status; moving a lead to Lost always requires a reason.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {stages.map((s) => (
          <StageRow
            key={s.id}
            id={s.id}
            name={s.name}
            stageKey={s.key}
            order={s.order}
            isWon={s.isWon}
            isLost={s.isLost}
            leadCount={s._count.leads}
          />
        ))}
      </CardContent>
    </Card>
  );
}
