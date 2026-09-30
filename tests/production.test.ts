import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import { AppError } from "../src/lib/errors";
import * as S from "../src/lib/store";
import { saveUpload, readStoredFile } from "../src/lib/files";
import { sendEmail, renderTaskCommentEmail } from "../src/lib/email";
import { sameOrigin, failure } from "../src/lib/http";
import { addLeads, listLeads } from "../src/lib/leads";
import * as Sales from "../src/lib/sales";
import { recordWhatsAppRequest } from "../src/lib/voice";
import { POST as inboundMail } from "../src/app/api/mail/inbound/route";
import { GET as health } from "../src/app/api/health/route";
import { GET as unsubscribePage, POST as unsubscribePost } from "../src/app/api/unsubscribe/route";

const dir = mkdtempSync(join(tmpdir(), "autoneural-prod-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");
process.env.CRM_UPLOAD_DIR = join(dir, "uploads");
process.env.WORKFLOW_AUTORUN = "0";
delete process.env.CRM_ADMIN_BOOTSTRAP_PASSWORD;


// A brand-new database has no accounts and creates none on its own.
assert.equal(S.setupRequired(), true);
S.setupAccounts();
const admin = S.allUsers().find((u) => u.email === "info@autoneural.in")!;
const aliceId = S.createEmployee(admin, { name: "Alice", email: "alice@autoneural.in" }).id;
const bobId = S.createEmployee(admin, { name: "Bob", email: "bob@autoneural.in" }).id;
const alice = S.allUsers().find((u) => u.id === aliceId)!;
const bob = S.allUsers().find((u) => u.id === bobId)!;
const password = (userId: string) => S.resetPassword(admin, userId);
const task = S.createTask(admin, { title: "Design the brochure", assigneeId: alice.id, dueDate: "2026-12-01" });

const asProduction = async <T>(fn: () => Promise<T> | T) => {
  const env = process.env as Record<string, string | undefined>;
  const prev = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    return await fn();
  } finally {
    env.NODE_ENV = prev;
  }
};

after(() => {
  S.db().close();
  rmSync(dir, { recursive: true, force: true });
});

test("a deactivated employee can neither sign in nor keep using an existing session", () => {
  const pw = password(bob.id);
  const { token } = S.login(bob.email, pw);
  assert.ok(S.userForToken(token));
  S.db().prepare("UPDATE users SET status='INACTIVE' WHERE id=?").run(bob.id);
  assert.equal(S.userForToken(token), null, "session stops working");
  assert.throws(() => S.login(bob.email, pw), /deactivated/);
  S.db().prepare("UPDATE users SET status='ACTIVE' WHERE id=?").run(bob.id);
});

test("login is throttled per IP across different accounts, and successes don't count", () => {
  const ctx = { ip: "203.0.113.9" };
  const pw = password(alice.id);
  for (let i = 0; i < 5; i++) S.login(alice.email, pw, ctx); // successful sign-ins never use up the budget
  for (let i = 0; i < 50; i++) assert.throws(() => S.login(`nobody${i}@example.com`, "wrong", ctx), /incorrect/);
  assert.throws(() => S.login("someone-else@example.com", "wrong", ctx), (e: AppError) => e.status === 429);
  // Another IP, and requests without a proxy-supplied IP, are unaffected.
  assert.throws(() => S.login("someone-else@example.com", "wrong", { ip: "198.51.100.1" }), /incorrect/);
  assert.throws(() => S.login("someone-else@example.com", "wrong", { ip: "unknown" }), /incorrect/);
  S.db().prepare("DELETE FROM attempts").run();
});

