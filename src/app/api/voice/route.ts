import { body, failure, requireUser, sameOrigin } from "@/lib/http";
import { agentStatus, callProgress, clickToCall, exotelConfigured, listCalls, logCall, placeCall, startAgent, stopAgent } from "@/lib/voice";
import { profiles } from "@/lib/hr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const room = new URL(req.url).searchParams.get("room");
    if (room) return Response.json(await callProgress(user, room), { headers: { "Cache-Control": "no-store" } });
    return Response.json({ agent: await agentStatus(), calls: listCalls(user), cloudCalling: exotelConfigured() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await requireUser();
    const b = (await body(req)) as { action?: string };
    if (b.action === "call") return Response.json(await placeCall(user, b));
    if (b.action === "start") return Response.json(await startAgent(user));
    if (b.action === "stop") return Response.json(stopAgent(user));
    if (b.action === "log") return Response.json(logCall(user, b));
    if (b.action === "dial") {
      const appUrl = (process.env.CRM_APP_URL || new URL(req.url).origin).replace(/\/$/, "");
      const phone = (profiles(user).find((p) => p.userId === user.id)?.phone as string | undefined) ?? null;
      return Response.json(await clickToCall(user, String((b as { leadId?: string }).leadId), appUrl, phone));
    }
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return failure(e);
  }
}
