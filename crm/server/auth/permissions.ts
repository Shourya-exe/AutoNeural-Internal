import type { Role } from "@prisma/client";

/**
 * Pure authorization logic — no framework, no database, no next-auth import.
 * The service layer depends on THIS module so permissions can be reasoned about
 * (and unit-tested) independently of the request context.
 */

export type ActorRole = Role;

export interface Actor {
  id: string;
  name: string;
  email: string;
  organizationId: string;
  role: ActorRole;
  isDemo: boolean;
}

export class AuthError extends Error {
  status = 401;
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
  }
}

export const ROLE_RANK: Record<ActorRole, number> = {
  SALES_REP: 1,
  MANAGER: 2,
  ADMIN: 3,
};

export function hasRole(actor: Actor, min: ActorRole): boolean {
  return ROLE_RANK[actor.role] >= ROLE_RANK[min];
}

/**
 * Central capability map — the single source of truth for what each role can do.
 * The Settings → Team page renders this table directly, so what the UI shows is
 * exactly what the server enforces.
 */
export const CAPABILITIES = {
  "lead.create": ["SALES_REP", "MANAGER", "ADMIN"],
  "lead.edit": ["SALES_REP", "MANAGER", "ADMIN"],
  "lead.assign.self": ["SALES_REP", "MANAGER", "ADMIN"],
  "lead.assign.others": ["MANAGER", "ADMIN"],
  "lead.bulk": ["MANAGER", "ADMIN"],
  "lead.archive": ["MANAGER", "ADMIN"],
  "lead.merge": ["MANAGER", "ADMIN"],
  "lead.import": ["MANAGER", "ADMIN"],
  "lead.export": ["MANAGER", "ADMIN"],
  "pipeline.move": ["SALES_REP", "MANAGER", "ADMIN"],
  "task.manage": ["SALES_REP", "MANAGER", "ADMIN"],
  "inbox.send": ["SALES_REP", "MANAGER", "ADMIN"],
  "reports.view": ["MANAGER", "ADMIN"],
  "settings.team": ["ADMIN"],
  "settings.pipeline": ["ADMIN"],
  "settings.services": ["MANAGER", "ADMIN"],
  "settings.integrations": ["ADMIN"],
  "settings.automations": ["ADMIN"],
  "settings.audit": ["MANAGER", "ADMIN"],
  "webhook.replay": ["ADMIN"],
} as const satisfies Record<string, ActorRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(actor: Actor, cap: Capability): boolean {
  return (CAPABILITIES[cap] as readonly ActorRole[]).includes(actor.role);
}

export function requireCan(actor: Actor, cap: Capability): void {
  if (!can(actor, cap)) throw new ForbiddenError();
}
