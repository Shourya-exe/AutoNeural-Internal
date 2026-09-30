import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getActor } from "@/server/auth/context";
import { writeAudit } from "@/server/services/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), ".uploads");

/**
 * Access-controlled attachment download.
 *
 * Files are stored OUTSIDE the public directory and are only served after the
 * caller is authenticated AND the attachment belongs to their organization.
 * There is no public URL for an attachment.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const attachment = await prisma.attachment.findFirst({
    where: { id, organizationId: actor.organizationId },
  });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // storageKey is a relative key; resolve and confirm it stays under UPLOAD_ROOT.
  const resolved = path.resolve(UPLOAD_ROOT, attachment.storageKey);
  if (!resolved.startsWith(path.resolve(UPLOAD_ROOT))) {
    return NextResponse.json({ error: "Invalid storage key" }, { status: 400 });
  }

  let data: Buffer;
  try {
    data = await fs.readFile(resolved);
  } catch {
    return NextResponse.json({ error: "File is no longer available" }, { status: 410 });
  }

  await writeAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    action: "attachment.download",
    entityType: "Attachment",
    entityId: id,
  });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
