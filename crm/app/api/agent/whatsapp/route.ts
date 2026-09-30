import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { sendVoiceWhatsApp } from "@/server/services/voice-whatsapp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ organizationId: z.string().min(1).max(64), leadId: z.string().max(64).nullish(), phone: z.string().min(8).max(32), name: z.string().max(80).optional(), message: z.string().trim().min(1).max(1000), requestId: z.string().min(1).max(240), confirmed: z.literal(true) });
export async function POST(req: NextRequest) {
  const secret = process.env.AGENT_INGEST_SECRET;
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !timingSafeEqual(createHash("sha256").update(secret).digest(), createHash("sha256").update(token).digest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid or unconfirmed WhatsApp request" }, { status: 422 });
  if (process.env.AGENT_DEFAULT_ORG_ID && parsed.data.organizationId !== process.env.AGENT_DEFAULT_ORG_ID) return NextResponse.json({ error: "Workspace mismatch" }, { status: 403 });
  try { return NextResponse.json(await sendVoiceWhatsApp(parsed.data)); }
  catch (e) { return NextResponse.json({ accepted: false, error: e instanceof Error ? e.message : "Message could not be sent" }, { status: 409 }); }
}
