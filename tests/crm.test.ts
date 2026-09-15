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
  logout,
  AppError,
} from "../src/lib/store";
const dir = mkdtempSync(join(tmpdir(), "autoneural-test-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");
const credentials = setupAccounts(),
  users = allUsers(),
  admin = users.find((u) => u.role === "admin")!,
  manyu = users.find((u) => u.email.startsWith("manyu"))!,
  rajashi = users.find((u) => u.email.startsWith("rajashi"))!;
const taskInput = {
  title: "Prepare client proposal",
  description: "Confirm the scope and send a draft for review.",
  assigneeId: manyu.id,
  priority: "High",
  dueDate: "2026-10-01",
  project: "Client onboarding",
};
after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});
test("Exactly five named accounts, first email is the sole admin, all require a new password", () => {
  assert.equal(users.length, 5);
  assert.equal(admin.email, "info@autoneural.in");
  assert.equal(users.filter((u) => u.role === "admin").length, 1);
  assert.ok(users.every((u) => u.mustChange));
  assert.equal(new Set(credentials.map((c) => c.password)).size, 5);
  assert.throws(setupAccounts, /already exist/);
});
test("Passwords are hashed; sessions expire, revoke, and rotate after password change", () => {
  const c = credentials.find((c) => c.email === manyu.email)!;
  assert.ok(
    !String(
      db().prepare("SELECT password FROM users WHERE id=?").get(manyu.id)!
        .password,
    ).includes(c.password),
  );
  assert.throws(() => login(c.email, "wrong"), /incorrect/);
  const first = login(c.email, c.password);
  assert.equal(userForToken(first.token)?.id, manyu.id);
  changePassword(manyu, c.password, "New-secure-password-2026");
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
  assert.throws(() => createTask(manyu, taskInput), /administrator/);
  assert.throws(
    () => createTask(admin, { ...taskInput, assigneeId: admin.id }),
    /employee/,
  );
  assert.throws(() =>
    createTask(admin, { ...taskInput, dueDate: "2026-02-31" }),
  );
});
test("Employee task lists, details, comments and updates are scoped to their assignment", () => {
  const t = createTask(admin, taskInput);
  assert.ok(workspace(manyu).tasks.some((x) => x.id === t.id));
  assert.equal(workspace(rajashi).tasks.length, 0);
  assert.equal(workspace(manyu).team.length, 1);
  assert.throws(() => taskDetails(rajashi, t.id), /not found/);
  assert.throws(() => addComment(rajashi, t.id, "Access attempt"), /not found/);
  assert.throws(
    () =>
      updateTask(rajashi, {
        id: t.id,
        version: t.version,
        status: "Completed",
      }),
    /not found/,
  );
  assert.throws(() =>
    updateTask(manyu, {
      id: t.id,
      version: t.version,
      status: "Completed",
      assigneeId: rajashi.id,
    }),
  );
  assert.throws(() => resetPassword(manyu, rajashi.id), /administrator/);
});
test("Progress and completion persist; stale writes are rejected; reopening clears completion", () => {
  let t = createTask(admin, { ...taskInput, title: "Completion lifecycle" });
  t = updateTask(manyu, {
    id: t.id,
    version: t.version,
    status: "In progress",
  });
  assert.throws(
    () => updateTask(manyu, { id: t.id, version: 1, status: "Completed" }),
    /updated by someone else/,
  );
  t = updateTask(manyu, { id: t.id, version: t.version, status: "Completed" });
  assert.ok(t.completedAt);
  assert.equal(
    workspace(admin).tasks.find((x) => x.id === t.id)?.status,
    "Completed",
  );
  t = updateTask(manyu, {
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
  addComment(manyu, t.id, "Draft is ready for review.");
  assert.equal(
    taskDetails(admin, t.id).comments[0].text,
    "Draft is ready for review.",
  );
  updateTask(admin, { ...t, assigneeId: rajashi.id });
  assert.throws(() => taskDetails(manyu, t.id), /not found/);
  assert.equal(taskDetails(rajashi, t.id).task.assigneeId, rajashi.id);
  assert.ok(!workspace(manyu).activity.some((e) => e.taskId === t.id));
});
test("Admin password reset invalidates sessions and requires first-login change", () => {
  const c = credentials.find((c) => c.email === rajashi.email)!;
  const session = login(c.email, c.password);
  const password = resetPassword(admin, rajashi.id);
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
