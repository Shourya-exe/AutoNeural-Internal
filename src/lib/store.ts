import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { z } from "zod";
import { databasePath, isProduction, maxUploadBytes } from "./config";
import { AppError } from "./errors";
import { removeStoredFile, type StoredFile } from "./files";
import {
  statuses,
  priorities,
  type User,
  type Task,
  type Activity,
  type TaskAttachment,
  type RemovalRequest,
  type WorkspaceData,
  type AuthLog,
  type EmailMessage,
  MASTER_ADMIN_EMAIL,
  isMasterAdmin,
} from "./types";
import {
  notifyTaskAssigned,
  notifyTaskCompleted,
  notifyTaskComment,
  getEmailServiceStatus,
  sendEmail,
  renderDirectEmail,
  getAppBaseUrl,
} from "./email";

export { AppError };

let connection: DatabaseSync | undefined;
export function db() {
  if (connection) return connection;
  const path = databasePath();
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
    CREATE TABLE IF NOT EXISTS auth_logs(id TEXT PRIMARY KEY,userId TEXT,name TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('LOGIN','LOGOUT')),ip TEXT,userAgent TEXT,timestamp TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS emails(id TEXT PRIMARY KEY,threadId TEXT NOT NULL,senderId TEXT REFERENCES users(id),senderName TEXT NOT NULL,senderEmail TEXT NOT NULL,recipientId TEXT REFERENCES users(id),recipientEmail TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'unread',direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')),inReplyTo TEXT,taskId TEXT REFERENCES tasks(id),createdAt TEXT NOT NULL,seenAt TEXT);
    CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(assigneeId,status,dueDate);
    CREATE INDEX IF NOT EXISTS events_task ON events(taskId,createdAt);
    CREATE INDEX IF NOT EXISTS comments_task ON comments(taskId,createdAt);
    CREATE INDEX IF NOT EXISTS attachments_task ON task_attachments(taskId,createdAt);
    CREATE INDEX IF NOT EXISTS auth_logs_time ON auth_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS emails_inbox ON emails(recipientEmail, direction, status);
    CREATE INDEX IF NOT EXISTS emails_sent ON emails(senderEmail, direction);
    CREATE INDEX IF NOT EXISTS emails_thread ON emails(threadId, createdAt ASC);
    CREATE INDEX IF NOT EXISTS emails_time ON emails(createdAt DESC);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(userId);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  for (const col of [
    "users ADD COLUMN designation TEXT",
    "users ADD COLUMN status TEXT DEFAULT 'ACTIVE'",
    // Uploaded files: where the bytes live on disk (see lib/files.ts) and their content type.
    "task_attachments ADD COLUMN storageKey TEXT",
    "task_attachments ADD COLUMN mimeType TEXT",
  ]) {
    try {
      connection.exec(`ALTER TABLE ${col}`);
    } catch {}
  }

  bootstrapMasterAdmin(connection);
  recoverMasterAdmin(connection);

  // One-time data migrations, recorded so they never re-run.
  connection.exec("CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)");
  const once = (name: string, sql: string) => {
    if (connection!.prepare("SELECT 1 FROM migrations WHERE name=?").get(name)) return;
    connection!.exec(sql);
    connection!.prepare("INSERT INTO migrations VALUES(?,?)").run(name, new Date().toISOString());
  };
  // Shourya Kumar stays a team member but is no longer an administrator.
  once(
    "2026-09-25-demote-shourya",
    "UPDATE users SET role='employee' WHERE email='shourya@autoneural.in' AND role='admin'",
  );
  // The master admin can never be demoted or deactivated, even by direct edits.
  connection
    .prepare("UPDATE users SET role='admin', status='ACTIVE' WHERE email=?")
    .run(MASTER_ADMIN_EMAIL);

  return connection;
}

/**
 * A new, empty database has no way in. The master admin is created from
 * CRM_ADMIN_BOOTSTRAP_PASSWORD (a temporary password that must be changed at first
 * sign-in), or with `npm run setup`. Nothing is created without an explicit password.
 */
function bootstrapMasterAdmin(c: DatabaseSync) {
  const count = Number((c.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n);
  if (count > 0) return;
  const password = process.env.CRM_ADMIN_BOOTSTRAP_PASSWORD ?? "";
  if (password.length < 12) {
    if (isProduction())
      console.warn(
        `[setup] The workspace has no accounts. Set CRM_ADMIN_BOOTSTRAP_PASSWORD (12+ characters) and restart, then sign in as ${MASTER_ADMIN_EMAIL} and choose a new password.`,
      );
    return;
  }
  c.prepare(
    "INSERT INTO users(id,name,email,role,password,mustChange,designation,status) VALUES(?,?,?,?,?,1,?,'ACTIVE')",
  ).run(randomUUID(), "AutoNeural Admin", MASTER_ADMIN_EMAIL, "admin", hashPassword(password), "System Administrator");
  console.log(
    `[setup] Created the master admin ${MASTER_ADMIN_EMAIL}. Sign in with CRM_ADMIN_BOOTSTRAP_PASSWORD, choose a new password, then remove that variable.`,
  );
}

/**
 * Master admin recovery. Nobody can approve the master admin's reset inside the app, so set
 * CRM_MASTER_ADMIN_RESET_PASSWORD (12+ characters) and restart: it becomes a temporary password
 * that must be changed at sign-in. Each value is applied once, so a forgotten variable cannot keep
 * resetting the password on every restart; remove it after signing in.
 */
export function recoverMasterAdmin(c: DatabaseSync) {
  const password = process.env.CRM_MASTER_ADMIN_RESET_PASSWORD ?? "";
  if (!password) return;
  if (password.length < 12) {
    console.warn("[setup] CRM_MASTER_ADMIN_RESET_PASSWORD must be at least 12 characters; ignored.");
    return;
  }
  const marker = JSON.stringify(createHash("sha256").update(`master-admin-reset:${password}`).digest("hex"));
  if (c.prepare("SELECT 1 FROM settings WHERE key='master_admin_reset' AND value=?").get(marker)) return;
  const changed = c.prepare("UPDATE users SET password=?, mustChange=1 WHERE email=?").run(hashPassword(password), MASTER_ADMIN_EMAIL).changes;
  if (!Number(changed)) return;
  c.prepare("DELETE FROM sessions WHERE userId=(SELECT id FROM users WHERE email=?)").run(MASTER_ADMIN_EMAIL);
  c.prepare("INSERT INTO settings(key,value) VALUES('master_admin_reset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(marker);
  console.warn(
    `[setup] Reset ${MASTER_ADMIN_EMAIL}'s password from CRM_MASTER_ADMIN_RESET_PASSWORD. Sign in, choose a new password, then remove the variable.`,
  );
}

/** True until the first account exists (shown by the health check). */
export function setupRequired() {
  return Number((db().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n) === 0;
}

/** Stable secret for signing public links; CRM_SECRET when set, else generated once and kept in the database. */
export function appSecret() {
  const configured = process.env.CRM_SECRET?.trim();
  if (configured) return configured;
  const row = db().prepare("SELECT value FROM settings WHERE key='app_secret'").get() as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as string;
  const secret = randomBytes(32).toString("base64url");
  db().prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('app_secret',?)").run(JSON.stringify(secret));
  return JSON.parse((db().prepare("SELECT value FROM settings WHERE key='app_secret'").get() as { value: string }).value) as string;
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
export function getUserById(id: string): User | null {
  const row = db()
    .prepare(
      "SELECT id,name,email,role,mustChange,designation,status FROM users WHERE id=?",
    )
    .get(id);
  return row ? publicUser(row as Record<string, unknown>) : null;
}
export function setupAccounts() {
  if (Number(db().prepare("SELECT COUNT(*) AS n FROM users").get()!.n))
    throw new AppError(
      409,
      "Accounts already exist. Setup will not overwrite passwords.",
    );
  return transaction(() =>
    [
      ["AutoNeural Admin", "info", "admin", "System Administrator"],
    ].map(([name, local, role, designation]) => {
      const password = randomBytes(15).toString("base64url");
      const email = `${local}@autoneural.in`;
      db()
        .prepare(
          "INSERT INTO users(id,name,email,role,password,mustChange,designation,status) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(randomUUID(), name, email, role, hashPassword(password), 1, designation, "ACTIVE");
      return { email, role, password };
    }),
  );
}
export function recordAuthLog(entry: {
  userId?: string | null;
  name: string;
  email: string;
  role: string;
  action: "LOGIN" | "LOGOUT";
  ip?: string | null;
  userAgent?: string | null;
}): AuthLog {
  const id = randomUUID();
  const time = timestamp();
  const log: AuthLog = {
    id,
    userId: entry.userId || null,
    name: entry.name,
    email: entry.email,
    role: entry.role,
    action: entry.action,
    ip: entry.ip || null,
    userAgent: entry.userAgent || null,
    timestamp: time,
  };
  try {
    db()
      .prepare(
        "INSERT INTO auth_logs(id,userId,name,email,role,action,ip,userAgent,timestamp) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        log.id,
        log.userId ?? null,
        log.name,
        log.email,
        log.role,
        log.action,
        log.ip ?? null,
        log.userAgent ?? null,
        log.timestamp,
      );
  } catch (e) {
    console.error("Failed to insert auth log:", e);
  }

  return log;
}
export function allAuthLogs(limit = 100): AuthLog[] {
  try {
    return db()
      .prepare(
        "SELECT id,userId,name,email,role,action,ip,userAgent,timestamp FROM auth_logs ORDER BY timestamp DESC LIMIT ?",
      )
      .all(limit) as unknown as AuthLog[];
  } catch {
    return [];
  }
}
/** Failed-login budget per 15 minutes: per account, and per client IP across all accounts. */
const LOGIN_LIMIT_PER_EMAIL = 10;
const LOGIN_LIMIT_PER_IP = 50;
export function login(
  email: string,
  password: string,
  context?: { ip?: string; userAgent?: string },
) {
  email = email.toLowerCase().trim();
  // Without a proxy-supplied IP every request would share one bucket, letting anyone lock everyone out.
  const ipKey = context?.ip && context.ip !== "unknown" ? `ip:${context.ip}` : null;
  const limited = transaction(() => {
    db().prepare("DELETE FROM attempts WHERE expires < ?").run(Date.now());
    const bump = db().prepare(
      "INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET count=count+1",
    );
    const count = (key: string) =>
      Number((db().prepare("SELECT count FROM attempts WHERE email=?").get(key) as { count: number }).count);
    bump.run(email, Date.now() + 15 * 60000);
    if (ipKey) bump.run(ipKey, Date.now() + 15 * 60000);
    return count(email) > LOGIN_LIMIT_PER_EMAIL || (ipKey !== null && count(ipKey) > LOGIN_LIMIT_PER_IP);
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
  if (row.status === "INACTIVE")
    throw new AppError(403, "This account has been deactivated. Contact your administrator.");
  db().prepare("DELETE FROM attempts WHERE email=?").run(email);
  // Only failures count against a (possibly shared office) IP.
  if (ipKey) db().prepare("UPDATE attempts SET count=count-1 WHERE email=? AND count>0").run(ipKey);
  db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  const token = randomBytes(32).toString("base64url");
  db()
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(digest(token), String(row.id), Date.now() + 8 * 3600000);
  const user = publicUser(row);
  recordAuthLog({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    action: "LOGIN",
    ip: context?.ip,
    userAgent: context?.userAgent,
  });
  return { user, token };
}
export function userForToken(token: string) {
  const u = db()
    .prepare(
      "SELECT u.* FROM users u JOIN sessions s ON u.id=s.userId WHERE s.token=? AND s.expires>? AND (u.status IS NULL OR u.status!='INACTIVE')",
    )
    .get(digest(token), Date.now());
  return u ? publicUser(u) : null;
}
export function logout(
  token: string,
  context?: { ip?: string; userAgent?: string },
) {
  try {
    const session = db()
      .prepare(
        "SELECT u.* FROM users u JOIN sessions s ON u.id=s.userId WHERE s.token=?",
      )
      .get(digest(token)) as any;
    if (session) {
      recordAuthLog({
        userId: session.id,
        name: session.name,
        email: session.email,
        role: session.role,
        action: "LOGOUT",
        ip: context?.ip,
        userAgent: context?.userAgent,
      });
    }
  } catch (err) {
    console.error("Error auditing logout:", err);
  }
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
  const target = allUsers().find((u) => u.id === userId);
  if (!target) throw new AppError(404, "Employee not found.");
  if (target.role === "admin" && !isMasterAdmin(user))
    throw new AppError(403, "Only the master admin can reset an administrator's password.");
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
export const linkInput = z.object({
  name: z.string().trim().min(1).max(180),
  url: z
    .string()
    .trim()
    .max(2000)
    .url("Enter a valid link.")
    .refine((u) => /^https?:\/\//i.test(u), "Only http:// and https:// links can be attached."),
});
export const attachmentPurposes = ["REFERENCE", "OUTPUT", "FOR_APPROVAL"] as const;
type AttachmentPurpose = (typeof attachmentPurposes)[number];
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

    // A reference link can be attached while creating the task; files are uploaded to
    // POST /api/attachments once the task exists.
    const rawAtt = (input as { attachment?: { name?: unknown; url?: unknown } })?.attachment;
    if (rawAtt?.url) {
      const link = linkInput.parse({ name: rawAtt.name || rawAtt.url, url: rawAtt.url });
      db()
        .prepare(
          "INSERT INTO task_attachments(id,taskId,uploaderId,name,type,url,fileSize,purpose,approvalStatus,reviewNote,createdAt) VALUES(?,?,?,?,'LINK',?,NULL,'REFERENCE',NULL,NULL,?)",
        )
        .run(randomUUID(), id, user.id, link.name, link.url, time);
      event(user, id, `Attached link: "${link.name}".`);
    }

    const created = findTask(user, id);
    if (target) {
      void notifyTaskAssigned(created, target, user);
      recordTaskNotificationEmail({
        type: "ASSIGNED",
        task: created,
        sender: user,
        recipient: target,
      });
    }
    return created;
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
    const updated = findTask(user, task.id);

    if (task.assigneeId !== next.assigneeId) {
      const newAssignee = allUsers().find((u) => u.id === next.assigneeId);
      if (newAssignee) {
        void notifyTaskAssigned(updated, newAssignee, user);
        recordTaskNotificationEmail({
          type: "REASSIGNED",
          task: updated,
          sender: user,
          recipient: newAssignee,
        });
      }
    }

    if (task.status !== "Completed" && next.status === "Completed") {
      const creator = getUserById(task.createdBy);
      const adminToNotify =
        creator && creator.role === "admin"
          ? creator
          : allUsers().find((u) => u.role === "admin");
      if (adminToNotify) {
        void notifyTaskCompleted(updated, user, adminToNotify);
        recordTaskNotificationEmail({
          type: "COMPLETED",
          task: updated,
          sender: user,
          recipient: adminToNotify,
        });
      }
    }

    return updated;
  });
}
export function addComment(user: User, taskId: string, text: string) {
  text = z.string().trim().min(1).max(3000).parse(text);
  return transaction(() => {
    const task = findTask(user, taskId);
    db()
      .prepare("INSERT INTO comments VALUES(?,?,?,?,?)")
      .run(randomUUID(), taskId, user.id, text, timestamp());
    event(user, taskId, "Added a comment.");

    const creator = getUserById(task.createdBy);
    const adminToNotify =
      creator && creator.role === "admin"
        ? creator
        : allUsers().find((u) => u.role === "admin");

    if (adminToNotify && adminToNotify.id !== user.id) {
      void notifyTaskComment(task, user, text, adminToNotify);
      recordTaskNotificationEmail({
        type: "COMMENT",
        task,
        sender: user,
        recipient: adminToNotify,
        commentText: text,
      });
    } else if (user.role === "admin") {
      const assignee = getUserById(task.assigneeId);
      if (assignee && assignee.id !== user.id) {
        void notifyTaskComment(task, user, text, assignee);
        recordTaskNotificationEmail({
          type: "COMMENT",
          task,
          sender: user,
          recipient: assignee,
          commentText: text,
        });
      }
    }
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
  if (role === "admin" && !isMasterAdmin(adminUser))
    throw new AppError(403, "Only the master admin can create administrators.");
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
  const emp = db().prepare("SELECT id,name,email FROM users WHERE id=?").get(employeeId) as { id: string; name: string; email: string } | undefined;
  if (!emp) throw new AppError(404, "Employee not found.");
  if (isMasterAdmin(emp)) throw new AppError(403, "The master admin account cannot be removed.");

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

  // Dual control between admins; the master admin may approve alone (it may be the only admin).
  if (req.requestedById === adminUser.id && !isMasterAdmin(adminUser)) {
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
const purposeFor = (user: User, purpose: unknown): AttachmentPurpose =>
  purpose == null || purpose === ""
    ? user.role === "admin"
      ? "REFERENCE"
      : "OUTPUT"
    : z.enum(attachmentPurposes, { errorMap: () => ({ message: "Choose what this attachment is for." }) }).parse(purpose);

/** Inserts an attachment row; a submission for approval also moves the task into review. */
function insertAttachment(
  user: User,
  taskId: string,
  a: { name: string; type: "LINK" | "DOCUMENT"; url: string; fileSize: number | null; purpose: AttachmentPurpose; storageKey?: string; mimeType?: string },
  id: string = randomUUID(),
) {
  const time = timestamp();
  const isApproval = a.purpose === "FOR_APPROVAL";
  db()
    .prepare(
      "INSERT INTO task_attachments(id,taskId,uploaderId,name,type,url,fileSize,purpose,approvalStatus,reviewNote,createdAt,storageKey,mimeType) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,?)",
    )
    .run(id, taskId, user.id, a.name, a.type, a.url, a.fileSize, a.purpose, isApproval ? "PENDING" : null, time, a.storageKey ?? null, a.mimeType ?? null);
  const what = a.type === "LINK" ? "link" : "file";
  if (isApproval) {
    db().prepare("UPDATE tasks SET status='In review', completedAt=NULL, updatedAt=?, version=version+1 WHERE id=?").run(time, taskId);
    event(user, taskId, `Submitted ${what} for approval: "${a.name}".`);
  } else {
    event(user, taskId, `Attached ${what}: "${a.name}".`);
  }
  return { ok: true, id };
}

export function attachTaskLink(user: User, taskId: string, input: { name?: unknown; url?: unknown; purpose?: unknown }) {
  findTask(user, taskId);
  const link = linkInput.parse({ name: input.name, url: input.url });
  const purpose = purposeFor(user, input.purpose);
  return transaction(() => insertAttachment(user, taskId, { ...link, type: "LINK", fileSize: null, purpose }));
}

/** Records a file already written by lib/files.ts; the caller removes it if this throws. */
export function attachTaskFile(user: User, taskId: string, file: StoredFile, input: { name?: unknown; purpose?: unknown }) {
  findTask(user, taskId);
  let name = z.string().trim().max(170).optional().parse(input.name) || file.name;
  // Keep the real extension on renamed files so downloads open in the right app.
  const ext = file.name.includes(".") ? `.${file.name.split(".").pop()}` : "";
  if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
  const purpose = purposeFor(user, input.purpose);
  const id = randomUUID();
  const url = `/api/attachments/${id}`;
  return transaction(() => ({
    ...insertAttachment(user, taskId, { name, type: "DOCUMENT", url, fileSize: file.size, purpose, storageKey: file.key, mimeType: file.mime }, id),
    url,
  }));
}

/** An uploaded file the user may download (access follows the task). */
export function attachmentFile(user: User, attachmentId: string) {
  const att = db()
    .prepare("SELECT id,taskId,name,mimeType,fileSize,storageKey FROM task_attachments WHERE id=?")
    .get(attachmentId) as { id: string; taskId: string; name: string; mimeType: string | null; fileSize: number | null; storageKey: string | null } | undefined;
  if (!att) throw new AppError(404, "Attachment not found.");
  findTask(user, att.taskId);
  if (!att.storageKey || !att.mimeType)
    throw new AppError(404, "This attachment was recorded before file uploads were stored, so there is no file to download.");
  return { key: att.storageKey, name: att.name, mime: att.mimeType };
}

function reviewSubmission(user: User, attachmentId: string, decision: "APPROVED" | "REJECTED", note?: unknown) {
  requireAdmin(user);
  const text = z.string().trim().max(1000).optional().parse(note ?? undefined) || null;
  const att = db().prepare("SELECT * FROM task_attachments WHERE id=?").get(attachmentId) as
    | { taskId: string; name: string; purpose: string; approvalStatus: string | null }
    | undefined;
  if (!att) throw new AppError(404, "Attachment not found.");
  if (att.purpose !== "FOR_APPROVAL") throw new AppError(400, "Only submissions for approval can be reviewed.");
  if (att.approvalStatus !== "PENDING") throw new AppError(409, "This submission has already been reviewed.");
  return transaction(() => {
    db().prepare("UPDATE task_attachments SET approvalStatus=?, reviewNote=? WHERE id=?").run(decision, text, attachmentId);
    event(
      user,
      att.taskId,
      decision === "APPROVED"
        ? `Approved deliverable: "${att.name}"${text ? ` ("${text}")` : ""}.`
        : `Requested changes on deliverable "${att.name}"${text ? `: "${text}"` : ""}.`,
    );
    db().prepare("UPDATE tasks SET updatedAt=?, version=version+1 WHERE id=?").run(timestamp(), att.taskId);
    return { ok: true };
  });
}
export const approveTaskSubmission = (user: User, attachmentId: string, note?: unknown) =>
  reviewSubmission(user, attachmentId, "APPROVED", note);
export const rejectTaskSubmission = (user: User, attachmentId: string, note?: unknown) =>
  reviewSubmission(user, attachmentId, "REJECTED", note);

export function deleteTaskAttachment(user: User, attachmentId: string) {
  const att = db().prepare("SELECT * FROM task_attachments WHERE id=?").get(attachmentId) as
    | { taskId: string; uploaderId: string; type: string; name: string; storageKey: string | null }
    | undefined;
  if (!att) throw new AppError(404, "Attachment not found.");
  findTask(user, att.taskId);
  if (user.role !== "admin" && att.uploaderId !== user.id) {
    throw new AppError(403, "You do not have permission to delete this attachment.");
  }
  const result = transaction(() => {
    db().prepare("DELETE FROM task_attachments WHERE id=?").run(attachmentId);
    event(user, att.taskId, `Removed ${att.type === "LINK" ? "link" : "file"}: "${att.name}".`);
    return { ok: true };
  });
  removeStoredFile(att.storageKey);
  return result;
}
export function deleteTask(user: User, taskId: string) {
  if (user.role !== "admin") {
    throw new AppError(403, "Only administrators can delete tasks.");
  }
  const { result, files } = transaction(() => {
    const task = findTask(user, taskId);
    const files = (db().prepare("SELECT storageKey FROM task_attachments WHERE taskId=? AND storageKey IS NOT NULL").all(taskId) as { storageKey: string }[]).map(
      (f) => f.storageKey,
    );
    db().prepare("DELETE FROM task_attachments WHERE taskId=?").run(taskId);
    db().prepare("DELETE FROM comments WHERE taskId=?").run(taskId);
    db().prepare("DELETE FROM events WHERE taskId=?").run(taskId);
    db().prepare("UPDATE emails SET taskId=NULL WHERE taskId=?").run(taskId);
    db().prepare("DELETE FROM tasks WHERE id=?").run(taskId); // leads.taskId is ON DELETE SET NULL
    return { result: { ok: true, id: taskId, title: task.title }, files };
  });
  files.forEach(removeStoredFile);
  return result;
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
    authLogs: admin ? allAuthLogs(100) : [],
    emails: getEmailsForUser(user, "all", 50),
    unreadEmailCount: unreadEmailCount(user),
    emailStatus: admin ? getEmailServiceStatus() : undefined,
    uploadLimitMb: Math.round(maxUploadBytes() / 1024 / 1024),
  };
}

export function unreadEmailCount(user: User): number {
  try {
    const row = db()
      .prepare(
        "SELECT COUNT(*) AS count FROM emails WHERE recipientEmail=? AND direction='INBOUND' AND status='unread'",
      )
      .get(user.email.toLowerCase()) as { count: number } | undefined;
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

export function getEmailsForUser(
  user: User,
  folder: "inbox" | "sent" | "all" = "all",
  limit = 50,
): EmailMessage[] {
  const email = user.email.toLowerCase();
  let query = `SELECT e.*, t.title AS taskTitle FROM emails e LEFT JOIN tasks t ON t.id=e.taskId `;
  const params: any[] = [];

  if (folder === "inbox") {
    query += `WHERE e.recipientEmail=? AND e.direction='INBOUND' `;
    params.push(email);
  } else if (folder === "sent") {
    query += `WHERE e.senderEmail=? AND e.direction='OUTBOUND' `;
    params.push(email);
  } else {
    query += `WHERE (e.recipientEmail=? AND e.direction='INBOUND') OR (e.senderEmail=? AND e.direction='OUTBOUND') `;
    params.push(email, email);
  }

  query += `ORDER BY e.createdAt DESC LIMIT ?`;
  params.push(limit);

  try {
    return db().prepare(query).all(...params) as unknown as EmailMessage[];
  } catch (err) {
    console.error("Error loading emails:", err);
    return [];
  }
}

export function getEmailThread(user: User, threadId: string): EmailMessage[] {
  const email = user.email.toLowerCase();
  try {
    const rows = db()
      .prepare(
        `SELECT e.*, t.title AS taskTitle FROM emails e LEFT JOIN tasks t ON t.id=e.taskId
         WHERE e.threadId=?
           AND ((e.senderEmail=? AND e.direction='OUTBOUND') OR (e.recipientEmail=? AND e.direction='INBOUND'))
         ORDER BY e.createdAt ASC`,
      )
      .all(threadId, email, email) as unknown as EmailMessage[];
    return rows;
  } catch (err) {
    console.error("Error loading email thread:", err);
    return [];
  }
}

/** Marks one of the user's own messages read or unread. */
export function markEmailSeen(
  user: User,
  emailId: string,
  status: "read" | "unread" = "read",
): { ok: boolean; id: string; status: string } {
  const email = user.email.toLowerCase();
  const next = z.enum(["read", "unread"]).parse(status);
  const changed = db()
    .prepare(
      `UPDATE emails SET status=?, seenAt=? WHERE id=? AND ((recipientEmail=? AND direction='INBOUND') OR (senderEmail=? AND direction='OUTBOUND'))`,
    )
    .run(next, next === "read" ? timestamp() : null, emailId, email, email).changes;
  if (!Number(changed)) throw new AppError(404, "Email message not found.");
  return { ok: true, id: emailId, status: next };
}

/** How a message reached its recipient: the email provider, or only the recipient's workspace inbox. */
export type EmailDelivery = "sent" | "workspace";
export type SentEmail = EmailMessage & { delivery: EmailDelivery; deliveryError?: string };

/**
 * Sends a message from a workspace user. Workspace recipients always get it in their
 * inbox; anyone else only through the configured email provider, so a provider failure
 * for an outside address is an error and nothing is recorded as sent.
 */
async function deliverUserEmail(
  user: User,
  m: { to: string; subject: string; body: string; html: string; text: string; threadId: string; inReplyTo: string | null; taskId: string | null },
): Promise<SentEmail> {
  const recipientUser = allUsers().find((u) => u.email.toLowerCase() === m.to);
  const result = await sendEmail({
    to: m.to,
    subject: m.subject,
    html: m.html,
    text: m.text,
    fromName: user.name,
    fromEmail: user.email,
    replyTo: user.email,
  });
  if (!result.success && !recipientUser) {
    throw result.notConfigured
      ? new AppError(503, "Email delivery is not configured on this server, so messages to outside addresses cannot be sent. Ask an administrator to add SMTP or Resend settings.")
      : new AppError(502, `The email could not be sent: ${result.error || "the email provider rejected it"}.`);
  }
  const id = randomUUID();
  const time = timestamp();
  const insert = db().prepare(
    `INSERT INTO emails(id, threadId, senderId, senderName, senderEmail, recipientId, recipientEmail, subject, body, status, direction, inReplyTo, taskId, createdAt, seenAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  transaction(() => {
    insert.run(id, m.threadId, user.id, user.name, user.email.toLowerCase(), recipientUser?.id ?? null, m.to, m.subject, m.body, "read", "OUTBOUND", m.inReplyTo, m.taskId, time, time);
    if (recipientUser)
      insert.run(randomUUID(), m.threadId, user.id, user.name, user.email.toLowerCase(), recipientUser.id, m.to, m.subject, m.body, "unread", "INBOUND", m.inReplyTo, m.taskId, time, null);
  });
  return {
    id,
    threadId: m.threadId,
    senderId: user.id,
    senderName: user.name,
    senderEmail: user.email.toLowerCase(),
    recipientId: recipientUser?.id ?? null,
    recipientEmail: m.to,
    subject: m.subject,
    body: m.body,
    status: "read",
    direction: "OUTBOUND",
    inReplyTo: m.inReplyTo,
    taskId: m.taskId,
    createdAt: time,
    seenAt: time,
    delivery: result.success ? "sent" : "workspace",
    ...(result.success ? {} : { deliveryError: result.notConfigured ? "Email delivery is not configured." : result.error }),
  };
}

export async function sendUserEmail(
  user: User,
  input: {
    to: string;
    subject: string;
    body?: string;
    text?: string;
    taskId?: string;
  },
): Promise<SentEmail> {
  if (!input) throw new AppError(400, "Email payload is required.");
  const toEmail = z.string().trim().email("Enter a valid recipient email.").parse(input.to).toLowerCase();
  const subject = z.string().trim().min(1, "Add a subject.").max(200).parse(input.subject);
  const body = z.string().trim().min(1, "Write a message.").max(10000).parse(input.body || input.text);
  const taskId = input.taskId ? z.string().uuid().parse(input.taskId) : null;
  const task = taskId ? findTask(user, taskId) : undefined;
  const appUrl = getAppBaseUrl();
  const { html, text } = renderDirectEmail({
    sender: { name: user.name, email: user.email, designation: user.designation },
    subject,
    message: body,
    taskLink: task ? `${appUrl}/?task=${encodeURIComponent(task.id)}` : undefined,
    taskTitle: task?.title,
  });
  return deliverUserEmail(user, { to: toEmail, subject, body, html, text, threadId: `th_${randomUUID()}`, inReplyTo: null, taskId });
}

export async function replyToEmail(user: User, emailId: string, replyText: string): Promise<SentEmail> {
  replyText = z.string().trim().min(1, "Write a reply.").max(10000).parse(replyText);
  const me = user.email.toLowerCase();
  // Only messages in the user's own mailbox can be replied to.
  const emailRow = db()
    .prepare("SELECT * FROM emails WHERE id=? AND ((recipientEmail=? AND direction='INBOUND') OR (senderEmail=? AND direction='OUTBOUND'))")
    .get(emailId, me, me) as
    | { id: string; threadId: string | null; direction: string; senderEmail: string; senderName: string; recipientEmail: string; subject: string; body: string; taskId: string | null; createdAt: string }
    | undefined;
  if (!emailRow) throw new AppError(404, "Email message not found.");
  const toEmail = (emailRow.direction === "INBOUND" ? emailRow.senderEmail : emailRow.recipientEmail).toLowerCase();
  const replySubject = /^re:/i.test(emailRow.subject) ? emailRow.subject : `Re: ${emailRow.subject}`;
  const { html, text } = renderDirectEmail({
    sender: { name: user.name, email: user.email, designation: user.designation },
    subject: replySubject,
    message: `${replyText}\n\n--- On ${new Date(emailRow.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}, ${emailRow.senderName} wrote: ---\n${emailRow.body}`,
  });
  return deliverUserEmail(user, {
    to: toEmail,
    subject: replySubject,
    body: replyText,
    html,
    text,
    threadId: emailRow.threadId || `th_${emailRow.id}`,
    inReplyTo: emailRow.id,
    taskId: emailRow.taskId,
  });
}

export function recordInboundEmail(payload: {
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject: string;
  body: string;
  taskId?: string;
}): EmailMessage {
  const fromEmail = z.string().trim().email().parse(payload.fromEmail).toLowerCase();
  const toEmail = z.string().trim().email().parse(payload.toEmail).toLowerCase();
  const fromName = (payload.fromName?.trim() || fromEmail.split("@")[0]).slice(0, 120);
  const subject = (payload.subject?.trim() || "(No Subject)").slice(0, 200);
  const body = (payload.body?.trim() || "").slice(0, 100_000);
  const taskId =
    payload.taskId && z.string().uuid().safeParse(payload.taskId).success && db().prepare("SELECT 1 FROM tasks WHERE id=?").get(payload.taskId)
      ? payload.taskId
      : null;

  const id = randomUUID();
  const threadId = `th_${randomUUID()}`;
  const time = timestamp();
  const recipientUser = allUsers().find((u) => u.email.toLowerCase() === toEmail);
  const senderUser = allUsers().find((u) => u.email.toLowerCase() === fromEmail);

  db()
    .prepare(
      `INSERT INTO emails(id, threadId, senderId, senderName, senderEmail, recipientId, recipientEmail, subject, body, status, direction, inReplyTo, taskId, createdAt, seenAt)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      threadId,
      senderUser?.id || null,
      fromName,
      fromEmail,
      recipientUser?.id || null,
      toEmail,
      subject,
      body,
      "unread",
      "INBOUND",
      null,
      taskId,
      time,
      null,
    );

  return {
    id,
    threadId,
    senderId: senderUser?.id || null,
    senderName: fromName,
    senderEmail: fromEmail,
    recipientId: recipientUser?.id || null,
    recipientEmail: toEmail,
    subject,
    body,
    status: "unread",
    direction: "INBOUND",
    inReplyTo: null,
    taskId,
    createdAt: time,
    seenAt: null,
  };
}

export function recordTaskNotificationEmail({
  type,
  task,
  sender,
  recipient,
  commentText,
}: {
  type: "ASSIGNED" | "REASSIGNED" | "COMPLETED" | "COMMENT";
  task: Task;
  sender: User;
  recipient: User;
  commentText?: string;
}) {
  try {
    const time = timestamp();
    const threadId = `task_${task.id}`;
    let subject = "";
    let body = "";

    if (type === "ASSIGNED" || type === "REASSIGNED") {
      subject = `[AN-${String(task.number).padStart(3, "0")}] New Task Assigned: ${task.title}`;
      body = `Hi ${recipient.name},\n\nYou have been assigned to task AN-${String(task.number).padStart(3, "0")} (${task.title}).\n\nPriority: ${task.priority}\nDue Date: ${task.dueDate}\nProject: ${task.project || "General"}\n\nDescription:\n${task.description || "(No description provided)"}`;
    } else if (type === "COMPLETED") {
      subject = `[AN-${String(task.number).padStart(3, "0")}] Task Completed: ${task.title}`;
      body = `Hi ${recipient.name},\n\nTask AN-${String(task.number).padStart(3, "0")} (${task.title}) has been marked as completed by ${sender.name}.\n\nCompleted At: ${task.completedAt || time}`;
    } else if (type === "COMMENT") {
      subject = `[AN-${String(task.number).padStart(3, "0")}] New comment on "${task.title}" by ${sender.name}`;
      body = `Hi ${recipient.name},\n\n${sender.name} posted a comment on task AN-${String(task.number).padStart(3, "0")} (${task.title}):\n\n"${commentText}"`;
    }

    // 1. OUTBOUND for sender
    db()
      .prepare(
        `INSERT INTO emails(id, threadId, senderId, senderName, senderEmail, recipientId, recipientEmail, subject, body, status, direction, inReplyTo, taskId, createdAt, seenAt)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        threadId,
        sender.id,
        sender.name,
        sender.email.toLowerCase(),
        recipient.id,
        recipient.email.toLowerCase(),
        subject,
        body,
        "read",
        "OUTBOUND",
        null,
        task.id,
        time,
        time,
      );

    // 2. INBOUND for recipient (status: 'unread', seenAt: null)
    db()
      .prepare(
        `INSERT INTO emails(id, threadId, senderId, senderName, senderEmail, recipientId, recipientEmail, subject, body, status, direction, inReplyTo, taskId, createdAt, seenAt)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        threadId,
        sender.id,
        sender.name,
        sender.email.toLowerCase(),
        recipient.id,
        recipient.email.toLowerCase(),
        subject,
        body,
        "unread",
        "INBOUND",
        null,
        task.id,
        time,
        null,
      );
  } catch (err) {
    console.error("[recordTaskNotificationEmail Error]", err);
  }
}
