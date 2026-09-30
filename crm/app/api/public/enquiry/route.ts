import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { websiteFormSchema, websiteFormAdapter } from "@/server/integrations/website-form";
import { enqueueWebhookProcessing } from "@/server/queue/queues";
import { stableHash } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*", // public form endpoint; no credentials accepted
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-form-signature",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Public website enquiry endpoint.
 *
 * Protections: per-IP rate limit, honeypot field, optional HMAC signature,
 * strict schema validation. NO privileged credential is required or accepted
 * here — the browser never holds an API key.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const limit = rateLimit(`enquiry:${ip}`, env.websiteForm.ratePerMinute);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many submissions. Please try again in a minute." },
      { status: 429, headers: { ...CORS, "Retry-After": "60" } },
    );
  }

  const rawBody = await req.text();

  const sig = websiteFormAdapter.verifySignature(rawBody, req.headers);
  if (!(await sig).ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401, headers: CORS });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const parsed = websiteFormSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422, headers: CORS },
    );
  }
  const data = parsed.data;

  // Honeypot — a bot filled the hidden field. Accept silently so it learns nothing.
  if (data.website && data.website.trim() !== "") {
    return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
  }

  if (!data.email && !data.phone) {
    return NextResponse.json(
      { error: "Provide at least an email address or a phone number." },
      { status: 422, headers: CORS },
    );
  }

  const organizationId = (await prisma.organization.findFirst({ select: { id: true } }))?.id;
  if (!organizationId) {
    return NextResponse.json({ error: "Not configured" }, { status: 500, headers: CORS });
  }

  // Stable id so an accidental double-submit within the same minute is deduped.
  const providerEventId = `web:${stableHash(
    [data.email, data.phone, data.message, Math.floor(Date.now() / 60000)].join("|"),
  )}`;

  try {
    const event = await prisma.webhookEvent.create({
      data: {
        organizationId,
        channel: "WEBSITE_FORM",
        providerEventId,
        signatureValid: true,
        status: "RECEIVED",
        payload: { ...data, _id: providerEventId, website: undefined } as any,
      },
    });
    await enqueueWebhookProcessing(event.id);
  } catch (e: any) {
    if (e?.code !== "P2002") {
      console.error("[enquiry] failed to persist", e);
      return NextResponse.json({ error: "Storage failure" }, { status: 500, headers: CORS });
    }
    // Duplicate submit — already captured.
  }

  return NextResponse.json(
    { ok: true, message: "Thanks — our team will be in touch shortly." },
    { status: 201, headers: CORS },
  );
}
