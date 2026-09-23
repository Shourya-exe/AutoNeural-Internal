import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  setupAccounts,
  allUsers,
  db,
  createEmployee,
  sendUserEmail,
  replyToEmail,
  markEmailSeen,
  getEmailsForUser,
  getEmailThread,
  unreadEmailCount,
  recordInboundEmail,
} from "../src/lib/store";

const dir = mkdtempSync(join(tmpdir(), "autoneural-mail-test-"));
process.env.CRM_DATABASE_PATH = join(dir, "mail_test.sqlite");

setupAccounts();
const initialUsers = allUsers();
const admin = initialUsers.find((u) => u.email === "info@autoneural.in")!;
const shourya = initialUsers.find((u) => u.email === "shourya@autoneural.in")!;

const emp1Res = createEmployee(admin, {
  name: "Employee Alice",
  email: "alice@autoneural.in",
  role: "employee",
});
const emp2Res = createEmployee(admin, {
  name: "Employee Bob",
  email: "bob@autoneural.in",
  role: "employee",
});

const users = allUsers();
const alice = users.find((u) => u.id === emp1Res.id)!;
const bob = users.find((u) => u.id === emp2Res.id)!;

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

test("Admin sends direct domain email to employee; employee receives in Inbox as unread", async () => {
  assert.equal(unreadEmailCount(alice), 0);

  const sent = await sendUserEmail(shourya, {
    to: alice.email,
    subject: "Q4 Roadmap Discussion",
    body: "Hi Alice, let's schedule our quarterly roadmap review tomorrow at 3 PM.",
  });

  assert.equal(sent.subject, "Q4 Roadmap Discussion");
  assert.equal(sent.direction, "OUTBOUND");
  assert.equal(sent.senderEmail, "shourya@autoneural.in");
  assert.equal(sent.recipientEmail, "alice@autoneural.in");

  // Verify Alice has 1 unread email in inbox
  assert.equal(unreadEmailCount(alice), 1);
  const aliceInbox = getEmailsForUser(alice, "inbox");
  assert.equal(aliceInbox.length, 1);
  assert.equal(aliceInbox[0].subject, "Q4 Roadmap Discussion");
  assert.equal(aliceInbox[0].status, "unread");
  assert.equal(aliceInbox[0].direction, "INBOUND");

  // Shourya sees 1 email in sent folder
  const shouryaSent = getEmailsForUser(shourya, "sent");
  assert.equal(shouryaSent.length, 1);
  assert.equal(shouryaSent[0].id, sent.id);
});

test("Employee opens and marks email as seen; unread counter drops", () => {
  const aliceInbox = getEmailsForUser(alice, "inbox");
  const unreadMsg = aliceInbox[0];

  assert.equal(unreadEmailCount(alice), 1);
  markEmailSeen(alice, unreadMsg.id, "read");

  assert.equal(unreadEmailCount(alice), 0);
  const updatedInbox = getEmailsForUser(alice, "inbox");
  assert.equal(updatedInbox[0].status, "read");
  assert.ok(updatedInbox[0].seenAt);
});

test("Employee replies to email; conversation threads together", async () => {
  const aliceInbox = getEmailsForUser(alice, "inbox");
  const originalMsg = aliceInbox[0];

  const reply = await replyToEmail(alice, originalMsg.id, "Sounds great Shourya! I will prepare the presentation slides.");

  assert.equal(reply.direction, "OUTBOUND");
  assert.equal(reply.subject, "Re: Q4 Roadmap Discussion");
  assert.equal(reply.threadId, originalMsg.threadId);
  assert.equal(reply.inReplyTo, originalMsg.id);

  // Shourya receives reply in inbox
  const shouryaInbox = getEmailsForUser(shourya, "inbox");
  assert.equal(shouryaInbox.length, 1);
  assert.equal(shouryaInbox[0].subject, "Re: Q4 Roadmap Discussion");
  assert.equal(shouryaInbox[0].senderEmail, "alice@autoneural.in");

  // Thread history contains both messages
  const thread = getEmailThread(shourya, originalMsg.threadId);
  assert.ok(thread.length >= 2);
  assert.equal(thread[0].subject, "Q4 Roadmap Discussion");
  assert.equal(thread[1].subject, "Re: Q4 Roadmap Discussion");
});

test("Inbound email webhook ingests external incoming messages", () => {
  const externalMsg = recordInboundEmail({
    fromEmail: "client.partner@acmecorp.com",
    fromName: "Acme Client Partner",
    toEmail: "shourya@autoneural.in",
    subject: "Contract Signed & Deliverables",
    body: "Hi Shourya, we have signed the contract. Looking forward to kick-off.",
  });

  assert.equal(externalMsg.direction, "INBOUND");
  assert.equal(externalMsg.status, "unread");
  assert.equal(externalMsg.recipientEmail, "shourya@autoneural.in");

  const shouryaInbox = getEmailsForUser(shourya, "inbox");
  assert.ok(shouryaInbox.some((m) => m.id === externalMsg.id));
});

test("Mailbox isolation: Bob cannot view Alice's private inbox", () => {
  const bobInbox = getEmailsForUser(bob, "inbox");
  assert.equal(bobInbox.length, 0);

  const bobAll = getEmailsForUser(bob, "all");
  assert.equal(bobAll.length, 0);
});
