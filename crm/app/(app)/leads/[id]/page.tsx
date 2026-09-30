import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor, can } from "@/server/auth/context";
import { getLeadFull, getFilterOptions } from "@/server/services/lead-queries";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/money";
import { fmtDateTime, fmtDate, relativeTime, isOverdue } from "@/lib/datetime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, EmptyState } from "@/components/ui/misc";
import {
  ChannelBadge,
  PriorityBadge,
  StageBadge,
  StatusBadge,
  CHANNEL_META,
} from "@/components/domain/badges";
import { LeadActions } from "@/components/leads/lead-actions";
import { ArrowLeft, Paperclip, ShieldCheck, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadProfile({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const lead = await getLeadFull(actor.organizationId, id);
  if (!lead) notFound();

  const [options, audit] = await Promise.all([
    getFilterOptions(actor.organizationId),
    prisma.auditLog.findMany({
      where: { organizationId: actor.organizationId, entityType: "Lead", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { actor: true },
    }),
  ]);

  // Merge activities + messages into one chronological timeline.
  const timeline = [
    ...lead.activities.map((a) => ({
      kind: "activity" as const,
      at: a.createdAt,
      type: a.type,
      summary: a.summary,
      actor: a.actor?.name ?? "System",
    })),
    ...lead.conversations.flatMap((c) =>
      c.messages.map((m) => ({
        kind: "message" as const,
        at: m.createdAt,
        direction: m.direction,
        channel: c.channel,
        body: m.body ?? "(attachment)",
        internal: m.isInternalNote,
        status: m.deliveryStatus,
      })),
    ),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const primaryConversation = lead.conversations[0] ?? null;
  const openTasks = lead.tasks.filter((t) => t.status === "OPEN");

  return (
    <div className="space-y-4">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-espresso-700"
      >
        <ArrowLeft className="size-3" /> Back to leads
      </Link>

      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Avatar name={lead.contact.fullName} className="size-11 text-sm" />
            <div>
              <h1 className="text-lg font-semibold text-espresso">{lead.contact.fullName}</h1>
              <p className="text-xs text-muted-foreground">
                {lead.contact.company ?? "No company"} ·{" "}
                {lead.service?.name ?? lead.interestedService ?? "Service not set"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StageBadge
                  name={lead.stage.name}
                  isWon={lead.stage.isWon}
                  isLost={lead.stage.isLost}
                />
                <StatusBadge status={lead.status} />
                <PriorityBadge priority={lead.priority} />
                <ChannelBadge channel={lead.sourceChannel} />
                {lead.archivedAt && <Badge variant="muted">Archived</Badge>}
                {lead.tags.map((t) => (
                  <span
                    key={t.tagId}
                    className="rounded-full px-2 py-0.5 text-[10px]"
                    style={{ background: `${t.tag.color}33`, boxShadow: `inset 0 0 0 1px ${t.tag.color}55`, color: `color-mix(in srgb, ${t.tag.color} 40%, white)` }}
                  >
                    {t.tag.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Estimated value
            </p>
            <p className="text-xl font-semibold tabular-nums text-espresso">
              {lead.estimatedValue ? money(lead.estimatedValue) : "—"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Owner: {lead.owner?.name ?? <span className="text-gold-700">Unassigned</span>}
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <LeadActions
            leadId={lead.id}
            ownerId={lead.ownerId}
            stageId={lead.stageId}
            archived={!!lead.archivedAt}
            conversationId={primaryConversation?.id ?? null}
            members={options.members.map((m) => ({ userId: m.userId, name: m.user.name }))}
            stages={options.stages.map((s) => ({ id: s.id, name: s.name, isLost: s.isLost }))}
            canAssignOthers={can(actor, "lead.assign.others")}
            canArchive={can(actor, "lead.archive")}
            phone={lead.archivedAt ? null : lead.contact.primaryPhone}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Contact &amp; business</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <Field label="Full name" value={lead.contact.fullName} />
              <Field label="Company" value={lead.contact.company} />
              <Field label="Phone (E.164)" value={lead.contact.primaryPhone} />
              <Field label="Email" value={lead.contact.primaryEmail} />
              <Field label="Contact created" value={fmtDate(lead.contact.createdAt)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Channel identities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lead.contact.channelIdentities.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No messaging identities linked to this contact yet.
                </p>
              )}
              {lead.contact.channelIdentities.map((ci) => (
                <div
                  key={ci.id}
                  className="flex items-center justify-between rounded-md border border-border px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-espresso-700">
                      {CHANNEL_META[ci.channel].label}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {ci.externalId}
                    </p>
                  </div>
                  {ci.needsReview ? (
                    <Badge variant="danger">
                      <AlertCircle className="size-3" /> Review match
                    </Badge>
                  ) : (
                    <Badge variant="success">
                      <ShieldCheck className="size-3" /> Verified
                    </Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Acquisition &amp; attribution</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                The original source is preserved even when the contact later reaches out on
                another channel.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <Field label="Original source" value={CHANNEL_META[lead.sourceChannel].label} />
              <Field label="Source detail" value={lead.sourceDetail} />
              <Field label="Campaign" value={lead.campaignName} />
              <Field label="Campaign ID" value={lead.campaignId} mono />
              <Field label="Form ID" value={lead.formId} mono />
              <Field label="Ad ID" value={lead.adId} mono />
              <Field label="UTM source / medium" value={joinNonEmpty([lead.utmSource, lead.utmMedium])} />
              <Field label="UTM campaign" value={lead.utmCampaign} />
              <Field label="Referrer" value={lead.referrerUrl} />
              <Field label="Landing page" value={lead.landingUrl} />

              {lead.touchpoints.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Subsequent touchpoints
                  </p>
                  {lead.touchpoints.map((t) => (
                    <div key={t.id} className="flex items-center justify-between py-1">
                      <ChannelBadge channel={t.channel} />
                      <span className="text-[10px] text-muted-foreground">
                        {relativeTime(t.occurredAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent>
              {lead.attachments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No attachments. Files are served through an access-checked route — never a
                  public URL.
                </p>
              ) : (
                lead.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`/api/attachments/${a.id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-champagne-50"
                  >
                    <Paperclip className="size-3.5 text-espresso-300" />
                    {a.fileName}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {(a.size / 1024).toFixed(0)} KB
                    </span>
                  </a>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Middle column — timeline */}
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Conversation &amp; activity timeline</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[640px] space-y-3 overflow-y-auto">
              {timeline.length === 0 && (
                <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
              )}
              {timeline.map((item, i) => (
                <div key={i} className="flex gap-2.5">
                  <div className="mt-1 flex flex-col items-center">
                    <span
                      className={
                        "size-2 rounded-full " +
                        (item.kind === "message"
                          ? item.direction === "INBOUND"
                            ? "bg-gold"
                            : "bg-emerald"
                          : "bg-champagne-300")
                      }
                    />
                    {i < timeline.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    {item.kind === "message" ? (
                      <>
                        <p className="text-[11px] text-muted-foreground">
                          {item.direction === "INBOUND" ? "Received" : "Sent"} ·{" "}
                          {CHANNEL_META[item.channel].label}
                          {item.internal && " · internal note"}
                        </p>
                        <p
                          className={
                            "mt-0.5 rounded-md px-2.5 py-1.5 text-xs " +
                            (item.internal
                              ? "border border-dashed border-gold/40 bg-gold/5 text-espresso-700"
                              : item.direction === "INBOUND"
                                ? "bg-champagne-50 text-espresso-700"
                                : "bg-emerald-50 text-espresso-700")
                          }
                        >
                          {item.body}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-espresso-700">{item.summary}</p>
                        <p className="text-[11px] text-muted-foreground">{item.actor}</p>
                      </>
                    )}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {fmtDateTime(item.at)}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Follow-up schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="rounded-md border border-border px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Next follow-up</p>
                <p
                  className={
                    "text-sm font-medium " +
                    (isOverdue(lead.nextFollowUpAt) ? "text-danger-600" : "text-espresso-700")
                  }
                >
                  {lead.nextFollowUpAt ? fmtDateTime(lead.nextFollowUpAt) : "Not scheduled"}
                  {isOverdue(lead.nextFollowUpAt) && " · overdue"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-md border border-border px-3 py-2">
                  <p className="text-muted-foreground">First inbound</p>
                  <p className="text-espresso-700">{fmtDateTime(lead.firstInboundAt)}</p>
                </div>
                <div className="rounded-md border border-border px-3 py-2">
                  <p className="text-muted-foreground">First human reply</p>
                  <p className={lead.firstResponseAt ? "text-emerald-600" : "text-danger-600"}>
                    {lead.firstResponseAt ? fmtDateTime(lead.firstResponseAt) : "Awaiting"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tasks ({openTasks.length} open)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {lead.tasks.length === 0 && (
                <p className="text-xs text-muted-foreground">No tasks on this lead.</p>
              )}
              {lead.tasks.map((t) => (
                <div
                  key={t.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-border px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <p
                      className={
                        "text-xs " +
                        (t.status === "DONE"
                          ? "text-muted-foreground line-through"
                          : "text-espresso-700")
                      }
                    >
                      {t.title}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {t.assignee?.name ?? "Unassigned"} · {fmtDateTime(t.dueAt)}
                    </p>
                  </div>
                  {t.status === "OPEN" && isOverdue(t.dueAt) && (
                    <Badge variant="danger">Overdue</Badge>
                  )}
                  {t.status === "DONE" && <Badge variant="success">Done</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lead.notes.length === 0 && (
                <p className="text-xs text-muted-foreground">No notes yet.</p>
              )}
              {lead.notes.map((n) => (
                <div key={n.id} className="rounded-md bg-champagne-50 px-3 py-2">
                  <p className="text-xs text-espresso-700">{n.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {n.author.name} · {relativeTime(n.createdAt)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {audit.length === 0 && (
                <p className="text-xs text-muted-foreground">No audited changes yet.</p>
              )}
              {audit.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-espresso-500">{a.action}</span>
                  <span className="text-muted-foreground">
                    {a.actor?.name ?? "system"} · {relativeTime(a.createdAt)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={
          "text-right text-espresso-700 " + (mono ? "font-mono text-[10px]" : "")
        }
      >
        {value || "—"}
      </span>
    </div>
  );
}

function joinNonEmpty(parts: (string | null | undefined)[]) {
  const v = parts.filter(Boolean).join(" / ");
  return v || null;
}
