import { requireActor, can } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/datetime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await requireActor();
  if (!can(actor, "settings.audit")) {
    return (
      <Card>
        <CardContent className="p-6 text-xs text-espresso-500">
          Managers and Admins can view the audit log.
        </CardContent>
      </Card>
    );
  }
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const pageSize = 50;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: true },
    }),
    prisma.auditLog.count({ where: { organizationId: actor.organizationId } }),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log ({total})</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Every privileged mutation is recorded. Secrets are redacted before the entry is written
          — tokens never reach this table.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Entity</TH>
              <TH>Change</TH>
            </TR>
          </THead>
          <TBody>
            {logs.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap text-[11px] text-muted-foreground">
                  {fmtDateTime(l.createdAt)}
                </TD>
                <TD className="text-xs">{l.actor?.name ?? "system"}</TD>
                <TD className="font-mono text-[11px] text-espresso-700">{l.action}</TD>
                <TD className="font-mono text-[10px] text-muted-foreground">
                  {l.entityType}:{l.entityId.slice(0, 10)}…
                </TD>
                <TD className="max-w-[320px] truncate font-mono text-[10px] text-muted-foreground">
                  {l.after ? JSON.stringify(l.after) : "—"}
                </TD>
              </TR>
            ))}
            {logs.length === 0 && (
              <TR>
                <TD colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                  No audited actions yet.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
