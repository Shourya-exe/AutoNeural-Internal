import Link from "next/link";
import { requireActor } from "@/server/auth/context";
import { resolvePeriod } from "@/lib/datetime";
import {
  getOverview,
  getSourceVolume,
  getStageDistribution,
  getRecentEnquiries,
  getUpcomingTasks,
  getIntegrationFailures,
} from "@/server/services/metrics";
import { money, moneyCompact } from "@/lib/money";
import { fmtDateTime, relativeTime, isOverdue } from "@/lib/datetime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ChannelBadge, StageBadge } from "@/components/domain/badges";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { SourceVolumeChart, StageDistributionChart } from "@/components/dashboard/charts";
import { CHANNEL_META } from "@/components/domain/badges";
import { AlertTriangle, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const actor = await requireActor();
  const { period } = await searchParams;
  const range = resolvePeriod(period);
  const orgId = actor.organizationId;

  const [overview, sources, stages, recent, tasks, failures] = await Promise.all([
    getOverview(orgId, range),
    getSourceVolume(orgId, range),
    getStageDistribution(orgId),
    getRecentEnquiries(orgId),
    getUpcomingTasks(orgId),
    getIntegrationFailures(orgId),
  ]);

  const sourceData = sources.map((s) => ({
    source: s.source,
    label: CHANNEL_META[s.source]?.label ?? s.source,
    count: s.count,
  }));

  // Prisma Decimal is not serialisable across the server/client boundary.
  const openStages = stages
    .filter((s) => !s.isWon && !s.isLost)
    .map((s) => ({ name: s.name, count: s.count, isWon: s.isWon, isLost: s.isLost }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-espresso">Overview</h1>
          <p className="text-xs text-muted-foreground">
            {range.label} · metrics computed from stored data
          </p>
        </div>
        <PeriodFilter current={range.key} />
      </div>

      {/* Primary metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label={`New leads · ${range.label}`} value={overview.newLeads} href="/leads" />
        <StatTile
          label="Unassigned"
          value={overview.unassignedLeads}
          tone={overview.unassignedLeads > 0 ? "gold" : "default"}
          href="/leads?ownerId=unassigned"
        />
        <StatTile
          label="Awaiting 1st response"
          value={overview.awaitingFirstResponse}
          tone={overview.awaitingFirstResponse > 0 ? "danger" : "success"}
          href="/leads?status=OPEN"
        />
        <StatTile
          label="Overdue follow-ups"
          value={overview.overdueFollowUps}
          tone={overview.overdueFollowUps > 0 ? "danger" : "success"}
          href="/leads?overdueOnly=1"
        />
        <StatTile
          label="Open pipeline"
          value={moneyCompact(overview.openPipelineValue)}
          sub="All open leads"
        />
        <StatTile
          label={`Won · ${range.label}`}
          value={moneyCompact(overview.wonValue)}
          sub={`${overview.wonCount} deals`}
          tone="success"
        />
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Conversion (won / closed)"
          value={`${overview.conversionRate}%`}
          sub={`${overview.wonCount} won · ${overview.lostCount} lost in period`}
        />
        <StatTile
          label="First response — median"
          value={fmtMins(overview.firstResponseMedianMins)}
          sub="First eligible inbound → first human reply"
        />
        <StatTile
          label="First response — average"
          value={fmtMins(overview.firstResponseAvgMins)}
          sub="Automated acks excluded"
        />
        <StatTile
          label="Integration issues"
          value={failures.connections.length + failures.deadLetters}
          tone={failures.connections.length + failures.deadLetters > 0 ? "danger" : "success"}
          href="/settings/integrations"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lead volume by source</CardTitle>
          </CardHeader>
          <CardContent>
            <SourceVolumeChart data={sourceData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leads by pipeline stage</CardTitle>
          </CardHeader>
          <CardContent>
            <StageDistributionChart data={openStages} />
          </CardContent>
        </Card>
      </div>

      {failures.connections.length > 0 && (
        <Card className="border-danger-100 bg-danger-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-danger-600">
              <AlertTriangle className="size-4" /> Integration failures requiring attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {failures.connections.map((c) => (
              <Link
                key={c.id}
                href="/settings/integrations"
                className="flex items-center justify-between rounded-md border border-danger-100 bg-surface px-3 py-2 text-xs"
              >
                <span className="font-medium text-espresso-700">{c.label}</span>
                <span className="text-danger-600">{c.lastErrorText ?? c.status}</span>
              </Link>
            ))}
            {failures.deadLetters > 0 && (
              <p className="text-xs text-danger-600">
                {failures.deadLetters} webhook event(s) in the failed / dead-letter queue —{" "}
                <Link href="/settings/integrations" className="underline">
                  review &amp; replay
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent enquiries</CardTitle>
            <Link href="/leads" className="text-xs text-gold-700 hover:underline">
              All leads <ArrowRight className="inline size-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {recent.map((l) => (
              <Link
                key={l.id}
                href={`/leads/${l.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-champagne-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-espresso-700">
                    {l.contact.fullName}
                    <span className="text-muted-foreground"> · {l.contact.company ?? "—"}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {relativeTime(l.createdAt)} · {l.owner?.name ?? "Unassigned"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <ChannelBadge channel={l.sourceChannel} />
                  <StageBadge name={l.stage.name} isWon={l.stage.isWon} isLost={l.stage.isLost} />
                </div>
              </Link>
            ))}
            {recent.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">No enquiries yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Upcoming tasks</CardTitle>
            <Link href="/tasks" className="text-xs text-gold-700 hover:underline">
              All tasks <ArrowRight className="inline size-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-champagne-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-espresso-700">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t.lead ? t.lead.contact.fullName : "No lead"} · {t.assignee?.name ?? "Unassigned"}
                  </p>
                </div>
                <Badge variant={isOverdue(t.dueAt) ? "danger" : "muted"}>
                  {isOverdue(t.dueAt) ? "Overdue " : ""}
                  {fmtDateTime(t.dueAt)}
                </Badge>
              </div>
            ))}
            {tasks.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">No upcoming tasks.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function fmtMins(m: number): string {
  if (!m) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return `${h}h ${rem}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
