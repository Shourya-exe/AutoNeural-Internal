import { z } from "zod";
import { AppError, attachTaskFile, findTask } from "@/lib/store";
import { failure, requireUser, sameOrigin } from "@/lib/http";
import { maxUploadBytes } from "@/lib/config";
import { removeStoredFile, saveUpload, type StoredFile } from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload a file to a task.
 *   POST multipart/form-data: taskId, file, name (optional display name), purpose (REFERENCE | OUTPUT | FOR_APPROVAL)
 * Anyone who can open the task can attach to it.
 */
export async function POST(req: Request) {
  let stored: StoredFile | null = null;
  try {
    sameOrigin(req);
    const user = await requireUser();
    if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data"))
      throw new AppError(415, "Upload the file as multipart/form-data.");
    // Reject oversized uploads before reading them (multipart adds a little overhead).
    if (Number(req.headers.get("content-length") ?? 0) > maxUploadBytes() + 256 * 1024)
      throw new AppError(413, `Files can be up to ${Math.round(maxUploadBytes() / 1024 / 1024)} MB.`);
    const form = await req.formData().catch(() => {
      throw new AppError(400, "The upload could not be read. Try again.");
    });
    const taskId = z.string().uuid("Choose a task.").parse(form.get("taskId"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError(400, "Choose a file to upload.");
    findTask(user, taskId); // access check before anything touches the disk
    stored = await saveUpload(file);
    const result = attachTaskFile(user, taskId, stored, {
      name: form.get("name") ?? undefined,
      purpose: form.get("purpose") ?? undefined,
    });
    stored = null;
    return Response.json(result, { status: 201 });
  } catch (e) {
    if (stored) removeStoredFile(stored.key);
    return failure(e);
  }
}
