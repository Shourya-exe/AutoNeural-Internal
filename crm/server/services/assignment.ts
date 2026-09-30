import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Round-robin assignment across active Sales Representatives (and Managers who
 * opt in by having role MANAGER — they are eligible owners too). Uses
 * Membership.lastAssignedAt as the rotation cursor so it is stable across
 * restarts and safe under concurrency (ordered pick + timestamp bump).
 */
export async function pickRoundRobinOwner(
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<string | null> {
  const eligible = await tx.membership.findMany({
    where: {
      organizationId,
      role: { in: ["SALES_REP", "MANAGER"] },
      user: { isActive: true },
    },
    orderBy: [{ lastAssignedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: { id: true, userId: true },
  });
  if (eligible.length === 0) return null;
  const chosen = eligible[0];
  await tx.membership.update({
    where: { id: chosen.id },
    data: { lastAssignedAt: new Date() },
  });
  return chosen.userId;
}

/**
 * Resolve the owner for a new lead given an automation rule config.
 *   { mode: "round_robin" } | { mode: "fixed", userId }
 */
export async function resolveAssignment(
  organizationId: string,
  config: { mode?: string; userId?: string } | null | undefined,
  tx: Prisma.TransactionClient = prisma,
): Promise<string | null> {
  if (config?.mode === "fixed" && config.userId) {
    const member = await tx.membership.findFirst({
      where: { organizationId, userId: config.userId },
      select: { userId: true },
    });
    return member?.userId ?? null;
  }
  return pickRoundRobinOwner(organizationId, tx);
}
