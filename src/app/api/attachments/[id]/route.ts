import { z } from "zod";
import { attachmentFile } from "@/lib/store";
import { failure, requireUser } from "@/lib/http";
import { downloadHeaders, readStoredFile } from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download a task file. Access follows the task; `?download=1` forces a save dialog. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const file = attachmentFile(user, z.string().uuid("Attachment not found.").parse(id));
    const { size, body } = readStoredFile(file.key);
    const inline = new URL(req.url).searchParams.get("download") !== "1";
    return new Response(body, { headers: downloadHeaders({ name: file.name, mime: file.mime, size }, inline) });
  } catch (e) {
    return failure(e);
  }
}
