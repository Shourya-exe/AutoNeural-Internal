import Link from "next/link";
import { requireActor } from "@/server/auth/context";
import { getFilterOptions } from "@/server/services/lead-queries";
import { NewLeadForm } from "@/components/leads/new-lead-form";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NewLeadPage() {
  const actor = await requireActor();
  const options = await getFilterOptions(actor.organizationId);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-espresso-700"
      >
        <ArrowLeft className="size-3" /> Back to leads
      </Link>
      <div className="rounded-lg border border-border bg-card p-6 shadow-card">
        <h1 className="text-base font-semibold text-espresso">New lead</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Creates a contact and an opportunity. Automation rules (assignment, notification,
          first follow-up task) run immediately.
        </p>
        <NewLeadForm
          services={options.services.map((s) => ({ id: s.id, name: s.name }))}
          members={options.members.map((m) => ({ userId: m.userId, name: m.user.name }))}
        />
      </div>
    </div>
  );
}
