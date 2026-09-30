import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActor } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { logCallToSheet } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const logSchema = z.object({
  leadId: z.string().optional(),
  contactId: z.string().optional(),
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  fromNumber: z.string().optional(),
  toNumber: z.string().optional(),
  duration: z.number().int().min(0).default(0),
  status: z.string().default("completed"),
  summary: z.string().optional(),
  sentiment: z.string().optional(),
  transcript: z.string().optional(),
  recordingUrl: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = logSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 422 });
  }

  const data = parsed.data;

  const callLog = await prisma.callLog.create({
    data: {
      organizationId: actor.organizationId,
      leadId: data.leadId ?? null,
      contactId: data.contactId ?? null,
      direction: data.direction,
      fromNumber: data.fromNumber ?? null,
      toNumber: data.toNumber ?? null,
      duration: data.duration,
      status: data.status,
      summary: data.summary ?? null,
      sentiment: data.sentiment ?? null,
      transcript: data.transcript ?? null,
      recordingUrl: data.recordingUrl ?? null,
    },
  });

  // Best-effort Google Sheet logging
  let sheetLogged = false;
  const sheetResult = await logCallToSheet({
    timestamp: new Date().toISOString(),
    customer: "",
    phone: (data.direction === "inbound" ? data.fromNumber : data.toNumber) ?? "",
    direction: data.direction,
    status: data.status,
    duration: `${data.duration}s`,
    language: "",
    summary: data.summary ?? "",
    nextAction: "",
    transcript: data.transcript ?? "",
  });
  if (sheetResult.logged) {
    sheetLogged = true;
    await prisma.callLog.update({ where: { id: callLog.id }, data: { sheetLogged: true } });
  }

  return NextResponse.json({
    callLog,
    sheetLogged,
    sheetError: sheetResult.error ?? null,
  });
}