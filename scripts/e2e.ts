import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium, type Page } from "@playwright/test";
import { setupAccounts, allUsers, db, createTask } from "../src/lib/store";
const directory = mkdtempSync(join(tmpdir(), "autoneural-e2e-"));
process.env.CRM_DATABASE_PATH = join(directory, "crm.sqlite");
const accounts = setupAccounts();
const users = allUsers();
const admin = users.find((u) => u.role === "admin")!;
const base = "http://127.0.0.1:3219";
let server: ChildProcess | undefined,
  output = "";
const outputDir = resolve("output/crm-preview");
mkdirSync(outputDir, { recursive: true });
async function signIn(page: Page, email: string) {
  const account = accounts.find((a) => a.email === email)!;
  await page.goto(base + "/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await page.getByText("Make this account yours.").waitFor();
  const blocked = await page.request.get(base + "/api/workspace");
  assert.equal(blocked.status(), 403);
  await page.getByLabel("Temporary password").fill(account.password);
  await page
    .getByLabel("New password", { exact: true })
    .fill("E2E-unique-new-password-2026");
  await page
    .getByLabel("Confirm new password")
    .fill("E2E-unique-new-password-2026");
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await page
    .getByRole("heading", {
      name: email.startsWith("info")
        ? "A clear view of your team."
        : "Your work, at a glance.",
    })
    .waitFor();
}
async function main() {
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", "3219"],
    {
      env: { ...process.env, CRM_APP_URL: "http://localhost:3219" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout?.on("data", (b) => (output += b.toString()));
  server.stderr?.on("data", (b) => (output += b.toString()));
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      if ((await fetch(base + "/login")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "Server started");
  const browser = await chromium.launch({ headless: true });
  try {
    const errors: string[] = [];
    const ctx = await browser.newContext({
      viewport: { width: 1512, height: 1000 },
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/login");
    await page.screenshot({
      path: join(outputDir, "login-desktop.png"),
      fullPage: true,
    });
    assert.equal(
      (await page.request.get(base + "/api/workspace")).status(),
      401,
    );
    const origin = await page.request.post(base + "/api/auth", {
      headers: { Origin: "https://untrusted.example" },
      data: { email: "info@autoneural.in", password: "wrong" },
    });
    assert.equal(origin.status(), 403);
    await signIn(page, "info@autoneural.in");
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Task name")
      .fill("Prepare the client onboarding checklist");
    await dialog
      .getByLabel("Description")
      .fill(
        "Prepare the checklist and confirm the handoff steps with the team.",
      );
    await dialog.getByLabel("Assign to").selectOption({ label: "Manyu" });
    await dialog.getByLabel("Due date").fill("2026-09-18");
    await dialog.getByLabel("Priority").selectOption("High");
    await dialog.getByLabel("Project / client").fill("Client onboarding");
    await dialog.getByRole("button", { name: "Create & assign task" }).click();
    await page
      .getByRole("button", {
        name: "Prepare the client onboarding checklist",
        exact: false,
      })
      .first()
      .waitFor();
    let data = await (await page.request.get(base + "/api/workspace")).json();
    const task = data.tasks.find(
      (t: { title: string }) =>
        t.title === "Prepare the client onboarding checklist",
    );
    assert.ok(task);
    const employeeContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const employee = await employeeContext.newPage();
    employee.on("pageerror", (e) => errors.push(e.message));
    await signIn(employee, "manyu@autoneural.in");
    assert.equal(
      await employee
        .getByRole("button", { name: "Create task", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await employee.getByRole("button", { name: "Team", exact: true }).count(),
      0,
    );
    const forbidden = await employee.request.post(base + "/api/workspace", {
      headers: { Origin: base },
      data: { action: "create", task: {} },
    });
    assert.equal(forbidden.status(), 403);
    await employee
      .getByRole("button", {
        name: "Prepare the client onboarding checklist",
        exact: false,
      })
      .first()
      .click();
    await employee
      .getByRole("dialog")
      .getByLabel("Task status", { exact: true })
      .selectOption("In progress");
    await employee.getByText("Task status updated.", { exact: true }).waitFor();
    await employee
      .getByLabel("Add a comment")
      .fill("Checklist drafted and ready for the admin to review.");
    await employee.getByRole("button", { name: "Post comment" }).click();
    await employee
      .getByText("Checklist drafted and ready for the admin to review.", {
        exact: true,
      })
      .waitFor();
    await employee
      .getByRole("button", { name: "Mark complete", exact: true })
      .click();
    await employee
      .getByText("Task completed. Nice work!", { exact: true })
      .waitFor();
    await employee.getByRole("button", { name: "Close dialog" }).click();
    await employee.reload();
    await employee
      .getByRole("heading", { name: "Your work, at a glance." })
      .waitFor();
    data = await (await page.request.get(base + "/api/workspace")).json();
    assert.equal(
      data.tasks.find((t: { id: string }) => t.id === task.id).status,
      "Completed",
    );
    assert.equal(
      (
        await (
          await page.request.get(base + `/api/workspace?task=${task.id}`)
        ).json()
      ).comments[0].text,
      "Checklist drafted and ready for the admin to review.",
    );
    const other = users.find((u) => u.email === "rajashi@autoneural.in")!;
    const otherTask = createTask(admin, {
      title: "Review the website copy",
      assigneeId: other.id,
      priority: "Medium",
      dueDate: "2026-09-19",
      project: "Website refresh",
    });
    assert.equal(
      (
        await employee.request.get(base + `/api/workspace?task=${otherTask.id}`)
      ).status(),
      404,
    );
    const examples = [
      [
        "Finalize the September content calendar",
        "rajashi",
        "In progress",
        "High",
        "2026-09-17",
        "Social media",
      ],
      [
        "Test the lead capture automation",
        "shourya",
        "In review",
        "Medium",
        "2026-09-16",
        "Automation",
      ],
      [
        "Follow up on the website proposal",
        "warriorbiswas",
        "To do",
        "Urgent",
        "2026-09-13",
        "Sales",
      ],
      [
        "Prepare this week’s campaign report",
        "manyu",
        "In progress",
        "Medium",
        "2026-09-18",
        "Client reporting",
      ],
      [
        "Update the client handoff guide",
        "shourya",
        "Completed",
        "Low",
        "2026-09-12",
        "Operations",
      ],
      [
        "Review the landing page designs",
        "warriorbiswas",
        "In progress",
        "High",
        "2026-09-20",
        "Website refresh",
      ],
    ];
    for (const [title, local, status, priority, dueDate, project] of examples)
      createTask(admin, {
        title,
        description:
          "Browser verification sample task. Stored only in the isolated test database.",
        assigneeId: users.find((u) => u.email.startsWith(local + "@"))!.id,
        status,
        priority,
        dueDate,
        project,
      });
    await page.reload();
    await page
      .getByRole("heading", { name: "A clear view of your team." })
      .waitFor();
    await page.screenshot({
      path: join(outputDir, "admin-desktop.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Board view", exact: true }).click();
    await page.screenshot({
      path: join(outputDir, "task-board.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Team", exact: true }).click();
    await page
      .getByRole("heading", { name: "Great work starts with a team." })
      .waitFor();
    await page.screenshot({
      path: join(outputDir, "team-desktop.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")!.getBoundingClientRect().right <= 0,
    );

    await page.screenshot({
      path: join(outputDir, "admin-mobile.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Mobile has no page overflow",
    );
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("button", { name: "Tasks", exact: false })
      .first()
      .click();
    await page
      .getByRole("heading", { name: "Every task. One place." })
      .waitFor();
    await employee.reload();
    await employee
      .getByRole("heading", { name: "Your work, at a glance." })
      .waitFor();
    await employee.screenshot({
      path: join(outputDir, "employee-desktop.png"),
      fullPage: true,
    });
    await employee
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await employee.waitForURL("**/login");
    assert.equal(
      (await employee.request.get(base + "/api/workspace")).status(),
      401,
    );
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log(
      "PASS: first-login password change, task creation, employee isolation, comments, completion, persistence, admin visibility, list/board/team navigation, mobile layout, CSRF checks, logout, and no browser errors.",
    );
    console.log(
      "Screenshots saved to output/crm-preview (isolated sample data).",
    );
  } finally {
    await browser.close();
  }
}
main()
  .catch((e) => {
    console.error(e);
    console.error(output.slice(-2000));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((r) => server!.once("exit", r));
    }
    db().close();
    rmSync(directory, { recursive: true, force: true });
  });
