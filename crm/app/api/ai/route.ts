import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActor } from "@/server/auth/context";
import { runAiTask, aiAvailable } from "@/server/services/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  conversationId: z.string(),
  task: z.enum(["summary", "reply", "extract", "next_actions"]),
});

export async function GET() {
  return NextResponse.json({ available: aiAvailable() });
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }

  // The AI service reads only; it cannot send messages or change permissions.
  const result = await runAiTask(
    actor.organizationId,
    parsed.data.conversationId,
    parsed.data.task,
  );
  return NextResponse.json(result);
}
