import { z } from "zod";
import {
  workspace,
  taskDetails,
  createTask,
  updateTask,
  addComment,
  resetPassword,
  createEmployee,
  requestRemoval,
  approveRemoval,
  rejectRemoval,
  attachTaskLink,
  attachTaskFile,
  approveTaskSubmission,
  rejectTaskSubmission,
  deleteTaskAttachment,
  AppError,
} from "@/lib/store";
import { body, failure, requireUser, sameOrigin } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = await requireUser();
    const id = new URL(req.url).searchParams.get("task");
    return Response.json(id ? taskDetails(u, id) : workspace(u), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const u = await requireUser();
    const p = await body(req);
    switch (p.action) {
      case "create":
        return Response.json(createTask(u, p.task), { status: 201 });
      case "update":
        return Response.json(updateTask(u, p.task));
      case "comment":
        addComment(u, z.string().uuid().parse(p.taskId), p.text);
        return Response.json({ ok: true });
      case "resetPassword":
        return Response.json({
          password: resetPassword(u, z.string().uuid().parse(p.userId)),
        });
      case "createEmployee":
        return Response.json(createEmployee(u, p.employee), { status: 201 });
      case "requestRemoval":
        return Response.json(requestRemoval(u, z.string().uuid().parse(p.employeeId), p.reason));
      case "approveRemoval":
        return Response.json(approveRemoval(u, z.string().uuid().parse(p.requestId)));
      case "rejectRemoval":
        return Response.json(rejectRemoval(u, z.string().uuid().parse(p.requestId)));
      case "attachLink":
        return Response.json(attachTaskLink(u, z.string().uuid().parse(p.taskId), p));
      case "attachFile":
        return Response.json(attachTaskFile(u, z.string().uuid().parse(p.taskId), p));
      case "approveSubmission":
        return Response.json(approveTaskSubmission(u, z.string().uuid().parse(p.attachmentId), p.note));
      case "rejectSubmission":
        return Response.json(rejectTaskSubmission(u, z.string().uuid().parse(p.attachmentId), p.note));
      case "deleteAttachment":
        return Response.json(deleteTaskAttachment(u, z.string().uuid().parse(p.attachmentId)));
      default:
        throw new AppError(400, "Unknown action.");
    }
  } catch (e) {
    return failure(e);
  }
}
