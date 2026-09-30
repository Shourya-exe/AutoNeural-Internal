import { requireActor, can } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CatalogForms } from "@/components/settings/catalog-forms";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const actor = await requireActor();
  if (!can(actor, "settings.services")) {
    return (
      <Card>
        <CardContent className="p-6 text-xs text-espresso-500">
          Managers and Admins can edit services and tags.
        </CardContent>
      </Card>
    );
  }

  const [services, tags] = await Promise.all([
    prisma.service.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { name: "asc" },
      include: { _count: { select: { leads: true } } },
    }),
    prisma.tag.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { name: "asc" },
      include: { _count: { select: { leads: true } } },
    }),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            What AutoNeural sells. Used on leads, filters and reports.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <Badge key={s.id} variant="default">
                {s.name}
                <span className="ml-1 opacity-60">{s._count.leads}</span>
              </Badge>
            ))}
          </div>
          <CatalogForms kind="service" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lead tags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CatalogForms
            kind="tag"
            tags={tags.map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              count: t._count.leads,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
