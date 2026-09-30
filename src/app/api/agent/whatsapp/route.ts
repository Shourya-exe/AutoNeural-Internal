import { agentAuthorized } from "@/lib/agent-auth";
import { failure } from "@/lib/http";
import { recordWhatsAppRequest } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** WhatsApp follow-ups requested during a call (voice-agent/whatsapp_sender.py). */
export async function POST(req: Request) {
  if (!agentAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await recordWhatsAppRequest(await req.json()));
  } catch (e) {
    return failure(e);
  }
}
