import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { PropertyStatus, PropertyType, ListingPurpose, PropertyBHK } from "@prisma/client";

export interface ListPropertiesArgs {
  organizationId: string;
  q?: string;
  type?: PropertyType;
  purpose?: ListingPurpose;
  status?: PropertyStatus;
  city?: string;
  ownerId?: string;
  minBudget?: number;
  maxBudget?: number;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export async function listProperties(args: ListPropertiesArgs) {
  const {
    organizationId,
    q,
    type,
    purpose,
    status,
    city,
    ownerId,
    minBudget,
    maxBudget,
    sort = "updatedAt",
    dir = "desc",
    page = 1,
    pageSize = 20,
  } = args;

  const where: Prisma.PropertyWhereInput = { organizationId, archivedAt: null };

  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { address: { contains: q, mode: "insensitive" } },
      { locality: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
    ];
  }
  if (type) where.type = type;
  if (purpose) where.purpose = purpose;
  if (status) where.status = status;
  if (city) where.city = { contains: city, mode: "insensitive" };
  if (ownerId) where.ownerId = ownerId;
  if (minBudget !== undefined || maxBudget !== undefined) {
    where.OR = [
      ...((where.OR as any[]) ?? []),
      {
        AND: [
          minBudget !== undefined ? { totalPrice: { gte: minBudget } } : {},
          maxBudget !== undefined ? { totalPrice: { lte: maxBudget } } : {},
        ],
      },
      {
        AND: [
          minBudget !== undefined ? { monthlyRent: { gte: minBudget } } : {},
          maxBudget !== undefined ? { monthlyRent: { lte: maxBudget } } : {},
        ],
      },
    ];
  }

  const orderBy: Prisma.PropertyOrderByWithRelationInput[] = [
    { [sort as string]: dir },
  ];

  const [total, properties, cities] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { owner: { select: { id: true, name: true } } },
    }),
    prisma.property.findMany({
      where: { organizationId, archivedAt: null },
      distinct: ["city"],
      select: { city: true },
    }),
  ]);

  return {
    properties,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    cities: cities.map((c) => c.city).filter(Boolean),
  };
}

export async function getPropertyFull(organizationId: string, id: string) {
  return prisma.property.findFirst({
    where: { id, organizationId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      interests: {
        include: { lead: { include: { contact: true, owner: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: "desc" },
      },
      siteVisits: {
        include: { lead: { include: { contact: true } }, agent: { select: { id: true, name: true } } },
        orderBy: { scheduledAt: "desc" },
      },
    },
  });
}

export interface CreatePropertyArgs {
  organizationId: string;
  title: string;
  type: PropertyType;
  purpose: ListingPurpose;
  status?: PropertyStatus;
  bhk?: PropertyBHK | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  balconies?: number | null;
  areaSqft?: number | null;
  pricePerSqft?: number | null;
  totalPrice?: number | null;
  monthlyRent?: number | null;
  securityDeposit?: number | null;
  address: string;
  city: string;
  locality?: string | null;
  pincode?: string | null;
  landmark?: string | null;
  floor?: number | null;
  totalFloors?: number | null;
  age?: string | null;
  furnished?: boolean;
  facing?: string | null;
  parking?: string | null;
  description?: string | null;
  highlights?: string | null;
  amenities?: unknown;
  images?: unknown;
  videoUrl?: string | null;
  ownerId?: string | null;
}

export async function createProperty(args: CreatePropertyArgs) {
  return prisma.property.create({
    data: {
      organizationId: args.organizationId,
      title: args.title,
      type: args.type,
      purpose: args.purpose,
      status: args.status ?? "AVAILABLE",
      bhk: args.bhk ?? null,
      bedrooms: args.bedrooms ?? null,
      bathrooms: args.bathrooms ?? null,
      balconies: args.balconies ?? null,
      areaSqft: args.areaSqft ?? null,
      pricePerSqft: args.pricePerSqft ? new Prisma.Decimal(args.pricePerSqft) : null,
      totalPrice: args.totalPrice ? new Prisma.Decimal(args.totalPrice) : null,
      monthlyRent: args.monthlyRent ? new Prisma.Decimal(args.monthlyRent) : null,
      securityDeposit: args.securityDeposit ? new Prisma.Decimal(args.securityDeposit) : null,
      address: args.address,
      city: args.city,
      locality: args.locality ?? null,
      pincode: args.pincode ?? null,
      landmark: args.landmark ?? null,
      floor: args.floor ?? null,
      totalFloors: args.totalFloors ?? null,
      age: args.age ?? null,
      furnished: args.furnished ?? false,
      facing: args.facing ?? null,
      parking: args.parking ?? null,
      description: args.description ?? null,
      highlights: args.highlights ?? null,
      amenities: (args.amenities as any) ?? undefined,
      images: (args.images as any) ?? undefined,
      videoUrl: args.videoUrl ?? null,
      ownerId: args.ownerId ?? null,
    },
  });
}

export async function updateProperty(
  organizationId: string,
  id: string,
  data: Partial<Prisma.PropertyUncheckedUpdateInput>,
) {
  return prisma.property.updateMany({
    where: { id, organizationId },
    data,
  });
}

export async function setPropertyStatus(
  organizationId: string,
  id: string,
  status: PropertyStatus,
) {
  return prisma.property.updateMany({
    where: { id, organizationId },
    data: { status },
  });
}

export async function archiveProperty(organizationId: string, id: string) {
  return prisma.property.updateMany({
    where: { id, organizationId },
    data: { archivedAt: new Date() },
  });
}

export async function getFilterOptions(organizationId: string) {
  const [cities, owners] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId, archivedAt: null },
      distinct: ["city"],
      select: { city: true },
    }),
    prisma.user.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    cities: cities.map((c) => c.city).filter(Boolean),
    owners,
  };
}