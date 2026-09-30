import Link from "next/link";
import { requireActor, can } from "@/server/auth/context";
import { findDuplicateGroups, findIdentitiesNeedingReview } from "@/server/services/duplicates";
import { fmtDate, fmtDateTime, relativeTime } from "@/lib/datetime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { DuplicateGroupCard } from "@/components/leads/duplicate-group";
import { channelMeta } from "@/components/domain/badges";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const actor = await requireActor();
  const [groups, needsReview] = await Promise.all([
    findDuplicateGroups(actor.organizationId),
    findIdentitiesNeedingReview(actor.organizationId),
  ]);

  return (
    <div className="space-y-4">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-espresso-700"
      >
        <ArrowLeft className="size-3" /> Back to leads
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-espresso">Duplicate review</h1>
        <p className="text-xs text-muted-foreground">
          Candidates are grouped only on a reliable identifier — a normalised E.164 phone number
          or a lowercased email. Name similarity is never used, and nothing is merged
          automatically.
        </p>
      </div>

      {needsReview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Channel identities needing review ({needsReview.length})</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              The resolver linked these provisionally because the evidence was ambiguous.
            </p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {needsReview.map((ci) => (
              <div
                key={ci.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs text-espresso-700">
                    {ci.contact.fullName}{" "}
                    <span className="text-muted-foreground">
                      · {channelMeta(ci.channel).label}
                    </span>
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {ci.externalId}
                  </p>
                </div>
                <Badge variant="danger">{relativeTime(ci.createdAt)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-6" />}
          title="No duplicate candidates"
          hint="No two open leads share a normalised phone number or email address."
        />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <DuplicateGroupCard
              key={g.key}
              matchedOn={g.matchedOn}
              value={g.value}
              canMerge={can(actor, "lead.merge")}
              leads={g.leads.map((l) => ({
                ...l,
                createdAt: fmtDate(l.createdAt),
                lastActivityAt: fmtDateTime(l.lastActivityAt),
              }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
