import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  setupAccounts,
  allUsers,
  db,
  login,
  userForToken,
  changePassword,
  createTask,
  updateTask,
  workspace,
  taskDetails,
  addComment,
  resetPassword,
  createEmployee,
  logout,
  requestRemoval,
  approveRemoval,
  allAuthLogs,
  deleteTask,
  AppError,
} from "../src/lib/store";
const dir = mkdtempSync(join(tmpdir(), "autoneural-test-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");
const credentials = setupAccounts(),
  initialUsers = allUsers(),
  admin = initialUsers.find((u) => u.email === "info@autoneural.in")!;

// Provision test employees for scoped employee tests
const emp1Res = createEmployee(admin, {
  name: "Employee One",
  email: "emp1@autoneural.in",
  role: "employee",
});
const emp2Res = createEmployee(admin, {
  name: "Employee Two",
  email: "emp2@autoneural.in",
  role: "employee",
});
const users = allUsers(),
  emp1 = users.find((u) => u.id === emp1Res.id)!,
  emp2 = users.find((u) => u.id === emp2Res.id)!;

const taskInput = {
  title: "Prepare client proposal",
  description: "Confirm the scope and send a draft for review.",
  assigneeId: emp1.id,
  priority: "High" as const,
  dueDate: "2026-10-01",
  project: "Client onboarding",
};
after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});
test("Setup creates only the master admin (info@autoneural.in)", () => {
  assert.equal(initialUsers.length, 1);
  assert.equal(admin.email, "info@autoneural.in");
  assert.equal(admin.role, "admin");
  assert.ok(admin.mustChange);
  assert.equal(credentials.length, 1);
  assert.throws(setupAccounts, /already exist/);
});
test("No hard-coded fallback passwords unlock admin accounts", () => {
  for (const pw of ["Password123!", "AutoNeural@2026!"])
    assert.throws(() => login(admin.email, pw), /incorrect/);
});
test("Master admin: only it creates admins; it cannot be removed; it may approve removals alone", () => {
  const second = createEmployee(admin, { name: "Second Admin", email: "admin2@autoneural.in", role: "admin" });
  const admin2 = allUsers().find((u) => u.id === second.id)!;
  assert.equal(admin2.role, "admin");
  assert.throws(
    () => createEmployee(admin2, { name: "Third", email: "admin3@autoneural.in", role: "admin" }),
    (e) => e instanceof AppError && e.status === 403,
  );
  assert.throws(() => requestRemoval(admin2, admin.id), (e) => e instanceof AppError && e.status === 403);
  assert.throws(() => resetPassword(admin2, admin.id), (e) => e instanceof AppError && e.status === 403);
  // Ordinary admins still need a second admin to approve their own request...
  const temp = createEmployee(admin, { name: "Temp", email: "temp@autoneural.in" });
  const req1 = requestRemoval(admin2, temp.id);
  assert.throws(() => approveRemoval(admin2, req1.id), (e) => e instanceof AppError && e.status === 403);
  approveRemoval(admin, req1.id);
  // ...but the master admin can act alone.
  const temp2 = createEmployee(admin, { name: "Temp Two", email: "temp2@autoneural.in" });
  approveRemoval(admin, requestRemoval(admin, temp2.id).id);
  assert.ok(!allUsers().some((u) => u.id === temp.id || u.id === temp2.id));
  approveRemoval(admin, requestRemoval(admin, admin2.id).id);
});
test("Passwords are hashed; sessions expire, revoke, and rotate after password change", () => {
  const c = { email: emp1.email, password: emp1Res.initialPassword };
  assert.ok(
    !String(
      db().prepare("SELECT password FROM users WHERE id=?").get(emp1.id)!
        .password,
    ).includes(c.password),
  );
  assert.throws(() => login(c.email, "wrong"), /incorrect/);
  const first = login(c.email, c.password);
  assert.equal(userForToken(first.token)?.id, emp1.id);
  changePassword(emp1, c.password, "New-secure-password-2026");
  assert.equal(userForToken(first.token), null);
  assert.throws(() => login(c.email, c.password), /incorrect/);
  const next = login(c.email, "New-secure-password-2026");
  assert.equal(next.user.mustChange, false);
  logout(next.token);
  assert.equal(userForToken(next.token), null);
  const expired = login(c.email, "New-secure-password-2026");
  db().prepare("UPDATE sessions SET expires=0").run();
  assert.equal(userForToken(expired.token), null);
});
test("Only admin creates tasks; assignment must refer to an employee and dates must be real", () => {
  assert.throws(() => createTask(emp1, taskInput), /administrator/);
  assert.throws(
    () => createTask(admin, { ...taskInput, assigneeId: admin.id }),
    /another admin/,
  );
  assert.throws(() =>
    createTask(admin, { ...taskInput, dueDate: "2026-02-31" }),
  );
});
test("Employee task lists, details, comments and updates are scoped to their assignment", () => {
  const t = createTask(admin, taskInput);
  assert.ok(workspace(emp1).tasks.some((x) => x.id === t.id));
  assert.equal(workspace(emp2).tasks.length, 0);
  assert.equal(workspace(emp1).team.length, 1);
  assert.throws(() => taskDetails(emp2, t.id), /not found/);
  assert.throws(() => addComment(emp2, t.id, "Access attempt"), /not found/);
  assert.throws(
    () =>
      updateTask(emp2, {
        id: t.id,
        version: t.version,
        status: "Completed",
      }),
    /not found/,
  );
  assert.throws(() =>
    updateTask(emp1, {
      id: t.id,
      version: t.version,
      status: "Completed",
      assigneeId: emp2.id,
    }),
  );
  assert.throws(() => resetPassword(emp1, emp2.id), /administrator/);
});
test("Progress and completion persist; stale writes are rejected; reopening clears completion", () => {
  let t = createTask(admin, { ...taskInput, title: "Completion lifecycle" });
  t = updateTask(emp1, {
    id: t.id,
    version: t.version,
    status: "In progress",
  });
  assert.throws(
    () => updateTask(emp1, { id: t.id, version: 1, status: "Completed" }),
    /updated by someone else/,
  );
  t = updateTask(emp1, { id: t.id, version: t.version, status: "Completed" });
  assert.ok(t.completedAt);
  assert.equal(
    workspace(admin).tasks.find((x) => x.id === t.id)?.status,
    "Completed",
  );
  t = updateTask(emp1, {
    id: t.id,
    version: t.version,
    status: "In progress",
  });
  assert.equal(t.completedAt, null);
  assert.equal(taskDetails(admin, t.id).activity.length, 4);
});
test("Comments are shared with admin, reassignment removes the previous employee’s access", () => {
  const t = createTask(admin, {
    ...taskInput,
    title: "Reassignment lifecycle",
  });
  addComment(emp1, t.id, "Draft is ready for review.");
  assert.equal(
    taskDetails(admin, t.id).comments[0].text,
    "Draft is ready for review.",
  );
  updateTask(admin, { ...t, assigneeId: emp2.id });
  assert.throws(() => taskDetails(emp1, t.id), /not found/);
  assert.equal(taskDetails(emp2, t.id).task.assigneeId, emp2.id);
  assert.ok(!workspace(emp1).activity.some((e) => e.taskId === t.id));
});
test("Admin password reset invalidates sessions and requires first-login change", () => {
  const c = { email: emp2.email, password: emp2Res.initialPassword };
  const session = login(c.email, c.password);
  const password = resetPassword(admin, emp2.id);
  assert.equal(userForToken(session.token), null);
  assert.throws(() => login(c.email, c.password), /incorrect/);
  assert.equal(login(c.email, password).user.mustChange, true);
});
test("Login attempts are limited even for nonexistent accounts", () => {
  for (let i = 0; i < 10; i++)
    assert.throws(() => login("unknown@autoneural.in", "bad"), /incorrect/);
  assert.throws(
    () => login("unknown@autoneural.in", "bad"),
    (e) => e instanceof AppError && e.status === 429,
  );
});
test("Audit logs accurately record login and logout events with timestamps and roles", () => {
  const c = credentials.find((c) => c.email === admin.email)!;
  const signin = login(admin.email, c.password, { ip: "192.168.1.50", userAgent: "Mozilla/5.0 TestBrowser" });
  logout(signin.token, { ip: "192.168.1.50", userAgent: "Mozilla/5.0 TestBrowser" });
  const logs = allAuthLogs(20);
  const loginLog = logs.find((l) => l.email === admin.email && l.action === "LOGIN");
  const logoutLog = logs.find((l) => l.email === admin.email && l.action === "LOGOUT");
  assert.ok(loginLog);
  assert.equal(loginLog.role, "admin");
  assert.equal(loginLog.ip, "192.168.1.50");
  assert.ok(logoutLog);
  assert.equal(logoutLog.role, "admin");
});
test("Only admins can delete tasks; deletion cascades to attachments, comments, and events", () => {
  const t = createTask(admin, {
    ...taskInput,
    title: "Task to be deleted",
  });
  addComment(emp1, t.id, "Here is a comment before deletion");

  // Non-admin employee cannot delete task
  assert.throws(
    () => deleteTask(emp1, t.id),
    (e) => e instanceof AppError && e.status === 403 && e.message.includes("Only administrators"),
  );

  // Admin deletes task successfully
  const result = deleteTask(admin, t.id);
  assert.equal(result.ok, true);
  assert.equal(result.id, t.id);

  // Task is no longer found
  assert.throws(() => taskDetails(admin, t.id), /not found/);
  assert.ok(!workspace(admin).tasks.some((task) => task.id === t.id));

  // Child records in comments, events, task_attachments are cleaned up
  const commentsCount = (db().prepare("SELECT COUNT(*) as c FROM comments WHERE taskId=?").get(t.id) as { c: number }).c;
  const eventsCount = (db().prepare("SELECT COUNT(*) as c FROM events WHERE taskId=?").get(t.id) as { c: number }).c;
  const attachmentsCount = (db().prepare("SELECT COUNT(*) as c FROM task_attachments WHERE taskId=?").get(t.id) as { c: number }).c;
  assert.equal(commentsCount, 0);
  assert.equal(eventsCount, 0);
  assert.equal(attachmentsCount, 0);
});

