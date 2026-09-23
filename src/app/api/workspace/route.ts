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
  deleteTask,
  requireAdmin,
  getEmailThread,
  getEmailsForUser,
  unreadEmailCount,
  sendUserEmail,
  replyToEmail,
  markEmailSeen,
  recordInboundEmail,
  AppError,
} from "@/lib/store";
import { sendTestEmail } from "@/lib/email";
import { body, failure, requireUser, sameOrigin } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = await requireUser();
    const url = new URL(req.url);
    const id = url.searchParams.get("task");
    const threadId = url.searchParams.get("thread");
    const mailFolder = url.searchParams.get("mailFolder") as "inbox" | "sent" | "all" | null;

    if (id) {
      return Response.json(taskDetails(u, id), { headers: { "Cache-Control": "no-store" } });
    }
    if (threadId) {
      return Response.json({ thread: getEmailThread(u, threadId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (mailFolder) {
      return Response.json(
        { emails: getEmailsForUser(u, mailFolder, 100), unread: unreadEmailCount(u) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(workspace(u), {
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
      case "deleteTask":
        return Response.json(deleteTask(u, z.string().uuid().parse(p.taskId)));
      case "testEmail":
        requireAdmin(u);
        const targetEmail = z.string().trim().email().parse(p.email || u.email);
        const emailResult = await sendTestEmail(targetEmail);
        return Response.json(emailResult);
      case "sendUserEmail": {
        const payload = p.email || p;
        return Response.json(
          await sendUserEmail(u, {
            to: payload.to,
            subject: payload.subject,
            body: payload.body || payload.text,
            text: payload.text || payload.body,
            taskId: payload.taskId,
          }),
          { status: 201 },
        );
      }
      case "replyEmail":
        return Response.json(
          await replyToEmail(u, z.string().parse(p.emailId), z.string().parse(p.text)),
          { status: 201 },
        );
      case "markEmailSeen":
        return Response.json(
          markEmailSeen(u, z.string().parse(p.emailId), p.status || "read"),
        );
      case "simulateInbound":
        return Response.json(recordInboundEmail(p), { status: 201 });
      default:
        throw new AppError(400, "Unknown action.");
    }
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    sameOrigin(req);
    const u = await requireUser();
    const url = new URL(req.url);
    const taskId = url.searchParams.get("task") || url.searchParams.get("taskId");
    if (!taskId) throw new AppError(400, "Task ID is required.");
    return Response.json(deleteTask(u, z.string().uuid().parse(taskId)));
  } catch (e) {
    return failure(e);
  }
}
