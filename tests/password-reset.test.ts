import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as S from "../src/lib/store";
import * as R from "../src/lib/password-reset";
import type { AppError } from "../src/lib/errors";

const dir = mkdtempSync(join(tmpdir(), "autoneural-reset-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");
process.env.WORKFLOW_AUTORUN = "0";

S.setupAccounts();
const master = S.allUsers().find((u) => u.email === "info@autoneural.in")!;
const make = (name: string, email: string, role: "admin" | "employee" = "employee") => {
  const id = S.createEmployee(master, { name, email, role }).id;
  const pw = S.resetPassword(master, id);
  const { user } = S.login(email, pw);
  S.changePassword(user, pw, `${name}-own-password-2026`);
  return S.getUserById(id)!;
};
const admin2 = make("Second Admin", "admin2@autoneural.in", "admin");
const alice = make("Alice", "alice@autoneural.in");
const bob = make("Bob", "bob@autoneural.in");
const pending = (who = master) => R.listPasswordResets(who);
const quiet = <T>(fn: () => T) => {
  const [log, warn] = [console.log, console.warn];
  console.log = console.warn = () => {};
  try {
    return fn();
  } finally {
    [console.log, console.warn] = [log, warn];
  }
};

after(() => {
  S.db().close();
  rmSync(dir, { recursive: true, force: true });
});

test("requesting a reset reveals nothing and changes nothing until approved", () => {
  const unknown = R.requestPasswordReset("nobody@example.com", { ip: "198.51.100.7" });
  const known = R.requestPasswordReset("Alice@AutoNeural.in", { ip: "198.51.100.7" });
  assert.deepEqual(unknown, known, "identical answer for unknown and real accounts");
  R.requestPasswordReset("alice@autoneural.in", { ip: "198.51.100.7" }); // repeat: still one request
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].email, "alice@autoneural.in");
  assert.ok(S.login("alice@autoneural.in", "Alice-own-password-2026"), "old password still works until approval");
});

test("only admins see and act on requests; any admin can approve an employee's reset", async () => {
  assert.throws(() => R.listPasswordResets(bob), /administrator/i);
  const [req] = pending(admin2);
  assert.equal(req.canApprove, true);
  await assert.rejects(R.approvePasswordReset(bob, req.id), (e: AppError) => e.status === 403);

  const { token } = S.login("alice@autoneural.in", "Alice-own-password-2026");
  const res = await quiet(() => R.approvePasswordReset(admin2, req.id));
  // No email provider in tests, so the approving admin is shown the password to hand over.
  assert.equal(res.emailed, false);
  assert.ok(res.password && res.password.length >= 12);
  assert.equal(S.userForToken(token), null, "every session is signed out");
  assert.throws(() => S.login("alice@autoneural.in", "Alice-own-password-2026"), /incorrect/);
  const { user } = S.login("alice@autoneural.in", res.password!);
  assert.equal(user.mustChange, true, "the temporary password must be changed at sign-in");
  await assert.rejects(R.approvePasswordReset(master, req.id), /already been handled/);
  assert.equal(pending().length, 0);
});

test("an administrator's reset needs the master admin; nobody resets the master admin in the app", async () => {
  R.requestPasswordReset("admin2@autoneural.in", { ip: "198.51.100.8" });
  const [req] = pending(master);
  assert.equal(req.role, "admin");
  assert.equal(pending(admin2).length, 1);
  assert.equal(pending(admin2)[0].canApprove, false, "an admin cannot approve their own reset");
  await assert.rejects(R.approvePasswordReset(admin2, req.id), (e: AppError) => e.status === 403);
  assert.ok((await quiet(() => R.approvePasswordReset(master, req.id))).password);

  quiet(() => R.requestPasswordReset("info@autoneural.in", { ip: "198.51.100.8" }));
  assert.equal(pending().length, 0, "master admin requests are never queued");
});

test("requests can be rejected, and are cancelled when the person signs in or is reset directly", () => {
  R.requestPasswordReset("bob@autoneural.in", { ip: "198.51.100.9" });
  R.rejectPasswordReset(master, pending()[0].id);
  assert.equal(pending().length, 0);
  assert.ok(S.login("bob@autoneural.in", "Bob-own-password-2026"), "a rejected request changes nothing");

  S.db().prepare("DELETE FROM attempts").run();
  R.requestPasswordReset("bob@autoneural.in", { ip: "198.51.100.9" });
  R.cancelPendingResets(bob.id, "signed-in"); // what POST /api/auth does after a successful sign-in
  assert.equal(pending().length, 0);
});

test("requests are rate limited per IP, and silently per account", () => {
  S.db().prepare("DELETE FROM attempts").run();
  for (let i = 0; i < 10; i++) R.requestPasswordReset(`someone${i}@example.com`, { ip: "203.0.113.50" });
  assert.throws(() => R.requestPasswordReset("x@example.com", { ip: "203.0.113.50" }), (e: AppError) => e.status === 429);
  S.db().prepare("DELETE FROM attempts").run();
  for (let i = 0; i < 5; i++) R.requestPasswordReset("bob@autoneural.in", { ip: `203.0.113.${60 + i}` });
  assert.equal(pending().length, 1, "still a single pending request");
});

test("the master admin is recovered on the server, once per CRM_MASTER_ADMIN_RESET_PASSWORD value", () => {
  process.env.CRM_MASTER_ADMIN_RESET_PASSWORD = "server-recovery-password-2026";
  quiet(() => S.recoverMasterAdmin(S.db()));
  const { user } = S.login("info@autoneural.in", "server-recovery-password-2026");
  assert.equal(user.mustChange, true);
  S.changePassword(user, "server-recovery-password-2026", "master-admin-new-password-2026");
  quiet(() => S.recoverMasterAdmin(S.db())); // e.g. a restart with the variable still set
  assert.ok(S.login("info@autoneural.in", "master-admin-new-password-2026"), "the same value is not applied twice");
  delete process.env.CRM_MASTER_ADMIN_RESET_PASSWORD;
});
