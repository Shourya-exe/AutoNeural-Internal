import Link from "next/link";
import { requireActor, can } from "@/server/auth/context";
import { listProperties } from "@/server/services/properties";
import { money } from "@/lib/money";
import { fmtDate } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Plus, Building2, BedDouble, Bath, Ruler } from "lucide-react";
import { PropertiesFilters } from "@/components/properties/properties-filters";
import type { PropertyStatus, PropertyType, ListingPurpose } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;
  const orgId = actor.organizationId;

  const result = await listProperties({
    organizationId: orgId,
    q: sp.q,
    type: sp.type as PropertyType | undefined,
    purpose: sp.purpose as ListingPurpose | undefined,
    status: sp.status as PropertyStatus | undefined,
    city: sp.city,
    sort: sp.sort,
    dir: (sp.dir as "asc" | "desc") ?? "desc",
    page: sp.page ? Number(sp.page) : 1,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-espresso">Properties</h1>
          <p className="text-xs text-muted-foreground">
            {result.total} listing{result.total === 1 ? "" : "s"}
          </p>
        </div>
        <Link href="/properties/new">
          <Button size="sm">
            <Plus className="size-3.5" /> Add property
          </Button>
        </Link>
      </div>

      <PropertiesFilters cities={result.cities} />

      <Table>
        <THead>
          <TR>
            <TH>Property</TH>
            <TH>Type</TH>
            <TH>Purpose</TH>
            <TH>Specs</TH>
            <TH>Price</TH>
            <TH>Status</TH>
            <TH>Owner</TH>
            <TH>Updated</TH>
          </TR>
        </THead>
        <TBody>
          {result.properties.map((p) => (
            <TR key={p.id}>
              <TD>
                <Link href={`/properties/${p.id}`} className="font-medium text-espresso hover:text-gold-700">
                  {p.title}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {p.locality ? `${p.locality}, ` : ""}{p.city}
                </div>
              </TD>
              <TD>
                <Badge variant="outline">{TYPE_LABEL[p.type as PropertyType]}</Badge>
              </TD>
              <TD>{p.purpose}</TD>
              <TD>
                <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {p.bedrooms ? <span className="flex items-center gap-1"><BedDouble className="size-3" />{p.bedrooms} BHK</span> : null}
                  {p.bathrooms ? <span className="flex items-center gap-1"><Bath className="size-3" />{p.bathrooms} bath</span> : null}
                  {p.areaSqft ? <span className="flex items-center gap-1"><Ruler className="size-3" />{p.areaSqft.toLocaleString()} sqft</span> : null}
                </div>
              </TD>
              <TD className="font-medium text-espresso">
                {money(p.totalPrice ?? p.monthlyRent ?? 0)}
                {p.monthlyRent ? <span className="text-xs text-muted-foreground">/mo</span> : null}
              </TD>
              <TD>
                <StatusPill status={p.status} />
              </TD>
              <TD className="text-xs">{p.owner?.name ?? "—"}</TD>
              <TD className="text-xs text-muted-foreground">{fmtDate(p.updatedAt)}</TD>
            </TR>
          ))}
          {result.properties.length === 0 && (
            <TR>
              <TD colSpan={8} className="py-10 text-center text-muted-foreground">
                <Building2 className="mx-auto mb-2 size-6" />
                No properties found. Add your first listing.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  APARTMENT: "Apartment",
  VILLA: "Villa",
  INDEPENDENT_HOUSE: "House",
  PLOT: "Plot",
  COMMERCIAL: "Commercial",
  OFFICE: "Office",
  SHOP: "Shop",
  WAREHOUSE: "Warehouse",
  OTHER: "Other",
};

function StatusPill({ status }: { status: PropertyStatus }) {
  const map: Record<PropertyStatus, string> = {
    AVAILABLE: "success",
    RESERVED: "gold",
    SOLD: "default",
    RENTED: "default",
    WITHDRAWN: "muted",
  };
  return <Badge variant={(map[status] as any) ?? "muted"}>{status}</Badge>;
}