import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupAccounts, allUsers, createEmployee, db, taskDetails } from "../src/lib/store";
import * as L from "../src/lib/leads";
import { POST as intake } from "../src/app/api/leads/intake/route";
const dir = mkdtempSync(join(tmpdir(), "autoneural-leads-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");

setupAccounts();
const admin = allUsers().find((u) => u.email === "info@autoneural.in")!;
const e1 = createEmployee(admin, { name: "Sales One", email: "s1@autoneural.in" }).id;
const e2 = createEmployee(admin, { name: "Sales Two", email: "s2@autoneural.in" }).id;
after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (key: string | null, body: string, type = "application/json") =>
  intake(
    new Request("https://work.autoneural.in/api/leads/intake", {
      method: "POST",
      headers: { "content-type": type, ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body,
    }),
  );

test("intake API: key required, leads become call tasks, round-robin, dedupe", async () => {
  assert.equal((await post(null, '{"name":"x","phone":"9800000000"}')).status, 401);
  const key = L.rotateIntakeKey(admin);

  const res = await post(key, JSON.stringify({ leads: [
    { full_name: "Priya Sharma", mobile: "+91 98765 43210", service: "Website", source: "Zapier – Meta form", externalId: "fb-1" },
    { name: "Rahul", phone: "9811111111" },
    { name: "No contact" },
  ] }));
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true, accepted: 2, duplicates: 0, rejected: [{ index: 2, error: "A phone number or email is required." }] });

  const leads = L.listLeads(admin);
  const priya = leads.find((l) => l.name === "Priya Sharma")!;
  assert.equal(priya.phone, "+919876543210");
  assert.equal(priya.sourceDetail, "Zapier – Meta form");
  assert.deepEqual(new Set(leads.map((l) => l.ownerId)), new Set([e1, e2]), "rotates between salespeople");
  const task = taskDetails(admin, priya.taskId!).task;
  assert.equal(task.title, "Call Priya Sharma — Website");
  assert.equal(task.priority, "High");
  assert.equal(task.assigneeId, priya.ownerId);

  // Same externalId: ignored. Same phone, new enquiry: noted on the existing task, no new lead.
  assert.deepEqual(await (await post(key, JSON.stringify({ name: "Priya", phone: "9876543210", externalId: "fb-1" }))).json(), { ok: true, accepted: 0, duplicates: 1, rejected: [] });
  await post(key, JSON.stringify({ name: "Priya S", phone: "09876543210", message: "Also need SEO" }));
  assert.equal(L.listLeads(admin).length, 2);
  assert.match(taskDetails(admin, priya.taskId!).comments.map((c: { text: string }) => c.text).join(), /Also need SEO/);

  // An employee only sees their own leads.
  const s1 = allUsers().find((u) => u.id === e1)!;
  assert.ok(L.listLeads(s1).every((l) => l.ownerId === e1));
});

test("website form post with honeypot and redirect", async () => {
  const key = L.rotateIntakeKey(admin);
  const before = L.listLeads(admin).length;
  const form = new URLSearchParams({ key, name: "Form Lead", phone: "9822222222", _redirect: "https://autoneural.in/thanks" });
  const r = await intake(new Request("https://work.autoneural.in/api/leads/intake", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() }));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "https://autoneural.in/thanks");
  const spam = new URLSearchParams({ key, name: "Bot", phone: "9833333333", _gotcha: "x" });
  await intake(new Request("https://work.autoneural.in/api/leads/intake", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: spam.toString() }));
  const names = L.listLeads(admin).map((l) => l.name);
  assert.equal(names.length, before + 1);
  assert.ok(names.includes("Form Lead") && !names.includes("Bot"));
});

test("CSV parsing and Google Sheet links", () => {
  assert.deepEqual(L.parseCsv('﻿Name,Note\r\n"Sharma, Priya","said ""hi"""\r\n'), [["Name", "Note"], ["Sharma, Priya", 'said "hi"']]);
  assert.equal(L.toCsvUrl("https://docs.google.com/spreadsheets/d/AbC/edit#gid=7"), "https://docs.google.com/spreadsheets/d/AbC/export?format=csv&gid=7");
  for (const bad of ["http://x.com/a.csv", "https://localhost/a", "https://169.254.169.254/x"]) assert.throws(() => L.toCsvUrl(bad));
  const feed = { url: "https://x.com/a.csv", label: "FB" };
  const a = L.csvToLeads("full_name,phone_number,Status\nMeera,p:+919844444444,New\n", feed);
  const b = L.csvToLeads("full_name,phone_number,Status\nMeera,p:+919844444444,Called\n", feed);
  assert.equal(a[0].phone, "+919844444444");
  assert.equal(a[0].externalId, b[0].externalId, "editing an unmapped column does not re-import");
});

test("sheet feed and IndiaMART pulls load leads once and respect throttles", async () => {
  const csv = "Name,Mobile,Service\nSheet Lead,9855555555,CRM\n";
  const fetchImpl = (async (url: string | URL) =>
    String(url).includes("indiamart")
      ? Response.json({ CODE: 200, RESPONSE: [{ UNIQUE_QUERY_ID: "77", QUERY_TYPE: "B", SENDER_NAME: "Anil", SENDER_MOBILE: "+91-9866666666", QUERY_PRODUCT_NAME: "CCTV" }] })
      : new Response(csv, { headers: { "content-type": "text/csv" } })) as typeof fetch;
  const origFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await L.addSheetFeed(admin, { label: "FB leads", url: "https://example.com/leads.csv" });
    await L.connectIndiaMart(admin, "test-indiamart-key");
  } finally {
    globalThis.fetch = origFetch;
  }
  const leads = L.listLeads(admin);
  assert.equal(leads.find((l) => l.name === "Sheet Lead")?.source, "Google Sheet");
  assert.equal(leads.find((l) => l.name === "Anil")?.sourceDetail, "IndiaMART · Buy-lead");

  // Forced again right away: sheet dedupes, IndiaMART refuses to call within 5 minutes.
  const again = await L.pullLeadSources({ force: true, fetchImpl });
  assert.equal(again.sheets.created, 0);
  assert.equal(again.indiamart.skipped, true);
  assert.equal(L.indiamartTime(new Date("2026-09-04T20:15:30Z")), "05-Sep-202601:45:30");
});

test("lead owners setting limits who receives leads", async () => {
  L.setLeadOwners(admin, [e2]);
  const r = L.addLeads([{ externalId: "t:1", name: "Only Two", phone: "9877777777" }], "Manual");
  assert.equal(L.listLeads(admin).find((l) => l.id === r.leadIds[0])?.ownerId, e2);
});
