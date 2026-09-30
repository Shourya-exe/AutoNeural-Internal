import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  AuthError,
  ForbiddenError,
  hasRole,
  type Actor,
  type ActorRole,
} from "./permissions";

// Re-export the pure authorization surface so callers have one import site.
export {
  AuthError,
  ForbiddenError,
  CAPABILITIES,
  can,
  requireCan,
  hasRole,
  ROLE_RANK,
} from "./permissions";
export type { Actor, ActorRole, Capability } from "./permissions";

/**
 * Resolve the current actor.
 *  - Normal mode: from the Auth.js session.
 *  - Demo mode: falls back to the seeded demo Admin so the product can be
 *    previewed without credentials. Clearly a preview, never "connected".
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth().catch(() => null);
  const u = session?.user as
    | { id?: string; organizationId?: string; role?: ActorRole; name?: string; email?: string }
    | undefined;

  if (u?.id && u.organizationId) {
    const current = await prisma.user.findUnique({ where: { id: u.id }, include: { membership: true } });
    if (!current?.isActive || !current.membership) return null;
    return {
      id: current.id,
      name: current.name,
      email: current.email,
      organizationId: current.organizationId,
      role: current.membership.role,
      isDemo: false,
    };
  }

  return null;
});

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthError("Sign in required.");
  return actor;
}

export async function requireRole(min: ActorRole): Promise<Actor> {
  const actor = await requireActor();
  if (!hasRole(actor, min)) throw new ForbiddenError();
  return actor;
}