test("uploaded files are stored on disk, served only to people who can open the task, and removed with it", async () => {
  const pdf = new File([Buffer.from("%PDF-1.7\n% test document\n")], "Brief.pdf", { type: "application/pdf" });
  const stored = await saveUpload(pdf);
  const att = S.attachTaskFile(alice, task.id, stored, { name: "Client brief", purpose: "FOR_APPROVAL" });
  assert.equal(att.url, `/api/attachments/${att.id}`);
  const details = S.taskDetails(admin, task.id);
  const row = details.attachments.find((a) => a.id === att.id)!;
  assert.equal(row.name, "Client brief.pdf", "keeps the real extension");
  assert.equal(row.approvalStatus, "PENDING");
  assert.equal(details.task.status, "In review", "submitting for approval moves the task into review");

  const file = S.attachmentFile(admin, att.id);
  assert.equal(file.mime, "application/pdf");
  const { size, body } = readStoredFile(file.key);
  assert.equal(Buffer.from(await new Response(body).arrayBuffer()).toString("latin1").slice(0, 8), "%PDF-1.7");
  assert.equal(size, pdf.size);
  assert.throws(() => S.attachmentFile(bob, att.id), /not found/i, "other employees cannot download it");

  S.approveTaskSubmission(admin, att.id, "Looks good");
  assert.throws(() => S.approveTaskSubmission(admin, att.id), /already been reviewed/);

  const path = join(process.env.CRM_UPLOAD_DIR!, ...file.key.split("/"));
  assert.ok(existsSync(path));
  S.deleteTaskAttachment(alice, att.id);
  assert.equal(existsSync(path), false, "deleting the attachment deletes the file");

  const again = await saveUpload(new File([Buffer.from("%PDF-1.4")], "x.pdf"));
  S.attachTaskFile(admin, task.id, again, {});
  const againPath = join(process.env.CRM_UPLOAD_DIR!, ...again.key.split("/"));
  const temp = S.createTask(admin, { title: "Temporary task", assigneeId: alice.id, dueDate: "2026-12-01" });
  const onTemp = await saveUpload(new File([Buffer.from("hello")], "notes.txt"));
  S.attachTaskFile(admin, temp.id, onTemp, {});
  S.deleteTask(admin, temp.id);
  assert.equal(existsSync(join(process.env.CRM_UPLOAD_DIR!, ...onTemp.key.split("/"))), false, "deleting a task deletes its files");
  assert.ok(existsSync(againPath), "other tasks' files are untouched");
});

test("uploads are checked by type and content", async () => {
  await assert.rejects(saveUpload(new File([Buffer.from("<script>alert(1)</script>")], "page.html")), /not supported/);
  await assert.rejects(saveUpload(new File([Buffer.from("<svg onload=alert(1)>")], "logo.svg")), /not supported/);
  await assert.rejects(saveUpload(new File([Buffer.from("not really a png")], "photo.png")), /do not match/);
  await assert.rejects(saveUpload(new File([], "empty.pdf")), /empty/);
});

test("link attachments must be http(s)", () => {
  assert.throws(() => S.attachTaskLink(alice, task.id, { name: "x", url: "javascript:alert(1)" }), /http/);
  assert.throws(() => S.attachTaskLink(alice, task.id, { name: "x", url: "data:text/html,hi" }), /http/);
  assert.ok(S.attachTaskLink(alice, task.id, { name: "Figma", url: "https://figma.com/file/abc" }).ok);
  assert.throws(() => S.attachTaskLink(alice, task.id, { name: "x", url: "https://a.b", purpose: "HACK" }), /Choose what this attachment is for/);
});

