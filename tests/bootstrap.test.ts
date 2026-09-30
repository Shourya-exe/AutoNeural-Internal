import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as S from "../src/lib/store";

const dir = mkdtempSync(join(tmpdir(), "autoneural-bootstrap-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");
process.env.CRM_ADMIN_BOOTSTRAP_PASSWORD = "first-login-password-2026";

after(() => {
  S.db().close();
  rmSync(dir, { recursive: true, force: true });
});

test("an empty database creates the master admin from CRM_ADMIN_BOOTSTRAP_PASSWORD, who must change it", () => {
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(S.setupRequired(), false);
  } finally {
    console.log = log;
  }
  assert.throws(() => S.login("info@autoneural.in", "some-other-password"), /incorrect/);
  const { user } = S.login("info@autoneural.in", "first-login-password-2026");
  assert.equal(user.role, "admin");
  assert.equal(user.mustChange, true);
  assert.throws(() => S.setupAccounts(), /already exist/);
});
