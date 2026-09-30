import { body, failure, requireUser, sameOrigin } from "@/lib/http";
import { requireAdmin } from "@/lib/store";
import { auditLog } from "@/lib/platform";
import { addRateCard, saveBudgets, usageReport } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = new URL(req.url).searchParams;
    if (q.get("view") === "audit") {
      requireAdmin(user);
      return Response.json({ events: auditLog() });
    }
    return Response.json(usageReport(user, q.get("month") || undefined));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await requireUser();
    const b = (await body(req)) as { action?: string; [k: string]: unknown };
    if (b.action === "rates") addRateCard(user, b.rates);
    else if (b.action === "budgets") saveBudgets(user, b.budgets);
    else return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
