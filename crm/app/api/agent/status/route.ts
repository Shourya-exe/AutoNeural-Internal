import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/context";
import { getAgentStatus } from "@/lib/voice-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await getAgentStatus());
}
