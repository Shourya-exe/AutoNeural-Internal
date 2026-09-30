import { requireActor, can, CAPABILITIES } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TeamRow } from "@/components/settings/team-row";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const actor = await requireActor();
  if (!can(actor, "settings.team")) {
    return (
      <Card>
        <CardContent className="p-6 text-xs text-espresso-500">
          Only Admins can manage team members and roles.
        </CardContent>
      </Card>
    );
  }

  const members = await prisma.membership.findMany({
    where: { organizationId: actor.organizationId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Role changes take effect immediately and are written to the audit log.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {members.map((m) => (
                <TeamRow
                  key={m.id}
                  userId={m.userId}
                  name={m.user.name}
                  email={m.user.email}
                  role={m.role}
                  isActive={m.user.isActive}
                  isSelf={m.userId === actor.id}
                />
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each role can do</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            This table is generated from the server-side capability map
            (server/auth/context.ts) — it is the same source the API enforces.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Capability</TH>
                <TH className="text-center">Sales Rep</TH>
                <TH className="text-center">Manager</TH>
                <TH className="text-center">Admin</TH>
              </TR>
            </THead>
            <TBody>
              {Object.entries(CAPABILITIES).map(([cap, roles]) => (
                <TR key={cap}>
                  <TD className="font-mono text-[11px]">{cap}</TD>
                  {(["SALES_REP", "MANAGER", "ADMIN"] as const).map((r) => (
                    <TD key={r} className="text-center">
                      {(roles as readonly string[]).includes(r) ? (
                        <Badge variant="success">yes</Badge>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
