import { body, failure, requireUser, sameOrigin } from "@/lib/http";
import { askBusiness, draftEmail, leadGuidance } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await requireUser();
    const b = (await body(req)) as { action?: string; leadId?: string; question?: string };
    if (b.action === "guidance") return Response.json(await leadGuidance(user, String(b.leadId)));
    if (b.action === "email") return Response.json(await draftEmail(user, b));
    if (b.action === "ask") return Response.json(await askBusiness(user, b.question));
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return failure(e);
  }
}
