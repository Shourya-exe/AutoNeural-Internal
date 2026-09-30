import { body, failure, requireUser, sameOrigin } from "@/lib/http";
import { allUsers } from "@/lib/store";
import { currentRates } from "@/lib/usage";
import { deleteWorkflow, draftFromText, estimate, listRuns, listWorkflows, recentEventVolume, saveWorkflow, setEnabled, workflowSchema } from "@/lib/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const runs = new URL(req.url).searchParams.get("runs");
    if (runs) return Response.json({ runs: listRuns(user, runs) });
    return Response.json({ workflows: listWorkflows(user), team: allUsers().map((u) => ({ id: u.id, name: u.name })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await requireUser();
    const b = (await body(req)) as { action?: string; id?: string; [k: string]: unknown };
    switch (b.action) {
      case "save":
        return Response.json(saveWorkflow(user, b));
      case "draft":
        return Response.json({ definition: await draftFromText(user, b.text) });
      case "estimate": {
        const def = workflowSchema.parse(b.definition);
        return Response.json({ ...estimate(def, currentRates()), eventsLast30Days: recentEventVolume(def.trigger) });
      }
      case "enable":
        return Response.json(setEnabled(user, String(b.id), b.enabled === true));
      case "delete":
        deleteWorkflow(user, String(b.id));
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return failure(e);
  }
}
