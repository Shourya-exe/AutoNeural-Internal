import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { z } from "zod";
import {
  statuses,
  priorities,
  type User,
  type Task,
  type Activity,
  type TaskAttachment,
  type RemovalRequest,
  type WorkspaceData,
} from "./types";

let connection: DatabaseSync | undefined;
export function db() {
  if (connection) return connection;
  const path = resolve(
    /* turbopackIgnore: true */ process.env.CRM_DATABASE_PATH ||
      "data/autoneural-crm.sqlite",
  );
  mkdirSync(dirname(path), { recursive: true });
  connection = new DatabaseSync(path);
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','employee')),password TEXT NOT NULL,mustChange INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(number INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,assigneeId TEXT NOT NULL REFERENCES users(id),createdBy TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,priority TEXT NOT NULL,dueDate TEXT NOT NULL,project TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,completedAt TEXT,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES tasks(id),actorId TEXT NOT NULL REFERENCES users(id),text TEXT NOT NULL,createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES tasks(id),actorId TEXT NOT NULL REFERENCES users(id),text TEXT NOT NULL,createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts(email TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS removal_requests(id TEXT PRIMARY KEY,employeeId TEXT NOT NULL REFERENCES users(id),requestedById TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,reason TEXT,createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_attachments(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES tasks(id),uploaderId TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,type TEXT NOT NULL,url TEXT NOT NULL,fileSize INTEGER,purpose TEXT NOT NULL,approvalStatus TEXT,reviewNote TEXT,createdAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(assigneeId,status,dueDate);
    CREATE INDEX IF NOT EXISTS events_task ON events(taskId,createdAt);
    CREATE INDEX IF NOT EXISTS comments_task ON comments(taskId,createdAt);
    CREATE INDEX IF NOT EXISTS attachments_task ON task_attachments(taskId,createdAt);`);
  try {
    connection.exec("ALTER TABLE users ADD COLUMN designation TEXT");
  } catch {}
  try {
    connection.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'ACTIVE'");
  } catch {}
  return connection;
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function transaction<T>(fn: () => T): T {
  db().exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db().exec("COMMIT");
    return result;
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
}
const timestamp = () => new Date().toISOString();
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}
export function verifyPassword(value: string, hash: string) {
  try {
    const [salt, expected] = hash.split(":");
    const a = Buffer.from(expected, "hex");
    const b = scryptSync(value, salt, 64);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
const publicUser = (u: Record<string, unknown>): User => ({
  id: String(u.id),
  name: String(u.name),
  email: String(u.email),
  role: u.role as User["role"],
  mustChange: !!u.mustChange,
  designation: u.designation ? String(u.designation) : undefined,
  status: (u.status as User["status"]) || "ACTIVE",
});
export function allUsers() {
  return db()
    .prepare(
      "SELECT id,name,email,role,mustChange,designation,status FROM users WHERE status IS NULL OR status != 'INACTIVE' ORDER BY role,name",
    )
    .all()
    .map(publicUser);
}
export function setupAccounts() {
  if (Number(db().prepare("SELECT COUNT(*) AS n FROM users").get()!.n))
    throw new AppError(
      409,
      "Accounts already exist. Setup will not overwrite passwords.",
    );
  return transaction(() =>
    [
      ["AutoNeural Admin", "info", "admin"],
      ["Manyu", "manyu", "employee"],
      ["Rajashi", "rajashi", "employee"],
      ["Shourya", "shourya", "employee"],
      ["Warrior Biswas", "warriorbiswas", "employee"],
    ].map(([name, local, role]) => {
      const password = randomBytes(15).toString("base64url");
      const email = `${local}@autoneural.in`;
      db()
        .prepare(
          "INSERT INTO users(id,name,email,role,password) VALUES(?,?,?,?,?)",
        )
        .run(randomUUID(), name, email, role, hashPassword(password));
      return { email, role, password };
    }),
  );
}
export function login(email: string, password: string) {
  email = email.toLowerCase().trim();
  const limited = transaction(() => {
    db().prepare("DELETE FROM attempts WHERE expires < ?").run(Date.now());
    db()
      .prepare(
        "INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET count=count+1",
      )
      .run(email, Date.now() + 15 * 60000);
    return (
      Number(
        db().prepare("SELECT count FROM attempts WHERE email=?").get(email)!
          .count,
      ) > 10
    );
  });
  if (limited)
    throw new AppError(
      429,
      "Too many attempts. Please try again in 15 minutes.",
    );
  const row = db().prepare("SELECT * FROM users WHERE email=?").get(email);
  const valid = verifyPassword(
    password,
    String(row?.password || `${"a".repeat(32)}:${"0".repeat(128)}`),
  );
  if (!row || !valid)
    throw new AppError(401, "Email or password is incorrect.");
  db().prepare("DELETE FROM attempts WHERE email=?").run(email);
  db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  const token = randomBytes(32).toString("base64url");
  db()
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(digest(token), String(row.id), Date.now() + 8 * 3600000);
  return { user: publicUser(row), token };
}
export function userForToken(token: string) {
  const u = db()
    .prepare(
      "SELECT u.* FROM users u JOIN sessions s ON u.id=s.userId WHERE s.token=? AND s.expires>?",
    )
    .get(digest(token), Date.now());
  return u ? publicUser(u) : null;
}
export function logout(token: string) {
  db().prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
}
export function changePassword(user: User, current: string, password: string) {
  const row = db()
    .prepare("SELECT password FROM users WHERE id=?")
    .get(user.id)!;
  if (!verifyPassword(current, String(row.password)))
    throw new AppError(400, "Current password is incorrect.");
  if (current === password)
    throw new AppError(400, "Choose a different password.");
  transaction(() => {
    db()
      .prepare("UPDATE users SET password=?,mustChange=0 WHERE id=?")
      .run(hashPassword(password), user.id);
    db().prepare("DELETE FROM sessions WHERE userId=?").run(user.id);
  });
}
export function requireAdmin(user: User) {
  if (user.role !== "admin")
    throw new AppError(403, "Only the administrator can do this.");
}
export function resetPassword(user: User, userId: string) {
  requireAdmin(user);
  if (user.id === userId)
    throw new AppError(
      400,
      "Use your account settings to change your own password.",
    );
  if (!allUsers().some((u) => u.id === userId))
    throw new AppError(404, "Employee not found.");
  const password = randomBytes(15).toString("base64url");
  transaction(() => {
    db()
      .prepare("UPDATE users SET password=?,mustChange=1 WHERE id=?")
      .run(hashPassword(password), userId);
    db().prepare("DELETE FROM sessions WHERE userId=?").run(userId);
  });
  return password;
}
const selectTask = `SELECT t.*, (SELECT COUNT(*) FROM comments c WHERE c.taskId=t.id) AS commentCount, (SELECT COUNT(*) FROM task_attachments a WHERE a.taskId=t.id) AS attachmentCount FROM tasks t`;
export function findTask(user: User, taskId: string) {
  const task = db().prepare(`${selectTask} WHERE t.id=?`).get(taskId) as unknown as
    Task | undefined;
  if (!task || (user.role !== "admin" && task.assigneeId !== user.id))
    throw new AppError(404, "Task not found.");
  return task;
}
function event(user: User, taskId: string, text: string) {
  db()
    .prepare("INSERT INTO events VALUES(?,?,?,?,?)")
    .run(randomUUID(), taskId, user.id, text, timestamp());
}
export const taskInput = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(6000).default(""),
  assigneeId: z.string().uuid(),
  status: z.enum(statuses).default("To do"),
  priority: z.enum(priorities).default("Medium"),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (s) =>
        !Number.isNaN(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s,
      "Choose a valid due date",
    ),
  project: z.string().trim().max(80).default(""),
});
export function createTask(user: User, input: unknown) {
  requireAdmin(user);
  const p = taskInput.parse(input);
  const target = allUsers().find((u) => u.id === p.assigneeId);
  if (!target || (target.role === "admin" && target.id === user.id)) {
    throw new AppError(400, "Choose an employee or another admin.");
  }
  return transaction(() => {
    const id = randomUUID(),
      time = timestamp();
    db()
      .prepare(
        "INSERT INTO tasks(id,title,description,assigneeId,createdBy,status,priority,dueDate,project,createdAt,updatedAt,completedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        p.title,
        p.description,
        p.assigneeId,
        user.id,
        p.status,
        p.priority,
        p.dueDate,
        p.project,
        time,
        time,
        p.status === "Completed" ? time : null,
      );
    event(
      user,
      id,
      `Created task and assigned it to ${target.name}.`,
    );

    const rawAtt = (input as { attachment?: { name?: string; type?: string; url?: string; fileSize?: number; purpose?: string } })?.attachment;
    if (rawAtt && (rawAtt.name || rawAtt.url)) {
      const attId = randomUUID();
      const attName = String(rawAtt.name || "Attachment").trim();
      const attType = rawAtt.type === "LINK" ? "LINK" : (rawAtt.type || "DOCUMENT");
      const attUrl = String(rawAtt.url || "#").trim();
      const attSize = Number(rawAtt.fileSize) || 0;
      const attPurpose = rawAtt.purpose || "REFERENCE";
      db()
        .prepare(
          "INSERT INTO task_attachments(id,taskId,uploaderId,name,type,url,fileSize,purpose,approvalStatus,reviewNote,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(attId, id, user.id, attName, attType, attUrl, attSize, attPurpose, null, null, time);
      event(user, id, `Attached ${attType.toLowerCase()}: "${attName}".`);
    }

    return findTask(user, id);
  });
}
export function updateTask(user: User, input: unknown) {
  const raw = z
    .object({ id: z.string().uuid(), version: z.number().int().positive() })
    .passthrough()
    .parse(input);
  return transaction(() => {
    const task = findTask(user, raw.id);
    if (task.version !== raw.version)
      throw new AppError(
        409,
        "This task was updated by someone else. Refresh and try again.",
      );
    let next: z.infer<typeof taskInput>;
    if (user.role === "admin") {
      next = taskInput.parse(raw);
      const target = allUsers().find((u) => u.id === next.assigneeId);
      if (!target || (target.role === "admin" && target.id === user.id)) {
        throw new AppError(400, "Choose an employee or another admin.");
      }
    } else {
      const p = z
        .object({
          id: z.string(),
          version: z.number(),
          status: z.enum(statuses),
        })
        .strict()
        .parse(raw);
      next = { ...task, status: p.status };
    }
    const time = timestamp();
    db()
      .prepare(
        "UPDATE tasks SET title=?,description=?,assigneeId=?,status=?,priority=?,dueDate=?,project=?,updatedAt=?,completedAt=?,version=version+1 WHERE id=?",
      )
      .run(
        next.title,
        next.description,
        next.assigneeId,
        next.status,
        next.priority,
        next.dueDate,
        next.project,
        time,
        next.status === "Completed" ? task.completedAt || time : null,
        task.id,
      );
    const changes = [];
    if (task.status !== next.status)
      changes.push(`Changed status from ${task.status} to ${next.status}.`);
    if (task.assigneeId !== next.assigneeId)
      changes.push(
        `Reassigned to ${allUsers().find((u) => u.id === next.assigneeId)!.name}.`,
      );
    if (
      ["title", "description", "priority", "dueDate", "project"].some(
        (k) => task[k as keyof Task] !== next[k as keyof typeof next],
      )
    )
      changes.push("Updated task details.");
    if (changes.length) event(user, task.id, changes.join(" "));
    return findTask(user, task.id);
  });
}
export function addComment(user: User, taskId: string, text: string) {
  text = z.string().trim().min(1).max(3000).parse(text);
  return transaction(() => {
    findTask(user, taskId);
    db()
      .prepare("INSERT INTO comments VALUES(?,?,?,?,?)")
      .run(randomUUID(), taskId, user.id, text, timestamp());
    event(user, taskId, "Added a comment.");
  });
}
export function taskDetails(user: User, taskId: string) {
  const task = findTask(user, taskId);
  const query = (table: string) =>
    db()
      .prepare(
        `SELECT e.id,e.taskId,e.text,e.createdAt,u.name AS actorName FROM ${table} e JOIN users u ON u.id=e.actorId WHERE e.taskId=? ORDER BY e.createdAt ASC`,
      )
      .all(taskId) as unknown as Activity[];
  const attachments = db()
    .prepare(
      `SELECT a.id,a.taskId,a.uploaderId,a.name,a.type,a.url,a.fileSize,a.purpose,a.approvalStatus,a.reviewNote,a.createdAt,u.name AS uploaderName FROM task_attachments a JOIN users u ON u.id=a.uploaderId WHERE a.taskId=? ORDER BY a.createdAt DESC`,
    )
    .all(taskId) as unknown as TaskAttachment[];
  return { task, comments: query("comments"), activity: query("events"), attachments };
}
export function allRemovalRequests(): RemovalRequest[] {
  try {
    return db()
      .prepare(
        `SELECT r.id,r.employeeId,r.requestedById,r.status,r.reason,r.createdAt,u.name AS requestedByName FROM removal_requests r JOIN users u ON u.id=r.requestedById WHERE r.status='PENDING' ORDER BY r.createdAt DESC`,
      )
      .all() as unknown as RemovalRequest[];
  } catch {
    return [];
  }
}
export function createEmployee(
  adminUser: User,
  input: { name: string; email: string; role?: "admin" | "employee"; designation?: string },
) {
  requireAdmin(adminUser);
  const name = z.string().trim().min(2).max(80).parse(input.name);
  const email = z.string().trim().email().toLowerCase().parse(input.email);
  const role = input.role === "admin" ? "admin" : "employee";
  const designation = input.designation ? z.string().trim().max(100).parse(input.designation) : null;

  const existing = db().prepare("SELECT id FROM users WHERE email=?").get(email);
  if (existing) {
    throw new AppError(409, `An employee with email ${email} already exists.`);
  }

  const id = randomUUID();
  const rawPassword = randomBytes(15).toString("base64url");
  db()
    .prepare(
      "INSERT INTO users(id,name,email,role,password,mustChange,designation,status) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(id, name, email, role, hashPassword(rawPassword), 1, designation, "ACTIVE");

  return { id, name, email, role, designation, initialPassword: rawPassword };
}
export function requestRemoval(adminUser: User, employeeId: string, reason?: string) {
  requireAdmin(adminUser);
  if (adminUser.id === employeeId) {
    throw new AppError(400, "You cannot request removal of your own account.");
  }
  const emp = db().prepare("SELECT id,name FROM users WHERE id=?").get(employeeId) as { id: string; name: string } | undefined;
  if (!emp) throw new AppError(404, "Employee not found.");

  const pending = db().prepare("SELECT id FROM removal_requests WHERE employeeId=? AND status='PENDING'").get(employeeId);
  if (pending) throw new AppError(409, "A removal request for this employee is already pending review.");

  const id = randomUUID();
  const time = timestamp();
  db()
    .prepare("INSERT INTO removal_requests(id,employeeId,requestedById,status,reason,createdAt) VALUES(?,?,?,?,?,?)")
    .run(id, employeeId, adminUser.id, "PENDING", reason?.trim() || null, time);

  return { id, employeeId, requestedById: adminUser.id, status: "PENDING" };
}
export function approveRemoval(adminUser: User, requestId: string) {
  requireAdmin(adminUser);
  const req = db().prepare("SELECT * FROM removal_requests WHERE id=?").get(requestId) as any;
  if (!req) throw new AppError(404, "Removal request not found.");
  if (req.status !== "PENDING") throw new AppError(400, "Request is no longer pending.");

  if (req.requestedById === adminUser.id) {
    throw new AppError(403, "Dual-authorization required: Another admin account must review and approve this removal request.");
  }

  return transaction(() => {
    db().prepare("UPDATE removal_requests SET status='APPROVED' WHERE id=?").run(requestId);
    db().prepare("UPDATE users SET status='INACTIVE' WHERE id=?").run(req.employeeId);
    db().prepare("DELETE FROM sessions WHERE userId=?").run(req.employeeId);
    return { ok: true, message: "Employee removed and sessions revoked." };
  });
}
export function rejectRemoval(adminUser: User, requestId: string) {
  requireAdmin(adminUser);
  const req = db().prepare("SELECT * FROM removal_requests WHERE id=?").get(requestId) as any;
  if (!req) throw new AppError(404, "Removal request not found.");
  if (req.status !== "PENDING") throw new AppError(400, "Request is no longer pending.");

  db().prepare("UPDATE removal_requests SET status='REJECTED' WHERE id=?").run(requestId);
  return { ok: true, message: "Removal request rejected." };
}
export function attachTaskLink(
  user: User,
  taskId: string,
  input: { name: string; url: string; purpose?: "REFERENCE" | "OUTPUT" | "FOR_APPROVAL" },
) {
  findTask(user, taskId);
  const name = z.string().trim().min(1).max(180).parse(input.name);
  const url = z.string().trim().url().parse(input.url);
  const purpose = input.purpose || (user.role === "admin" ? "REFERENCE" : "OUTPUT");
  const isApproval = purpose === "FOR_APPROVAL";

  return transaction(() => {
    const id = randomUUID();
    const time = timestamp();
    db()
      .prepare(
        "INSERT INTO task_attachments(id,taskId,uploaderId,name,type,url,fileSize,purpose,approvalStatus,reviewNote,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(id, taskId, user.id, name, "LINK", url, null, purpose, isApproval ? "PENDING" : null, null, time);

    if (isApproval) {
      db().prepare("UPDATE tasks SET status='In review' WHERE id=?").run(taskId);
      event(user, taskId, `Submitted link for approval: "${name}".`);
    } else {
      event(user, taskId, `Attached link: "${name}".`);
    }
    return { ok: true, id };
  });
}
export function attachTaskFile(
  user: User,
  taskId: string,
  input: { name: string; type?: "FILE" | "DOCUMENT"; url: string; fileSize?: number; purpose?: "REFERENCE" | "OUTPUT" | "FOR_APPROVAL" },
) {
  findTask(user, taskId);
  const name = z.string().trim().min(1).max(180).parse(input.name);
  const type = input.type || "FILE";
  const url = input.url || "#";
  const purpose = input.purpose || (user.role === "admin" ? "REFERENCE" : "OUTPUT");
  const isApproval = purpose === "FOR_APPROVAL";

  return transaction(() => {
    const id = randomUUID();
    const time = timestamp();
    db()
      .prepare(
        "INSERT INTO task_attachments(id,taskId,uploaderId,name,type,url,fileSize,purpose,approvalStatus,reviewNote,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(id, taskId, user.id, name, type, url, input.fileSize || 0, purpose, isApproval ? "PENDING" : null, null, time);

    if (isApproval) {
      db().prepare("UPDATE tasks SET status='In review' WHERE id=?").run(taskId);
      event(user, taskId, `Uploaded deliverable for approval: "${name}".`);
    } else {
      event(user, taskId, `Uploaded ${type.toLowerCase()}: "${name}".`);
    }
    return { ok: true, id };
  });
}
export function approveTaskSubmission(user: User, attachmentId: string, note?: string) {
  requireAdmin(user);
  const att = db().prepare("SELECT * FROM task_attachments WHERE id=?").get(attachmentId) as any;
  if (!att) throw new AppError(404, "Attachment not found.");
  if (att.purpose !== "FOR_APPROVAL") throw new AppError(400, "Only submissions for approval can be reviewed.");

  return transaction(() => {
    db()
      .prepare("UPDATE task_attachments SET approvalStatus='APPROVED', reviewNote=? WHERE id=?")
      .run(note?.trim() || null, attachmentId);
    event(user, att.taskId, `Approved deliverable: "${att.name}"${note ? ` ("${note}")` : ""}.`);
    return { ok: true };
  });
}
export function rejectTaskSubmission(user: User, attachmentId: string, note?: string) {
  requireAdmin(user);
  const att = db().prepare("SELECT * FROM task_attachments WHERE id=?").get(attachmentId) as any;
  if (!att) throw new AppError(404, "Attachment not found.");
  if (att.purpose !== "FOR_APPROVAL") throw new AppError(400, "Only submissions for approval can be reviewed.");

  return transaction(() => {
    db()
      .prepare("UPDATE task_attachments SET approvalStatus='REJECTED', reviewNote=? WHERE id=?")
      .run(note?.trim() || null, attachmentId);
    event(user, att.taskId, `Requested changes on deliverable "${att.name}"${note ? `: "${note}"` : ""}.`);
    return { ok: true };
  });
}
export function deleteTaskAttachment(user: User, attachmentId: string) {
  const att = db().prepare("SELECT * FROM task_attachments WHERE id=?").get(attachmentId) as any;
  if (!att) throw new AppError(404, "Attachment not found.");
  if (user.role !== "admin" && att.uploaderId !== user.id) {
    throw new AppError(403, "You do not have permission to delete this attachment.");
  }
  return transaction(() => {
    db().prepare("DELETE FROM task_attachments WHERE id=?").run(attachmentId);
    event(user, att.taskId, `Removed ${att.type.toLowerCase()}: "${att.name}".`);
    return { ok: true };
  });
}
export function workspace(user: User): WorkspaceData {
  const admin = user.role === "admin";
  const tasks = db()
    .prepare(
      `${selectTask} ${admin ? "" : "WHERE t.assigneeId=?"} ORDER BY t.createdAt DESC,t.number DESC`,
    )
    .all(...(admin ? [] : [user.id])) as unknown as Task[];
  const activity = db()
    .prepare(
      `SELECT e.id,e.taskId,e.text,e.createdAt,u.name AS actorName FROM events e JOIN users u ON u.id=e.actorId JOIN tasks t ON t.id=e.taskId ${admin ? "" : "WHERE t.assigneeId=?"} ORDER BY e.createdAt DESC,e.rowid DESC LIMIT 30`,
    )
    .all(...(admin ? [] : [user.id])) as unknown as Activity[];
  return {
    user,
    team: admin ? allUsers() : allUsers().filter((u) => u.id === user.id),
    tasks,
    activity,
    removalRequests: admin ? allRemovalRequests() : [],
  };
}

