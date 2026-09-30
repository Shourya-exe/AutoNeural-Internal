import { failure, requireUser } from "@/lib/http";
import { timeline } from "@/lib/customer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    return Response.json(timeline(user, String(new URL(req.url).searchParams.get("leadId"))), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}
