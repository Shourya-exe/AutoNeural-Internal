import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTaskAssignedEmail,
  renderTaskCompletedEmail,
  renderTaskCommentEmail,
  sendEmail,
  getEmailServiceStatus,
  getRecentEmailLogs,
} from "../src/lib/email";

test("renderTaskAssignedEmail generates correct content and headers", () => {
  const rendered = renderTaskAssignedEmail({
    task: {
      id: "task-uuid-123",
      title: "Design System Migration",
      description: "Migrate all CSS variables to the unified dark theme.",
      priority: "High",
      dueDate: "2026-10-15",
      project: "Design Engine",
    },
    employee: {
      name: "Rajashi Dey",
      email: "rajashi@autoneural.in",
    },
    admin: {
      name: "Shourya Kumar",
      email: "shourya@autoneural.in",
    },
    appUrl: "https://work.autoneural.in",
  });

  assert.equal(
    rendered.subject,
    "[AutoNeural Workspace] New Task Assigned: Design System Migration",
  );
  assert.ok(rendered.html.includes("Rajashi Dey"));
  assert.ok(rendered.html.includes("Shourya Kumar"));
  assert.ok(rendered.html.includes("Design System Migration"));
  assert.ok(rendered.html.includes("badge-high"));
  assert.ok(rendered.html.includes("https://work.autoneural.in?task=task-uuid-123"));
  assert.ok(rendered.text.includes("shourya@autoneural.in"));
});

test("renderTaskCompletedEmail generates correct content and reply notice", () => {
  const rendered = renderTaskCompletedEmail({
    task: {
      id: "task-uuid-456",
      title: "Hostinger Passenger Deployment",
      project: "Infrastructure",
      completedAt: "2026-09-17T18:00:00.000Z",
    },
    employee: {
      name: "Manyu Sharma",
      email: "manyu@autoneural.in",
    },
    admin: {
      name: "AutoNeural Admin",
      email: "info@autoneural.in",
    },
    appUrl: "https://work.autoneural.in",
  });

  assert.equal(
    rendered.subject,
    "[AutoNeural Workspace] Task Completed: Hostinger Passenger Deployment",
  );
  assert.ok(rendered.html.includes("Manyu Sharma"));
  assert.ok(rendered.html.includes("AutoNeural Admin"));
  assert.ok(rendered.html.includes("Completed"));
  assert.ok(rendered.html.includes("https://work.autoneural.in?task=task-uuid-456"));
  assert.ok(rendered.html.includes("manyu@autoneural.in"));
});

test("renderTaskCommentEmail includes comment text and author details", () => {
  const rendered = renderTaskCommentEmail({
    task: {
      id: "task-uuid-789",
      title: "Client Onboarding Deck",
      project: "Sales",
    },
    author: {
      name: "Warrior Biswas",
      email: "warriorbiswas@autoneural.in",
    },
    commentText: "Uploaded the revised PDF proposal. Ready for final approval.",
    recipient: {
      name: "Shourya Kumar",
      email: "shourya@autoneural.in",
    },
    appUrl: "https://work.autoneural.in",
  });

  assert.equal(
    rendered.subject,
    '[AutoNeural Workspace] New comment on "Client Onboarding Deck" by Warrior Biswas',
  );
  assert.ok(rendered.html.includes("Uploaded the revised PDF proposal"));
  assert.ok(rendered.html.includes("Warrior Biswas"));
  assert.ok(rendered.html.includes("https://work.autoneural.in?task=task-uuid-789"));
});

test("sendEmail logs to recent logs in simulated mode", async () => {
  const res = await sendEmail({
    to: "test-receiver@autoneural.in",
    subject: "Unit Test Email",
    html: "<p>Hello unit test</p>",
    replyTo: "test-reply@autoneural.in",
  });

  assert.equal(res.success, true);
  assert.ok(res.id);

  const logs = getRecentEmailLogs();
  const latest = logs.find((l) => l.subject === "Unit Test Email");
  assert.ok(latest);
  assert.deepEqual(latest?.to, ["test-receiver@autoneural.in"]);
  assert.equal(latest?.replyTo, "test-reply@autoneural.in");
});

test("getEmailServiceStatus provides valid configuration object", () => {
  const status = getEmailServiceStatus();
  assert.ok(["resend", "emailjs", "simulated"].includes(status.provider));
  assert.equal(typeof status.configured, "boolean");
  assert.ok(status.fromEmail.length > 0);
});
