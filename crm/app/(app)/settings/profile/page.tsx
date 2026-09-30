import { PasswordForm } from "@/components/settings/password-form";
import { requireActor } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const actor = await requireActor();
  const [org, stats] = await Promise.all([
    prisma.organization.findUnique({ where: { id: actor.organizationId } }),
    Promise.all([
      prisma.lead.count({
        where: { organizationId: actor.organizationId, ownerId: actor.id, status: "OPEN" },
      }),
      prisma.task.count({
        where: { organizationId: actor.organizationId, assigneeId: actor.id, status: "OPEN" },
      }),
      prisma.lead.count({
        where: { organizationId: actor.organizationId, ownerId: actor.id, status: "WON" },
      }),
    ]),
  ]);

  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle>Change password</CardTitle></CardHeader><CardContent><PasswordForm /></CardContent></Card>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={actor.name} className="size-12 text-base" />
            <div>
              <p className="text-sm font-semibold text-espresso">{actor.name}</p>
              <p className="text-xs text-muted-foreground">{actor.email}</p>
              <Badge variant="gold" className="mt-1">
                {actor.role}
              </Badge>
              {actor.isDemo && (
                <Badge variant="muted" className="ml-1.5">
                  Demo session
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Open leads" value={stats[0]} />
            <Stat label="Open tasks" value={stats[1]} />
            <Stat label="Won (all time)" value={stats[2]} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-xs">
          <Row label="Organization" value={org?.name ?? "—"} />
          <Row label="Display timezone" value={org?.displayTimezone ?? env.displayTimezone} />
          <Row label="Currency" value={org?.currency ?? env.currency} />
          <Row label="First-response SLA" value={`${org?.noResponseSlaMins ?? 120} minutes`} />
          <Row label="Follow-up SLA" value={`${org?.followUpSlaHours ?? 24} hours`} />
          <Row label="Storage timezone" value="UTC (always)" />
          <Row label="Server time now" value={fmtDateTime(new Date())} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <p className="text-lg font-semibold tabular-nums text-espresso">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-espresso-700">{value}</span>
    </div>
  );
}
