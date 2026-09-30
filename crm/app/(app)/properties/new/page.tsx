import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/context";
import { createProperty } from "@/server/services/properties";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { z } from "zod";

export const dynamic = "force-dynamic";

const propertySchema = z.object({
  title: z.string().min(1, "Title is required"),
  type: z.string().min(1, "Type is required"),
  purpose: z.string().min(1, "Purpose is required"),
  status: z.string().optional(),
  bhk: z.string().optional(),
  bedrooms: z.coerce.number().int().min(0).optional(),
  bathrooms: z.coerce.number().int().min(0).optional(),
  areaSqft: z.coerce.number().int().min(0).optional(),
  totalPrice: z.coerce.number().min(0).optional(),
  monthlyRent: z.coerce.number().min(0).optional(),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  locality: z.string().optional(),
  floor: z.coerce.number().int().min(0).optional(),
  totalFloors: z.coerce.number().int().min(0).optional(),
  furnished: z.coerce.boolean().optional(),
  facing: z.string().optional(),
  parking: z.string().optional(),
  description: z.string().optional(),
  highlights: z.string().optional(),
});

export default async function NewPropertyPage() {
  const actor = await requireActor();

  async function submit(formData: FormData) {
    "use server";
    const raw = Object.fromEntries(formData.entries());
    const parsed = propertySchema.safeParse(raw);
    if (!parsed.success) return;

    const d = parsed.data;
    await createProperty({
      organizationId: actor.organizationId,
      title: d.title,
      type: d.type as any,
      purpose: d.purpose as any,
      status: (d.status as any) || "AVAILABLE",
      bhk: (d.bhk as any) || null,
      bedrooms: d.bedrooms ?? null,
      bathrooms: d.bathrooms ?? null,
      areaSqft: d.areaSqft ?? null,
      totalPrice: d.totalPrice ?? null,
      monthlyRent: d.monthlyRent ?? null,
      address: d.address,
      city: d.city,
      locality: d.locality ?? null,
      floor: d.floor ?? null,
      totalFloors: d.totalFloors ?? null,
      furnished: d.furnished ?? false,
      facing: d.facing ?? null,
      parking: d.parking ?? null,
      description: d.description ?? null,
      highlights: d.highlights ?? null,
    });
    redirect("/properties");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-espresso">Add property</h1>
        <p className="text-xs text-muted-foreground">Create a new listing in the catalog.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listing details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">Title *</label>
                <Input name="title" required placeholder="3 BHK Luxury Apartment, Salt Lake" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Type *</label>
                <select name="type" required className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm">
                  <option value="APARTMENT">Apartment</option>
                  <option value="VILLA">Villa</option>
                  <option value="INDEPENDENT_HOUSE">Independent House</option>
                  <option value="PLOT">Plot</option>
                  <option value="COMMERCIAL">Commercial</option>
                  <option value="OFFICE">Office</option>
                  <option value="SHOP">Shop</option>
                  <option value="WAREHOUSE">Warehouse</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Purpose *</label>
                <select name="purpose" required className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm">
                  <option value="SALE">Sale</option>
                  <option value="RENT">Rent</option>
                  <option value="LEASE">Lease</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Status</label>
                <select name="status" className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm">
                  <option value="AVAILABLE">Available</option>
                  <option value="RESERVED">Reserved</option>
                  <option value="SOLD">Sold</option>
                  <option value="RENTED">Rented</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">BHK</label>
                <select name="bhk" className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm">
                  <option value="">—</option>
                  <option value="STUDIO">Studio</option>
                  <option value="ONE">1 BHK</option>
                  <option value="TWO">2 BHK</option>
                  <option value="THREE">3 BHK</option>
                  <option value="FOUR">4 BHK</option>
                  <option value="FIVE_PLUS">5+ BHK</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Bedrooms</label>
                <Input name="bedrooms" type="number" min="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Bathrooms</label>
                <Input name="bathrooms" type="number" min="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Area (sqft)</label>
                <Input name="areaSqft" type="number" min="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Sale price (INR)</label>
                <Input name="totalPrice" type="number" min="0" placeholder="e.g. 9500000" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Monthly rent (INR)</label>
                <Input name="monthlyRent" type="number" min="0" placeholder="e.g. 45000" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Floor</label>
                <Input name="floor" type="number" min="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Total floors</label>
                <Input name="totalFloors" type="number" min="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Facing</label>
                <select name="facing" className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm">
                  <option value="">—</option>
                  <option>North</option>
                  <option>South</option>
                  <option>East</option>
                  <option>West</option>
                  <option>North-East</option>
                  <option>North-West</option>
                  <option>South-East</option>
                  <option>South-West</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Parking</label>
                <select name="parking" className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm">
                  <option value="">—</option>
                  <option>Covered</option>
                  <option>Open</option>
                  <option>None</option>
                </select>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">Address *</label>
              <Input name="address" required placeholder="Sector V, Salt Lake, Kolkata" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">City *</label>
                <Input name="city" required placeholder="Kolkata" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Locality</label>
                <Input name="locality" placeholder="Sector V" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Highlights</label>
              <textarea name="highlights" rows={2} className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm" placeholder="Gated community, 24x7 security, clubhouse…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Description</label>
              <textarea name="description" rows={3} className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm" />
            </div>
            <Button type="submit" className="w-full">Create property</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}