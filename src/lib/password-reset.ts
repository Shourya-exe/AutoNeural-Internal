import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, allUsers, db, getUserById, requireAdmin, resetPassword } from "./store";
import { MASTER_ADMIN_EMAIL, isMasterAdmin, type PasswordResetRequest, type User } from "./types";
import { getAppBaseUrl, renderResetRequestedEmail, renderTemporaryPasswordEmail, sendEmail } from "./email";
import { audit } from "./platform";

/**
 * "Forgot password" with admin approval.
 *
 * Anyone can ask from the sign-in page; the answer never reveals whether the account exists,
 * and nothing changes until an admin approves. Approval sets a temporary password (changed at
 * first sign-in), signs out every session, and emails it to the account owner — never to whoever
 * asked. Employees' requests can be approved by any admin; another admin's only by the master
 * admin (the same rule as a direct reset). Nobody approves their own. The master admin's own
 * password is recovered on the server with CRM_MASTER_ADMIN_RESET_PASSWORD.
 */

let ready = false;
function rdb() {
  const c = db();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS password_resets(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),requestedAt TEXT NOT NULL,ip TEXT,userAgent TEXT,reviewedBy TEXT REFERENCES users(id),reviewedAt TEXT,delivery TEXT);
      CREATE INDEX IF NOT EXISTS password_resets_pending ON password_resets(status, requestedAt);`);
    ready = true;
  }
  return c;
}

export const RESET_REQUESTED_MESSAGE =
  "If this email belongs to an active account, an administrator has been asked to approve a password reset. Once approved, you will get a temporary password by email or from your administrator.";

const HOUR = 3_600_000;
/** Fixed-window counter in the shared attempts table; true once the limit is exceeded. */
function overLimit(key: string, limit: number) {
  const c = db();
  const now = Date.now();
  c.prepare("DELETE FROM attempts WHERE expires < ?").run(now);
  c.prepare("INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET count=count+1").run(key, now + HOUR);
  return Number((c.prepare("SELECT count FROM attempts WHERE email=?").get(key) as { count: number }).count) > limit;
}

/** Whether `admin` may approve a reset of `target`'s password. */
export function canApproveReset(admin: User, target: Pick<User, "id" | "email" | "role">) {
  return admin.role === "admin" && admin.id !== target.id && !isMasterAdmin(target) && (target.role !== "admin" || isMasterAdmin(admin));
}

export function requestPasswordReset(email: unknown, context: { ip?: string; userAgent?: string } = {}) {
  const address = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254).parse(email);
  if (context.ip && context.ip !== "unknown" && overLimit(`reset-ip:${context.ip}`, 10))
    throw new AppError(429, "Too many requests. Please try again in an hour.");
  // Per-account limit is silent so the response stays identical for every address.
  if (overLimit(`reset:${address}`, 3)) return { ok: true, message: RESET_REQUESTED_MESSAGE };
  const user = allUsers().find((u) => u.email.toLowerCase() === address);
  if (!user) return { ok: true, message: RESET_REQUESTED_MESSAGE };
  if (isMasterAdmin(user)) {
    console.warn(`[auth] Password reset requested for the master admin (${MASTER_ADMIN_EMAIL}). Recover it on the server with CRM_MASTER_ADMIN_RESET_PASSWORD.`);
    audit("sign-in page", "password_reset.requested_master", "user", user.id, { ip: context.ip ?? null });
    return { ok: true, message: RESET_REQUESTED_MESSAGE };
  }
  const c = rdb();
  if (!c.prepare("SELECT 1 FROM password_resets WHERE userId=? AND status='PENDING'").get(user.id)) {
    c.prepare("INSERT INTO password_resets(id,userId,status,requestedAt,ip,userAgent) VALUES(?,?,'PENDING',?,?,?)").run(
      randomUUID(),
      user.id,
      new Date().toISOString(),
      context.ip ?? null,
      context.userAgent?.slice(0, 300) ?? null,
    );
    audit("sign-in page", "password_reset.requested", "user", user.id, { ip: context.ip ?? null });
    const approvers = allUsers().filter((a) => canApproveReset(a, user));
    const mail = renderResetRequestedEmail({ name: user.name, email: user.email, appUrl: getAppBaseUrl() });
    for (const a of approvers)
      void sendEmail({ to: a.email, ...mail }).catch((e) => console.error("[auth] reset notification failed", e));
  }
  return { ok: true, message: RESET_REQUESTED_MESSAGE };
}

export function listPasswordResets(admin: User): PasswordResetRequest[] {
  requireAdmin(admin);
  const rows = rdb()
    .prepare(
      "SELECT r.id, r.userId, r.requestedAt, r.ip, u.name, u.email, u.role FROM password_resets r JOIN users u ON u.id=r.userId WHERE r.status='PENDING' AND (u.status IS NULL OR u.status!='INACTIVE') ORDER BY r.requestedAt",
    )
    .all() as Omit<PasswordResetRequest, "canApprove">[];
  return rows.map((r) => ({ ...r, canApprove: canApproveReset(admin, { id: r.userId, email: r.email, role: r.role }) }));
}

function pendingRequest(id: string) {
  const r = rdb().prepare("SELECT * FROM password_resets WHERE id=?").get(z.string().uuid().parse(id)) as
    | { id: string; userId: string; status: string }
    | undefined;
  if (!r) throw new AppError(404, "Reset request not found.");
  if (r.status !== "PENDING") throw new AppError(409, "This reset request has already been handled.");
  const target = getUserById(r.userId);
  if (!target || target.status === "INACTIVE") throw new AppError(409, "This account is no longer active.");
  return { r, target };
}

const approvalError = (target: User) =>
  new AppError(403, target.role === "admin" ? "Only the master admin can approve a reset for an administrator." : "You cannot approve this request.");

export async function approvePasswordReset(admin: User, id: string) {
  requireAdmin(admin);
  const { r, target } = pendingRequest(id);
  if (!canApproveReset(admin, target)) throw approvalError(target);
  // Claim the request first so two admins approving at once cannot both reset it.
  const claimed = rdb()
    .prepare("UPDATE password_resets SET status='APPROVED', reviewedBy=?, reviewedAt=? WHERE id=? AND status='PENDING'")
    .run(admin.id, new Date().toISOString(), r.id).changes;
  if (!Number(claimed)) throw new AppError(409, "This reset request has already been handled.");
  let password: string;
  try {
    password = resetPassword(admin, target.id); // temporary, must change at sign-in; signs out every session
  } catch (e) {
    rdb().prepare("UPDATE password_resets SET status='PENDING', reviewedBy=NULL, reviewedAt=NULL WHERE id=?").run(r.id);
    throw e;
  }
  const mail = await sendEmail({ to: target.email, ...renderTemporaryPasswordEmail({ name: target.name, password, appUrl: getAppBaseUrl() }) });
  const emailed = mail.success && !mail.simulated;
  rdb().prepare("UPDATE password_resets SET delivery=? WHERE id=?").run(emailed ? "email" : "admin", r.id);
  audit(admin.name, "password_reset.approved", "user", target.id, { delivery: emailed ? "email" : "admin" });
  // Show the password only when it could not be emailed to its owner.
  return { ok: true, name: target.name, email: target.email, emailed, ...(emailed ? {} : { password }) };
}

export function rejectPasswordReset(admin: User, id: string) {
  requireAdmin(admin);
  const { r, target } = pendingRequest(id);
  if (!canApproveReset(admin, target)) throw approvalError(target);
  rdb().prepare("UPDATE password_resets SET status='REJECTED', reviewedBy=?, reviewedAt=? WHERE id=? AND status='PENDING'").run(admin.id, new Date().toISOString(), r.id);
  audit(admin.name, "password_reset.rejected", "user", target.id);
  return { ok: true };
}

/** The person signed in or was reset directly, so an open request is no longer needed. */
export function cancelPendingResets(userId: string, reason: "signed-in" | "reset-by-admin") {
  rdb().prepare("UPDATE password_resets SET status='CANCELLED', reviewedAt=?, delivery=? WHERE userId=? AND status='PENDING'").run(new Date().toISOString(), reason, userId);
}
