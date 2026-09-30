import { NextResponse } from "next/server";
import { getActor, hasRole } from "@/server/auth/context";
import { startAgent } from "@/lib/voice-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // The worker is a single server-wide process shared by every organization.
  if (!hasRole(actor, "ADMIN")) {
    return NextResponse.json({ error: "Only admins can start the voice agent" }, { status: 403 });
  }

  return NextResponse.json(await startAgent());
}
