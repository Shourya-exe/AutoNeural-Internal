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
  AppError,
} from "@/lib/store";
import { sendTestEmail } from "@/lib/email";
import { approvePasswordReset, cancelPendingResets, listPasswordResets, rejectPasswordReset } from "@/lib/password-reset";
import { body, failure, requireUser, sameOrigin } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = await requireUser();
    const url = new URL(req.url);
    const id = url.searchParams.get("task");
    const threadId = url.searchParams.get("thread");
    const mailFolder = url.searchParams.get("mailFolder");

    if (id) {
      return Response.json(taskDetails(u, z.string().uuid("Task not found.").parse(id)), { headers: { "Cache-Control": "no-store" } });
    }
    if (threadId) {
      return Response.json({ thread: getEmailThread(u, z.string().max(200).parse(threadId)) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (mailFolder) {
      return Response.json(
        { emails: getEmailsForUser(u, z.enum(["inbox", "sent", "all"]).parse(mailFolder), 100), unread: unreadEmailCount(u) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      { ...workspace(u), passwordResets: u.role === "admin" ? listPasswordResets(u) : [] },
      { headers: { "Cache-Control": "no-store" } },
    );
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
      case "resetPassword": {
        const userId = z.string().uuid().parse(p.userId);
        const password = resetPassword(u, userId);
        cancelPendingResets(userId, "reset-by-admin");
        return Response.json({ password });
      }
      case "approvePasswordReset":
        return Response.json(await approvePasswordReset(u, z.string().parse(p.requestId)));
      case "rejectPasswordReset":
        return Response.json(rejectPasswordReset(u, z.string().parse(p.requestId)));
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
      // Files are uploaded as multipart/form-data to POST /api/attachments.
      case "approveSubmission":
        return Response.json(approveTaskSubmission(u, z.string().uuid().parse(p.attachmentId), p.note));
      case "rejectSubmission":
        return Response.json(rejectTaskSubmission(u, z.string().uuid().parse(p.attachmentId), p.note));
      case "deleteAttachment":
        return Response.json(deleteTaskAttachment(u, z.string().uuid().parse(p.attachmentId)));
      case "deleteTask":
        return Response.json(deleteTask(u, z.string().uuid().parse(p.taskId)));
      case "testEmail": {
        requireAdmin(u);
        const targetEmail = z.string().trim().email().parse(p.email || u.email);
        const emailResult = await sendTestEmail(targetEmail);
        if (!emailResult.success)
          throw new AppError(emailResult.notConfigured ? 503 : 502, emailResult.notConfigured ? "No email provider is configured, so nothing was sent." : `The test email failed: ${emailResult.error}`);
        return Response.json(emailResult);
      }
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
          markEmailSeen(u, z.string().max(64).parse(p.emailId), typeof p.seen === "boolean" ? (p.seen ? "read" : "unread") : p.status || "read"),
        );
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
