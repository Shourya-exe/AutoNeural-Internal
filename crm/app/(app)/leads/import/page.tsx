import Link from "next/link";
import { requireActor, can } from "@/server/auth/context";
import { CsvImport } from "@/components/leads/csv-import";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const actor = await requireActor();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-espresso-700"
      >
        <ArrowLeft className="size-3" /> Back to leads
      </Link>
      <div>
        <h1 className="text-lg font-semibold text-espresso">Import leads from CSV</h1>
        <p className="text-xs text-muted-foreground">
          Field mapping, validation, and duplicate preview before anything is written.
        </p>
      </div>

      {can(actor, "lead.import") ? (
        <CsvImport />
      ) : (
        <Card>
          <CardContent className="p-6 text-xs text-espresso-500">
            Managers and Admins can import leads. Ask your manager to run the import.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
