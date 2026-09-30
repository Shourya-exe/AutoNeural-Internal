import Link from "next/link";
import { requireActor, can, ForbiddenError } from "@/server/auth/context";
import { getReportBundle } from "@/server/services/metrics";
import { resolvePeriod, fmtDateTime, isOverdue } from "@/lib/datetime";
import { money, moneyCompact } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { ConversionFunnel, WorkloadChart, ChannelChart } from "@/components/reports/report-charts";
import { CHANNEL_META } from "@/components/domain/badges";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const actor = await requireActor();
  if (!can(actor, "reports.view")) {
    return (
      <div className="rounded-lg border border-danger-100 bg-danger-50 p-6">
        <h1 className="text-sm font-semibold text-danger-600">Reports are restricted</h1>
        <p className="mt-1 text-xs text-espresso-500">
          Your role ({actor.role}) cannot view team reports. Ask an Admin or Manager.
        </p>
      </div>
    );
  }

  const { period } = await searchParams;
  const range = resolvePeriod(period);
  const r = await getReportBundle(actor.organizationId, range);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-espresso">Reports</h1>
          <p className="text-xs text-muted-foreground">{range.label}</p>
        </div>
        <PeriodFilter current={range.key} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Won" value={r.closed.wonCount} sub={moneyCompact(r.closed.wonValue)} tone="success" />
        <StatTile label="Lost" value={r.closed.lostCount} sub={moneyCompact(r.closed.lostValue)} tone="danger" />
        <StatTile
          label="First response — median"
          value={fmtMins(r.firstResponse.median)}
          sub={`p90 ${fmtMins(r.firstResponse.p90)} · n=${r.firstResponse.count}`}
        />
        <StatTile
          label="Overdue follow-ups"
          value={r.overdue.length}
          tone={r.overdue.length ? "danger" : "success"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How first-response time is calculated</CardTitle>
        </CardHeader>
        <CardContent className="text-xs leading-relaxed text-espresso-500">
          Measured per lead as{" "}
          <code className="rounded bg-champagne-50 px-1">firstResponseAt − firstInboundAt</code>.{" "}
          <strong>firstInboundAt</strong> is the first eligible inbound message on any channel;{" "}
          <strong>firstResponseAt</strong> is set only when a human sales user sends an outbound
          reply that the provider accepted. Messages flagged{" "}
          <code className="rounded bg-champagne-50 px-1">isAutomated</code> (automated
          acknowledgements) never set it. Leads with no inbound message are excluded.
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline conversion</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Leads created in this period that ever reached each stage (from the activity trail).
            </p>
          </CardHeader>
          <CardContent>
            <ConversionFunnel
              data={r.conversion.map((c) => ({
                name: c.name,
                reached: c.reached,
                rateFromStart: c.rateFromStart,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Leads by channel</CardTitle>
          </CardHeader>
          <CardContent>
            <ChannelChart
              data={aggregateChannels(r.byChannel).map((c) => ({
                label: CHANNEL_META[c.channel as keyof typeof CHANNEL_META]?.label ?? c.channel,
                total: c.total,
                won: c.won,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leads by channel &amp; campaign</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Channel</TH>
                <TH>Campaign</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">Won</TH>
                <TH className="text-right">Win rate</TH>
              </TR>
            </THead>
            <TBody>
              {r.byChannel.map((row, i) => (
                <TR key={i}>
                  <TD className="text-xs">
                    {CHANNEL_META[row.channel as keyof typeof CHANNEL_META]?.label ?? row.channel}
                  </TD>
                  <TD className="text-xs text-muted-foreground">{row.campaign}</TD>
                  <TD className="text-right text-xs tabular-nums">{row.total}</TD>
                  <TD className="text-right text-xs tabular-nums">{row.won}</TD>
                  <TD className="text-right text-xs tabular-nums">
                    {row.total ? Math.round((row.won / row.total) * 100) : 0}%
                  </TD>
                </TR>
              ))}
              {r.byChannel.length === 0 && (
                <TR>
                  <TD colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                    No leads created in this period.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Salesperson workload</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkloadChart
              data={r.workload.map((w) => ({
                name: w.name.split(" ")[0],
                openLeads: w.openLeads,
                overdueTasks: w.overdueTasks,
              }))}
            />
            <div className="mt-3 space-y-1">
              {r.workload.map((w) => (
                <div
                  key={w.userId}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-champagne-50"
                >
                  <span className="text-espresso-700">
                    {w.name}{" "}
                    <span className="text-[10px] text-muted-foreground">
                      {w.role === "MANAGER" ? "Manager" : "Sales Rep"}
                    </span>
                  </span>
                  <span className="flex gap-2 text-[11px]">
                    <span className="text-muted-foreground">{w.openLeads} open</span>
                    <span className="text-muted-foreground">{w.openTasks} tasks</span>
                    {w.overdueTasks > 0 && (
                      <span className="text-danger-600">{w.overdueTasks} overdue</span>
                    )}
                    <span className="text-emerald-600">{w.wonThisMonth} won MTD</span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Why we lose</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {r.closed.lostReasons.length === 0 && (
              <p className="text-xs text-muted-foreground">No losses recorded in this period.</p>
            )}
            {r.closed.lostReasons.map((lr) => (
              <div key={lr.reason} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-xs text-espresso-700">{lr.reason}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-champagne-50">
                  <div
                    className="h-full rounded-full bg-danger"
                    style={{
                      width: `${(lr.count / Math.max(1, r.closed.lostCount)) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
                  {lr.count}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overdue follow-ups ({r.overdue.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Lead</TH>
                <TH>Owner</TH>
                <TH>Value</TH>
                <TH>Due</TH>
              </TR>
            </THead>
            <TBody>
              {r.overdue.slice(0, 25).map((l) => (
                <TR key={l.id}>
                  <TD className="text-xs">
                    <Link href={`/leads/${l.id}`} className="hover:text-gold-700 hover:underline">
                      {l.contact.fullName}
                    </Link>
                    <span className="block text-[10px] text-muted-foreground">
                      {l.contact.company ?? "—"}
                    </span>
                  </TD>
                  <TD className="text-xs">{l.owner?.name ?? "Unassigned"}</TD>
                  <TD className="text-xs tabular-nums">
                    {l.estimatedValue ? money(l.estimatedValue) : "—"}
                  </TD>
                  <TD>
                    <Badge variant={isOverdue(l.nextFollowUpAt) ? "danger" : "muted"}>
                      {fmtDateTime(l.nextFollowUpAt)}
                    </Badge>
                  </TD>
                </TR>
              ))}
              {r.overdue.length === 0 && (
                <TR>
                  <TD colSpan={4} className="py-8 text-center text-xs text-emerald-600">
                    No overdue follow-ups. Nice.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function aggregateChannels(rows: { channel: string; total: number; won: number }[]) {
  const map = new Map<string, { channel: string; total: number; won: number }>();
  for (const r of rows) {
    const e = map.get(r.channel) ?? { channel: r.channel, total: 0, won: 0 };
    e.total += r.total;
    e.won += r.won;
    map.set(r.channel, e);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function fmtMins(m: number): string {
  if (!m) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
