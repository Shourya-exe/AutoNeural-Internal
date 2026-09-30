import { requireActor } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { sendEligibility } from "@/server/services/conversations";
import { money } from "@/lib/money";
import { fmtDateTime, relativeTime } from "@/lib/datetime";
import { InboxView, type ConvoSummary, type ActiveConvo } from "@/components/inbox/inbox-view";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; channel?: string; view?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;
  const orgId = actor.organizationId;

  const where: Prisma.ConversationWhereInput = { organizationId: orgId };
  if (sp.channel) where.channel = sp.channel as any;
  if (sp.view === "mine") where.assigneeId = actor.id;
  if (sp.view === "unassigned") where.assigneeId = null;
  if (sp.view === "unread") where.unread = true;
  if (sp.view === "resolved") where.state = "RESOLVED";
  else if (!sp.view) where.state = { in: ["OPEN", "RESOLVED"] };

  const [convos, members] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      include: {
        contact: true,
        assignee: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.membership.findMany({ where: { organizationId: orgId }, include: { user: true } }),
  ]);

  const list: ConvoSummary[] = convos.map((c) => ({
    id: c.id,
    channel: c.channel,
    contactName: c.contact.fullName,
    company: c.contact.company,
    preview: c.messages[0]?.body?.slice(0, 90) ?? "(no messages)",
    lastAt: relativeTime(c.lastMessageAt),
    unread: c.unread,
    state: c.state,
    assigneeName: c.assignee?.name ?? null,
    assigneeId: c.assigneeId,
    leadId: c.leadId,
  }));

  const activeId = sp.c ?? convos[0]?.id;
  let active: ActiveConvo | null = null;

  if (activeId) {
    const c = await prisma.conversation.findFirst({
      where: { id: activeId, organizationId: orgId },
      include: {
        contact: { include: { channelIdentities: true } },
        lead: { include: { stage: true, owner: true } },
        messages: { orderBy: { createdAt: "asc" }, include: { sender: true } },
      },
    });
    if (c) {
      const elig = await sendEligibility(orgId, c.id);
      active = {
        id: c.id,
        channel: c.channel,
        contactName: c.contact.fullName,
        company: c.contact.company,
        phone: c.contact.primaryPhone,
        email: c.contact.primaryEmail,
        leadId: c.leadId,
        leadTitle: c.lead?.title ?? null,
        stageName: c.lead?.stage.name ?? null,
        ownerName: c.lead?.owner?.name ?? null,
        value: c.lead?.estimatedValue ? money(c.lead.estimatedValue) : "—",
        assigneeId: c.assigneeId,
        state: c.state,
        identities: c.contact.channelIdentities.map((i) => ({
          channel: i.channel,
          externalId: i.externalId,
        })),
        messages: c.messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          body: m.body ?? "(attachment)",
          internal: m.isInternalNote,
          automated: m.isAutomated,
          status: m.deliveryStatus,
          at: fmtDateTime(m.providerTimestamp ?? m.createdAt),
          senderName: m.sender?.name ?? null,
        })),
        eligibility: { canSend: elig.canSend, reason: elig.reason },
      };
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-espresso">Unified inbox</h1>
        <p className="text-xs text-muted-foreground">
          WhatsApp, Messenger and Instagram in one place. Internal notes are never sent to the
          customer. Delivery state comes only from provider callbacks.
        </p>
      </div>
      <InboxView
        conversations={list}
        active={active}
        members={members.map((m) => ({ userId: m.userId, name: m.user.name }))}
        currentUserId={actor.id}
      />
    </div>
  );
}
