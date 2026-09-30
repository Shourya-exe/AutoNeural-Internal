import Link from "next/link";
import { requireActor } from "@/server/auth/context";
import { listCallLogs, getCallLogStats } from "@/server/services/call-logs";
import { fmtDateTime } from "@/lib/datetime";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Phone, PhoneCall, PhoneMissed, Clock, FileSpreadsheet } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CallLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;

  const [result, stats] = await Promise.all([
    listCallLogs({
      organizationId: actor.organizationId,
      direction: sp.direction,
      status: sp.status,
      sentiment: sp.sentiment,
      page: sp.page ? Number(sp.page) : 1,
    }),
    getCallLogStats(actor.organizationId),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-espresso">
            <Phone className="size-5 text-gold-700" /> Call Logs
          </h1>
          <p className="text-xs text-muted-foreground">
            {result.total} call{result.total === 1 ? "" : "s"} · {stats.totalMinutes} min total
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileSpreadsheet className="size-4 text-gold-700" />
          {stats.total > 0 ? "Synced to Google Sheets where configured" : "No calls logged yet"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat icon={PhoneCall} label="Inbound" value={stats.inbound} />
        <MiniStat icon={Phone} label="Outbound" value={stats.outbound} />
        <MiniStat icon={PhoneMissed} label="Missed" value={stats.missed} />
        <MiniStat icon={Clock} label="Minutes" value={stats.totalMinutes} />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Time</TH>
            <TH>Direction</TH>
            <TH>From</TH>
            <TH>To</TH>
            <TH>Duration</TH>
            <TH>Status</TH>
            <TH>Sentiment</TH>
            <TH>Lead</TH>
            <TH>Summary</TH>
          </TR>
        </THead>
        <TBody>
          {result.callLogs.map((c) => (
            <TR key={c.id}>
              <TD className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(c.createdAt)}</TD>
              <TD>
                <Badge variant={c.direction === "inbound" ? "default" : "gold"}>{c.direction}</Badge>
              </TD>
              <TD className="text-xs">{c.fromNumber ?? "—"}</TD>
              <TD className="text-xs">{c.toNumber ?? "—"}</TD>
              <TD className="text-xs">{c.duration ? `${c.duration}s` : "—"}</TD>
              <TD>
                <Badge variant={c.status === "completed" ? "success" : c.status === "missed" ? "danger" : "muted"}>
                  {c.status}
                </Badge>
              </TD>
              <TD>
                {c.sentiment ? (
                  <Badge variant={c.sentiment === "positive" ? "success" : c.sentiment === "negative" ? "danger" : "muted"}>
                    {c.sentiment}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TD>
              <TD className="text-xs">
                {c.lead ? (
                  <Link href={`/leads/${c.lead.id}`} className="text-gold-700 hover:underline">
                    {c.lead.contact.fullName}
                  </Link>
                ) : "—"}
              </TD>
              <TD className="max-w-[340px] text-xs text-muted-foreground">
                <p className="truncate" title={c.summary ?? ""}>
                  {c.summary ?? (c.transcript ? "No summary — see transcript" : "—")}
                </p>
                {c.transcript && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-gold-700 hover:underline">
                      Transcript ({c.transcript.split("\n").length} lines)
                    </summary>
                    <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-ivory p-2 font-sans text-[11px] leading-relaxed text-espresso-700">
                      {c.transcript}
                    </pre>
                  </details>
                )}
              </TD>
            </TR>
          ))}
          {result.callLogs.length === 0 && (
            <TR>
              <TD colSpan={9} className="py-10 text-center text-muted-foreground">
                <Phone className="mx-auto mb-2 size-6" />
                No calls logged. The voice agent posts call summaries here automatically.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4 pt-4">
        <Icon className="size-4 text-gold-700" />
        <div>
          <div className="text-base font-semibold text-espresso">{value}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}