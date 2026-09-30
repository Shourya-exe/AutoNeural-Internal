import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { recordAgentCall } from "@/server/services/call-logs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Finished-call ingestion for the Python voice agent (agent.py).
 * Machine-to-machine: authenticated with `Authorization: Bearer <AGENT_INGEST_SECRET>`,
 * not a user session, so it is exempt from the session/basic-auth gates in middleware.
 */

const optStr = (max: number) => z.string().max(max).nullish();

const callSchema = z.object({
  organizationId: optStr(64),
  leadId: optStr(64),
  direction: z.enum(["inbound", "outbound"]),
  fromNumber: optStr(32),
  toNumber: optStr(32),
  customerNumber: optStr(32),
  duration: z.number().int().min(0).max(24 * 3600),
  status: z.enum(["completed", "missed", "busy", "failed"]),
  outcome: optStr(40),
  language: optStr(20),
  transcript: optStr(200_000),
  summary: optStr(2_000),
  sentiment: z.enum(["positive", "neutral", "negative"]).nullish(),
  nextAction: optStr(500),
  roomName: z.string().min(1).max(200),
  startedAt: z.string().datetime({ offset: true }).nullish(),
  endedAt: z.string().datetime({ offset: true }).nullish(),
  handoff: z.record(z.unknown()).nullish(),
  failureReason: optStr(500),
});

function authorized(req: NextRequest): boolean {
  const secret = process.env.AGENT_INGEST_SECRET ?? "";
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = callSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 422 });
  }

  try {
    const result = await recordAgentCall(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[agent-calls] failed to record call:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to record call" }, { status: 500 });
  }
}
