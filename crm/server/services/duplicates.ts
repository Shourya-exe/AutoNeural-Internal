import { prisma } from "@/lib/prisma";
import { toE164 } from "@/lib/phone";

export interface DuplicateGroup {
  key: string;
  matchedOn: "phone" | "email";
  value: string;
  leads: {
    id: string;
    title: string;
    contactName: string;
    company: string | null;
    phone: string | null;
    email: string | null;
    sourceChannel: string;
    stageName: string;
    ownerName: string | null;
    createdAt: Date;
    lastActivityAt: Date;
    messageCount: number;
    taskCount: number;
  }[];
}

/**
 * Candidate duplicates for HUMAN review.
 *
 * Grouped only on a reliable identifier — normalised E.164 phone or lowercased
 * email. Name similarity is deliberately NOT used: two different people often
 * share a name, and an automatic merge on that basis destroys history.
 * Nothing here merges anything; it produces a list for someone to decide on.
 */
export async function findDuplicateGroups(organizationId: string): Promise<DuplicateGroup[]> {
  const leads = await prisma.lead.findMany({
    where: { organizationId, archivedAt: null },
    include: {
      contact: true,
      owner: true,
      stage: true,
      _count: { select: { tasks: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });

  const byPhone = new Map<string, typeof leads>();
  const byEmail = new Map<string, typeof leads>();

  for (const l of leads) {
    const phone = toE164(l.contact.primaryPhone);
    const email = l.contact.primaryEmail?.trim().toLowerCase() || null;
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), l]);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), l]);
  }

  const messageCounts = new Map<string, number>();
  const grouped = await prisma.message.groupBy({
    by: ["conversationId"],
    where: { organizationId },
    _count: { _all: true },
  });
  const convos = await prisma.conversation.findMany({
    where: { organizationId, leadId: { not: null } },
    select: { id: true, leadId: true },
  });
  const convoToLead = new Map(convos.map((c) => [c.id, c.leadId!]));
  for (const g of grouped) {
    const leadId = convoToLead.get(g.conversationId);
    if (leadId) messageCounts.set(leadId, (messageCounts.get(leadId) ?? 0) + g._count._all);
  }

  const shape = (l: (typeof leads)[number]) => ({
    id: l.id,
    title: l.title,
    contactName: l.contact.fullName,
    company: l.contact.company,
    phone: l.contact.primaryPhone,
    email: l.contact.primaryEmail,
    sourceChannel: l.sourceChannel as string,
    stageName: l.stage.name,
    ownerName: l.owner?.name ?? null,
    createdAt: l.createdAt,
    lastActivityAt: l.lastActivityAt,
    messageCount: messageCounts.get(l.id) ?? 0,
    taskCount: l._count.tasks,
  });

  const groups: DuplicateGroup[] = [];
  const seenPairs = new Set<string>();

  for (const [value, ls] of byPhone) {
    if (ls.length < 2) continue;
    const key = `phone:${value}`;
    seenPairs.add(ls.map((l) => l.id).sort().join("|"));
    groups.push({ key, matchedOn: "phone", value, leads: ls.map(shape) });
  }
  for (const [value, ls] of byEmail) {
    if (ls.length < 2) continue;
    // Skip a group already reported via phone with exactly the same members.
    if (seenPairs.has(ls.map((l) => l.id).sort().join("|"))) continue;
    groups.push({ key: `email:${value}`, matchedOn: "email", value, leads: ls.map(shape) });
  }

  return groups.sort((a, b) => b.leads.length - a.leads.length);
}

/** Channel identities the resolver could not link with confidence. */
export async function findIdentitiesNeedingReview(organizationId: string) {
  return prisma.channelIdentity.findMany({
    where: { organizationId, needsReview: true },
    include: { contact: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
