import { agentAuthorized } from "@/lib/agent-auth";
import { failure } from "@/lib/http";
import { recordAgentCall } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Finished calls posted by voice-agent/agent.py (same contract as AUTONEURAL CRM). */
export async function POST(req: Request) {
  if (!agentAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(recordAgentCall(await req.json()));
  } catch (e) {
    return failure(e);
  }
}
