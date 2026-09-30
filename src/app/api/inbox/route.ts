import { body, failure, requireUser, sameOrigin } from "@/lib/http";
import { allUsers } from "@/lib/store";
import { agentSettings, listConversations, saveAgentSettings, sendTemplate, sendText, thread, updateConversation, waConfigured } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = new URL(req.url).searchParams;
    const id = q.get("id");
    if (id) return Response.json(thread(user, id), { headers: { "Cache-Control": "no-store" } });
    return Response.json(
      {
        conversations: listConversations(user, (q.get("filter") as never) || "all", q.get("q") ?? ""),
        connected: waConfigured(),
        agent: user.role === "admin" ? agentSettings() : { enabled: agentSettings().enabled },
        team: allUsers().filter((u) => u.status !== "INACTIVE").map((u) => ({ id: u.id, name: u.name })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await requireUser();
    const b = (await body(req)) as { action?: string; id?: string; text?: string; template?: string; params?: string[]; category?: "marketing" | "utility"; [k: string]: unknown };
    switch (b.action) {
      case "send":
        return Response.json(await sendText(user, String(b.id), String(b.text ?? "")));
      case "template":
        return Response.json(await sendTemplate(user, { conversationId: String(b.id) }, String(b.template ?? ""), { params: b.params ?? [], category: b.category }));
      case "update":
        return Response.json(updateConversation(user, b));
      case "agent":
        saveAgentSettings(user, b.settings);
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return failure(e);
  }
}
