import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor, can } from "@/server/auth/context";
import { getPropertyFull, setPropertyStatus } from "@/server/services/properties";
import { money } from "@/lib/money";
import { fmtDateTime } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ArrowLeft, MapPin, BedDouble, Bath, Ruler, CalendarClock, Phone } from "lucide-react";
import type { PropertyStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const property = await getPropertyFull(actor.organizationId, id);
  if (!property) notFound();
  // After the guard, `property` is safe: bind to a narrowed const for closures.
  const p = property!;

  async function changeStatus(formData: FormData) {
    "use server";
    const status = formData.get("status") as PropertyStatus;
    await setPropertyStatus(actor.organizationId, p.id, status);
  }

  const price = p.totalPrice ?? p.monthlyRent;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/properties">
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-espresso">{p.title}</h1>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              {[p.address, p.locality, p.city].filter(Boolean).join(", ")}
            </p>
          </div>
        </div>
        <form action={changeStatus} className="flex items-center gap-2">
          <select name="status" defaultValue={p.status} className="h-8 rounded-md border border-input bg-surface px-2 text-sm">
            <option value="AVAILABLE">Available</option>
            <option value="RESERVED">Reserved</option>
            <option value="SOLD">Sold</option>
            <option value="RENTED">Rented</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
          <Button type="submit" size="sm">Update</Button>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-semibold">{money(price ?? 0)}{p.monthlyRent ? <span className="text-sm text-muted-foreground">/mo</span> : null}</CardTitle>
            <Badge variant="outline" className="w-fit">{p.purpose}</Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            {p.bedrooms != null && (
              <div className="flex items-center gap-2 text-espresso-700">
                <BedDouble className="size-4 text-gold-700" /> {p.bedrooms} BHK
              </div>
            )}
            {p.bathrooms != null && (
              <div className="flex items-center gap-2 text-espresso-700">
                <Bath className="size-4 text-gold-700" /> {p.bathrooms} bath
              </div>
            )}
            {p.areaSqft != null && (
              <div className="flex items-center gap-2 text-espresso-700">
                <Ruler className="size-4 text-gold-700" /> {p.areaSqft.toLocaleString()} sqft
              </div>
            )}
            {p.areaSqft != null && price != null && (
              <div className="flex items-center gap-2 text-espresso-700">
                ₹{Math.round(Number(price) / p.areaSqft).toLocaleString()}/sqft
              </div>
            )}
            {p.floor != null && (
              <div className="text-muted-foreground">Floor {p.floor}{p.totalFloors ? ` / ${p.totalFloors}` : ""}</div>
            )}
            {p.facing && <div className="text-muted-foreground">Facing: {p.facing}</div>}
            {p.furnished && <div className="text-muted-foreground">Furnished</div>}
            {p.parking && <div className="text-muted-foreground">Parking: {p.parking}</div>}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Highlights</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-espresso-700">{p.highlights ?? p.description ?? "No highlights recorded."}</p>
            {p.owner && (
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Phone className="size-3" /> Listed by {p.owner.name}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Interested leads</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR><TH>Lead</TH><TH>Contact</TH><TH>Owner</TH><TH>Interested since</TH></TR>
            </THead>
            <TBody>
              {p.interests.map((i) => (
                <TR key={i.id}>
                  <TD><Link href={`/leads/${i.lead.id}`} className="text-gold-700 hover:underline">{i.lead.title}</Link></TD>
                  <TD className="text-xs">{i.lead.contact.fullName}</TD>
                  <TD className="text-xs">{i.lead.owner?.name ?? "—"}</TD>
                  <TD className="text-xs">{fmtDateTime(i.createdAt)}</TD>
                </TR>
              ))}
              {p.interests.length === 0 && (
                <TR><TD colSpan={4} className="py-6 text-center text-muted-foreground">No leads interested yet.</TD></TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Site visits</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR><TH>Scheduled</TH><TH>Lead</TH><TH>Agent</TH><TH>Status</TH><TH>Feedback</TH></TR>
            </THead>
            <TBody>
              {p.siteVisits.map((v) => (
                <TR key={v.id}>
                  <TD className="text-xs">
                    <span className="flex items-center gap-1"><CalendarClock className="size-3" />{fmtDateTime(v.scheduledAt)}</span>
                  </TD>
                  <TD className="text-xs">{v.lead.contact.fullName}</TD>
                  <TD className="text-xs">{v.agent?.name ?? "—"}</TD>
                  <TD><Badge variant={v.status === "completed" ? "success" : v.status === "cancelled" ? "muted" : "default"}>{v.status}</Badge></TD>
                  <TD className="text-xs">{v.feedback ?? (v.rating ? `Rated ${v.rating}/5` : "—")}</TD>
                </TR>
              ))}
              {p.siteVisits.length === 0 && (
                <TR><TD colSpan={5} className="py-6 text-center text-muted-foreground">No site visits scheduled.</TD></TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}