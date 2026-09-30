import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redact } from "@/lib/crypto";
import { getAdapter } from "@/server/integrations/registry";
import { enqueueWebhookProcessing } from "@/server/queue/queues";
import { env } from "@/lib/env";
import type { Channel } from "@prisma/client";

/**
 * Shared webhook receiver.
 *
 * Contract (steps 1–4 of the ingestion workflow):
 *   1. Verify the signature against the RAW body.
 *   2. Persist the event durably (unique on org+channel+providerEventId).
 *   3. Acknowledge the provider immediately (200) — never block on processing.
 *   4. Hand off to the background worker (BullMQ; inline fallback without Redis).
 *
 * A duplicate delivery hits the unique constraint and is acknowledged as a
 * no-op, so exactly one message/lead is ever created.
 */
export function makeWebhookHandlers(channel: Channel) {
  const adapter = getAdapter(channel);

  async function GET(req: NextRequest) {
    // Meta subscription handshake.
    const challenge = adapter?.verifyChallenge?.(req.nextUrl.searchParams);
    if (challenge !== null && challenge !== undefined) {
      return new NextResponse(challenge, { status: 200 });
    }
    return NextResponse.json({ error: "Verification failed" }, { status: 403 });
  }

  async function POST(req: NextRequest) {
    if (!adapter) {
      return NextResponse.json({ error: "Channel not supported" }, { status: 404 });
    }

    // 1. Raw body is required for signature verification — read it once.
    const rawBody = await req.text();

    const verification = await adapter.verifySignature(rawBody, req.headers, publicUrl(req));
    if (!verification.ok) {
      // Log the rejection without echoing headers/secrets.
      console.warn(`[webhook:${channel}] signature rejected: ${verification.reason}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = adapter.parsePayload
        ? adapter.parsePayload(rawBody, req.headers.get("content-type"))
        : JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    // Resolve the organization. Single-tenant deployment: the org that owns the
    // connection for this channel, else the only organization.
    const org =
      (await prisma.integrationConnection.findFirst({
        where: { channel },
        select: { organizationId: true },
      })) ?? null;
    const organizationId =
      org?.organizationId ?? (await prisma.organization.findFirst({ select: { id: true } }))?.id;

    if (!organizationId) {
      return NextResponse.json({ error: "No organization configured" }, { status: 500 });
    }

    // Normalize just to extract stable provider event ids.
    let normalized: { providerEventId: string }[] = [];
    try {
      normalized = adapter.normalize(payload);
    } catch (e) {
      console.error(`[webhook:${channel}] normalize failed`, e);
    }

    // Some payloads carry several events (e.g. batched Meta entries). Persist one
    // WebhookEvent per provider event id so dedupe is per-event.
    const ids = normalized.length
      ? [...new Set(normalized.map((n) => n.providerEventId))]
      : [`${channel}:raw:${hash(rawBody)}`];

    const created: string[] = [];
    for (const providerEventId of ids) {
      try {
        const event = await prisma.webhookEvent.create({
          data: {
            organizationId,
            channel,
            providerEventId,
            signatureValid: true,
            status: "RECEIVED",
            payload: payload as any,
            headers: redact(headerObject(req.headers)) as any,
          },
        });
        created.push(event.id);
      } catch (e: any) {
        if (e?.code === "P2002") {
          // 5/6. Already delivered — acknowledge without re-processing.
          continue;
        }
        console.error(`[webhook:${channel}] persist failed`, e);
        // Returning 500 asks the provider to retry — the event was not stored.
        return NextResponse.json({ error: "Storage failure" }, { status: 500 });
      }
    }

    // 4. Hand off to the worker (does not block the response meaningfully).
    for (const id of created) {
      await enqueueWebhookProcessing(id).catch((e) =>
        console.error(`[webhook:${channel}] enqueue failed`, e),
      );
    }

    // 3. Prompt acknowledgement.
    const ack = adapter.ackResponse?.();
    if (ack) {
      return new NextResponse(ack.body, { status: 200, headers: { "Content-Type": ack.contentType } });
    }
    return NextResponse.json({ received: true, stored: created.length, duplicates: ids.length - created.length });
  }

  return { GET, POST };
}

/**
 * The public URL the provider called. Behind a reverse proxy (Caddy/nginx) the request URL
 * the app sees is internal, so rebuild it from APP_URL + path + query.
 */
function publicUrl(req: NextRequest): string {
  const base = env.appUrl.replace(/\/$/, "");
  return `${base}${req.nextUrl.pathname}${req.nextUrl.search}`;
}

function headerObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => (out[k] = v));
  return out;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
