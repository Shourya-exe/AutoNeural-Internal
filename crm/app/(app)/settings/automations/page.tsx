import { requireActor, can } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { relativeTime } from "@/lib/datetime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { AutomationRow, SlaForm } from "@/components/settings/automation-controls";

export const dynamic = "force-dynamic";

const TRIGGER_LABEL: Record<string, string> = {
  LEAD_CREATED: "When a lead is captured",
  LEAD_ASSIGNED: "When a lead is assigned",
  STAGE_CHANGED: "When the stage changes",
  NO_RESPONSE: "When there is no human response within SLA",
  FOLLOW_UP_OVERDUE: "When a follow-up becomes overdue",
  MESSAGE_RECEIVED: "When a message is received",
};

export default async function AutomationsPage() {
  const actor = await requireActor();
  if (!can(actor, "settings.automations")) {
    return (
      <Card>
        <CardContent className="p-6 text-xs text-espresso-500">
          Only Admins can manage automations.
        </CardContent>
      </Card>
    );
  }

  const [rules, runs, org] = await Promise.all([
    prisma.automationRule.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { order: "asc" },
      include: { _count: { select: { runs: true } } },
    }),
    prisma.automationRun.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { rule: true, lead: { include: { contact: true } } },
    }),
    prisma.organization.findUnique({ where: { id: actor.organizationId } }),
  ]);

  const failures = runs.filter((r) => r.status === "FAILED").length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gold/30 bg-gold/10 p-4 text-xs leading-relaxed text-gold-700">
        <p className="font-semibold">Customer-facing automated messages are disabled.</p>
        <p className="mt-1">
          No rule below sends anything to a customer. Enabling outbound automation requires an
          explicitly configured template, recorded consent, a connected channel, and provider
          eligibility. Every rule execution is idempotent (unique rule + dedupe key), so retries
          never produce a duplicate task, assignment, or message.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rules.map((r) => (
            <AutomationRow
              key={r.id}
              id={r.id}
              name={r.name}
              triggerLabel={TRIGGER_LABEL[r.trigger] ?? r.trigger}
              enabled={r.isEnabled}
              sendsCustomerMessage={r.sendsCustomerMessage}
              config={r.config as Record<string, unknown>}
              runCount={r._count.runs}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SLA thresholds</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Used by the background worker's periodic sweep.
          </p>
        </CardHeader>
        <CardContent>
          <SlaForm
            noResponseSlaMins={org?.noResponseSlaMins ?? 120}
            followUpSlaHours={org?.followUpSlaHours ?? 24}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Execution history</CardTitle>
          {failures > 0 && <Badge variant="danger">{failures} failed</Badge>}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Rule</TH>
                <TH>Lead</TH>
                <TH>Result</TH>
                <TH>Detail</TH>
                <TH>When</TH>
              </TR>
            </THead>
            <TBody>
              {runs.map((r) => (
                <TR key={r.id}>
                  <TD className="max-w-[220px] truncate text-xs">{r.rule.name}</TD>
                  <TD className="text-xs text-muted-foreground">
                    {r.lead?.contact.fullName ?? "—"}
                  </TD>
                  <TD>
                    <Badge
                      variant={
                        r.status === "SUCCESS"
                          ? "success"
                          : r.status === "FAILED"
                            ? "danger"
                            : "muted"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TD>
                  <TD className="max-w-[260px] truncate text-[11px] text-muted-foreground">
                    {r.detail ?? "—"}
                  </TD>
                  <TD className="whitespace-nowrap text-[11px] text-muted-foreground">
                    {relativeTime(r.createdAt)}
                  </TD>
                </TR>
              ))}
              {runs.length === 0 && (
                <TR>
                  <TD colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                    No automation runs recorded yet. Create a lead or send a simulated webhook
                    event to see them here.
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