test("outgoing email HTML escapes user-supplied text", () => {
  const html = renderTaskCommentEmail({
    task: { id: "t1", title: 'Quote <img src=x onerror="alert(1)">', project: "" },
    author: { name: "<b>Mallory</b>", email: "m@example.com" },
    commentText: "<script>steal()</script>",
    recipient: { name: "Admin", email: "info@autoneural.in" },
    appUrl: "https://work.autoneural.in",
  }).html;
  assert.ok(!html.includes("<script>steal()"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;steal()&lt;/script&gt;"));
});

test("production never reports an unsent email as sent", async () => {
  const r = await asProduction(() => sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" }));
  assert.equal(r.success, false);
  assert.equal(r.notConfigured, true);
  // Outside recipient: an error, and nothing appears in the Sent folder.
  const before = S.getEmailsForUser(admin, "sent").length;
  await asProduction(() =>
    assert.rejects(S.sendUserEmail(admin, { to: "client@example.com", subject: "Proposal", body: "Attached." }), (e: AppError) => e.status === 503),
  );
  assert.equal(S.getEmailsForUser(admin, "sent").length, before);
  // Workspace member: delivered to their inbox, and the result says it was not emailed.
  const internal = await asProduction(() => S.sendUserEmail(admin, { to: alice.email, subject: "Standup", body: "10am" }));
  assert.equal(internal.delivery, "workspace");
  assert.ok(S.getEmailsForUser(alice, "inbox").some((m) => m.subject === "Standup"));
});

test("mailbox actions only work on your own messages", async () => {
  const msg = S.getEmailsForUser(alice, "inbox").find((m) => m.subject === "Standup")!;
  await assert.rejects(S.replyToEmail(bob, msg.id, "I can read this?"), /not found/i);
  assert.throws(() => S.markEmailSeen(bob, msg.id, "read"), /not found/i);
  S.markEmailSeen(alice, msg.id, "read");
  S.markEmailSeen(alice, msg.id, "unread");
  assert.equal(S.getEmailsForUser(alice, "inbox").find((m) => m.id === msg.id)!.status, "unread", "can be marked unread again");
});

test("inbound email webhook requires its secret and only accepts mail for workspace members", async () => {
  const post = (body: unknown, auth?: string) =>
    inboundMail(
      new Request("https://work.autoneural.in/api/mail/inbound", {
        method: "POST",
        headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const mail = { from: "Client <client@acme.com>", to: alice.email, subject: "Invoice", text: "Please see attached." };
  assert.equal((await post(mail)).status, 503, "disabled until configured");
  process.env.MAIL_INBOUND_SECRET = "inbound-secret-for-tests-123456";
  assert.equal((await post(mail)).status, 401);
  assert.equal((await post(mail, "wrong")).status, 401);
  assert.equal((await post(mail, "inbound-secret-for-tests-123456")).status, 201);
  assert.ok(S.getEmailsForUser(alice, "inbox").some((m) => m.subject === "Invoice" && m.senderName === "Client"));
  assert.equal((await post({ ...mail, to: "stranger@example.com" }, "inbound-secret-for-tests-123456")).status, 202);
  assert.equal((await post({ data: { ...mail, subject: "Resend format" } }, "inbound-secret-for-tests-123456")).status, 201);
});

test("CSRF origin check trusts only this app's origin, not sibling subdomains", () => {
  const prev = { url: process.env.CRM_APP_URL, extra: process.env.CRM_ALLOWED_ORIGINS };
  process.env.CRM_APP_URL = "https://work.autoneural.in";
  const req = (origin: string) => new Request("https://work.autoneural.in/api/workspace", { method: "POST", headers: { origin, host: "work.autoneural.in" } });
  try {
    assert.doesNotThrow(() => sameOrigin(req("https://work.autoneural.in")));
    assert.throws(() => sameOrigin(req("https://crm.autoneural.in")), /not allowed/);
    assert.throws(() => sameOrigin(req("https://evil.autoneural.in")), /not allowed/);
    process.env.CRM_ALLOWED_ORIGINS = "https://crm.autoneural.in";
    assert.doesNotThrow(() => sameOrigin(req("https://crm.autoneural.in")));
  } finally {
    process.env.CRM_APP_URL = prev.url;
    if (prev.extra === undefined) delete process.env.CRM_ALLOWED_ORIGINS;
    else process.env.CRM_ALLOWED_ORIGINS = prev.extra;
  }
});

test("unexpected errors are logged, not shown to the user", async () => {
  const log = console.error;
  console.error = () => {};
  try {
    const res = failure(new Error("SQLITE_CONSTRAINT: secret table detail"));
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes("SQLITE"));
  } finally {
    console.error = log;
  }
  assert.equal(failure(new AppError(404, "Task not found.")).status, 404);
});

test("meetings and dashboard totals are limited to the salesperson's own leads", () => {
  const [mine] = addLeads([{ externalId: "t:prod-1", name: "Mine", phone: "9800011111" }], "Manual").leadIds;
  const lead = listLeads(admin).find((l) => l.id === mine)!;
  const owner = lead.ownerId === alice.id ? alice : bob;
  const other = owner.id === alice.id ? bob : alice;
  assert.ok(Array.isArray(Sales.meetingsFor(owner, mine)));
  assert.throws(() => Sales.meetingsFor(other, mine), /not found/i);
  Sales.createDocument(admin, { kind: "invoice", customer: { name: "Acme" }, items: [{ description: "Work", qty: 1, rate: 1000, gst: 18 }] });
  assert.equal(Sales.salesSummary(other).outstanding.n, 0, "an admin's unrelated invoice is not in a salesperson's totals");
  assert.ok(Sales.salesSummary(admin).outstanding.n >= 1);
});

test("unsubscribe links: GET only confirms; POST opts out; old links still work", async () => {
  const [id] = addLeads([{ externalId: "t:unsub", name: "Unsub", email: "unsub@example.com" }], "Manual").leadIds;
  const url = `https://work.autoneural.in/api/unsubscribe?l=${id}&t=${Sales.unsubscribeToken(id)}`;
  const optOut = () => (S.db().prepare("SELECT optOut FROM leads WHERE id=?").get(id) as { optOut: number }).optOut;
  assert.equal((await unsubscribePage(new Request(url))).status, 200);
  assert.equal(optOut(), 0, "a link scanner opening the link does not unsubscribe");
  assert.equal((await unsubscribePost(new Request(url, { method: "POST" }))).status, 200);
  assert.equal(optOut(), 1);
  assert.equal((await unsubscribePost(new Request(url.replace(/t=[^&]+/, "t=forged"), { method: "POST" }))).status, 400);
  const legacy = createHmac("sha256", "autoneural-unsubscribe").update(id).digest("base64url").slice(0, 22);
  assert.doesNotThrow(() => Sales.unsubscribe(id, legacy));
});

test("call-agent WhatsApp follow-ups are really sent, once, and never to opted-out customers", async () => {
  Object.assign(process.env, { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_FOLLOWUP_TEMPLATE: "call_followup:en" });
  const sent: { url: string; body: any }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return Response.json({ messages: [{ id: `wamid.${sent.length}` }] });
  }) as typeof fetch;
  try {
    addLeads([{ externalId: "t:wa-follow", name: "Priya", phone: "9811100000" }], "Manual");
    const req = { phone: "+919811100000", message: "Here is our brochure link.", confirmed: true, requestId: "req-1" };
    const r = await recordWhatsAppRequest(req);
    assert.equal(r.accepted, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.template.name, "call_followup");
    assert.equal(sent[0].body.template.components[0].parameters[0].text, "Here is our brochure link.");
    assert.deepEqual(await recordWhatsAppRequest(req), r, "a retried request returns the first result");
    assert.equal(sent.length, 1, "and does not send again");

    addLeads([{ externalId: "t:wa-optout", name: "No Thanks", phone: "9811100001" }], "Manual");
    S.db().prepare("UPDATE leads SET optOut=1 WHERE phone='+919811100001'").run();
    const blocked = await recordWhatsAppRequest({ ...req, phone: "+919811100001", requestId: "req-2" });
    assert.equal(blocked.accepted, false);
    assert.match(blocked.error!, /opted out/);
    assert.equal(sent.length, 1);
  } finally {
    globalThis.fetch = orig;
  }
});

test("health check reports database and upload storage", async () => {
  const res = health();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.database, "ok");
  assert.equal(body.uploads, "ok");
  assert.equal(body.setupRequired, false);
});
