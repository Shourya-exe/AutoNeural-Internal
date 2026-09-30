import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActor } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { toE164 } from "@/lib/phone";
import { dispatchOutboundCall, getLiveCallPhase } from "@/lib/voice-agent";
import { writeActivity } from "@/server/services/audit";
import { resolveIdentity } from "@/server/services/identity";
import { findOrCreateLeadForContact } from "@/server/services/leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Either call an existing lead, or dial any number (a contact + lead is found or created). */
const bodySchema = z.union([
  z.object({ leadId: z.string().min(1).max(64), context: z.string().max(1000).optional() }),
  z.object({
    phone: z.string().min(1).max(32),
    name: z.string().max(80).optional(),
    context: z.string().max(1000).optional(),
  }),
]);

/**
 * Progress of a dispatched call (polled by the dialer): live phase from LiveKit while the
 * room exists, then the stored AgentSession once the agent has posted the finished call.
 */
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomName = req.nextUrl.searchParams.get("room") ?? "";
  if (!/^call-[\w-]{1,100}$/.test(roomName)) {
    return NextResponse.json({ error: "Invalid room" }, { status: 422 });
  }

  const session = await prisma.agentSession.findFirst({
    where: { organizationId: actor.organizationId, roomName },
    select: { status: true, duration: true, summary: true, transcript: true, leadId: true, metadata: true },
  });
  if (session) {
    const meta = (session.metadata ?? {}) as { outcome?: string; failureReason?: string };
    const { metadata: _omit, ...rest } = session;
    return NextResponse.json({
      phase: "ended",
      logged: true,
      ...rest,
      outcome: meta.outcome ?? null,
      failureReason: meta.failureReason ?? null,
    });
  }

  const phase = await getLiveCallPhase(roomName);
  // Room gone but not logged yet: the agent is still writing the summary.
  return NextResponse.json({ phase: phase ?? "wrapping_up", logged: false });
}

/** "Call with AI" — have the voice agent phone someone now. */
export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a leadId or a phone number." }, { status: 422 });
  }
  const body = parsed.data;
  const organizationId = actor.organizationId;

  let leadId: string;
  let phone: string | null;
  let displayName: string;

  if ("leadId" in body) {
    const lead = await prisma.lead.findFirst({
      where: { id: body.leadId, organizationId, archivedAt: null },
      include: { contact: { select: { fullName: true, primaryPhone: true } } },
    });
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    leadId = lead.id;
    phone = toE164(lead.contact.primaryPhone);
    displayName = lead.contact.fullName;
    if (!phone) return NextResponse.json({ error: "This lead has no valid phone number." }, { status: 422 });
  } else {
    phone = toE164(body.phone);
    if (!phone) {
      return NextResponse.json(
        { error: "That doesn't look like a valid phone number. Use +91XXXXXXXXXX or a 10-digit mobile." },
        { status: 422 },
      );
    }
    const identity = await resolveIdentity(organizationId, {
      channel: "PHONE",
      externalId: phone,
      phone,
      displayName: body.name?.trim() || null,
    });
    const { lead } = await findOrCreateLeadForContact({
      organizationId,
      contactId: identity.contactId,
      channel: "PHONE",
      sourceDetail: "AI voice agent (dialer)",
    });
    leadId = lead.id;
    displayName = body.name?.trim() || phone;
  }

  const result = await dispatchOutboundCall({ organizationId, leadId, phone, context: body.context });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 503 });

  await writeActivity({
    organizationId,
    leadId,
    actorUserId: actor.id,
    type: "TOUCHPOINT",
    summary: `AI voice call to ${phone} requested`,
    meta: { roomName: result.roomName, dispatchId: result.dispatchId, channel: "PHONE" },
  });

  return NextResponse.json({
    ok: true,
    message: `Calling ${displayName} (${phone}) — the phone should ring in a few seconds.`,
    roomName: result.roomName,
    leadId,
  });
}
