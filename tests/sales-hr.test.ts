import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupAccounts, allUsers, createEmployee, db, taskDetails } from "../src/lib/store";
import { addLeads, listLeads, jsonToLeads, rotateIntakeKey } from "../src/lib/leads";
import * as S from "../src/lib/sales";
import * as H from "../src/lib/hr";
import { GET as intakeGet, POST as intakePost } from "../src/app/api/leads/intake/route";
const dir = mkdtempSync(join(tmpdir(), "autoneural-sales-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");

setupAccounts();
const admin = allUsers().find((u) => u.email === "info@autoneural.in")!;
const id1 = createEmployee(admin, { name: "Sales One", email: "s1@autoneural.in" }).id;
const id2 = createEmployee(admin, { name: "Sales Two", email: "s2@autoneural.in" }).id;
const e1 = allUsers().find((u) => u.id === id1)!;
const e2 = allUsers().find((u) => u.id === id2)!;
after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

test("GST: CGST+SGST within the state, IGST across states", () => {
  S.saveCompany(admin, { name: "AutoNeural", state: "West Bengal", upiId: "autoneural@okicici" });
  const items = [{ description: "Website", hsn: "998314", qty: 1, rate: 10_000, gst: 18 }];
  assert.deepEqual(S.totals(items, "West Bengal"), { subtotal: 10_000, tax: 1800, total: 11_800, igst: 0, cgst: 900, sgst: 900 });
  assert.equal(S.totals(items, "Maharashtra").igst, 1800);
});

test("quote → online accept → invoice → UPI + payment → lead Won", () => {
  const { leadIds } = addLeads([{ externalId: "t:q1", name: "Priya", phone: "9876543210", email: "p@x.com", service: "Website" }], "Manual");
  const lead = listLeads(admin).find((l) => l.id === leadIds[0])!;
  const q = S.createDocument(admin, { kind: "quote", leadId: lead.id, customer: { name: "Priya", email: "p@x.com", state: "West Bengal" }, items: [{ description: "Website", qty: 1, rate: 10_000, gst: 18 }] });
  assert.match(q.number, /^QT-\d{4}-0001$/);
  assert.equal(listLeads(admin).find((l) => l.id === lead.id)!.status, "Proposal");
  S.acceptQuote(q.token);
  assert.equal(S.documentByToken(q.token)!.status, "Accepted");
  const inv = S.convertToInvoice(admin, q.id);
  assert.equal(S.convertToInvoice(admin, q.id).id, inv.id, "converting twice returns the same invoice");
  assert.match(S.upiLink(inv)!, /^upi:\/\/pay\?pa=autoneural%40okicici&pn=AutoNeural&am=11800\.00&cu=INR&tn=INV-/);
  S.recordPayment(inv.id, 5000, "UPI", "utr-1", admin.id);
  assert.equal(S.getDocument(admin, inv.id).status, "Partially paid");
  assert.deepEqual(S.recordPayment(inv.id, 5000, "UPI", "utr-1", admin.id), { duplicate: true });
  S.recordPayment(inv.id, 6800, "Bank transfer", "utr-2", admin.id);
  assert.equal(S.getDocument(admin, inv.id).status, "Paid");
  assert.equal(listLeads(admin).find((l) => l.id === lead.id)!.status, "Won");
  const comments = taskDetails(admin, lead.taskId!).comments.map((c: { text: string }) => c.text).join("\n");
  assert.match(comments, /accepted quotation QT-/);
  assert.match(comments, /Paid\./);
});

test("payment webhooks verify signatures before marking invoices paid", () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = "rzp-secret";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const inv = S.createDocument(admin, { kind: "invoice", customer: { name: "Anil" }, items: [{ description: "CRM", qty: 1, rate: 1000, gst: 0 }] });
  const rzp = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { notes: { documentId: inv.id } } }, payment: { entity: { id: "pay_1", amount: 100_000 } } } });
  assert.throws(() => S.handleRazorpayWebhook(rzp, "bad"), /signature/);
  S.handleRazorpayWebhook(rzp, createHmac("sha256", "rzp-secret").update(rzp).digest("hex"));
  assert.equal(S.getDocument(admin, inv.id).status, "Paid");

  const inv2 = S.createDocument(admin, { kind: "invoice", customer: { name: "Kavita" }, items: [{ description: "Bot", qty: 1, rate: 500, gst: 0 }] });
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", amount_total: 50_000, metadata: { documentId: inv2.id } } } });
  const t = Math.floor(Date.now() / 1000);
  assert.throws(() => S.handleStripeWebhook(body, `t=${t},v1=deadbeef`), /signature/);
  S.handleStripeWebhook(body, `t=${t},v1=${createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex")}`);
  assert.equal(S.getDocument(admin, inv2.id).status, "Paid");
});

test("deals: lost needs a reason; tickets link to the lead", () => {
  const lead = listLeads(admin)[0];
  assert.throws(() => S.updateDeal(admin, { id: lead.id, status: "Lost" }), /reason/);
  S.updateDeal(admin, { id: lead.id, status: "Lost", lostReason: "Budget" });
  S.createTicket(admin, { customerName: "Priya", phone: "+91 98765 43210", subject: "Site is down", description: "Since morning" });
  const t = S.listTickets(admin)[0];
  assert.equal(t.leadId, lead.id);
  S.updateTicket(admin, { id: t.id, status: "Resolved", note: "Restarted the server" });
  assert.equal(S.listTickets(admin)[0].updates.at(-1).text, "Status → Resolved. Restarted the server");
});

test("leave: balance check, and approved leave re-routes that person's new leads", () => {
  H.hdb();
  const { leadIds } = addLeads([{ externalId: "t:r1", name: "Route Me", phone: "9800000123" }], "Manual");
  const lead = listLeads(admin).find((l) => l.id === leadIds[0])!;
  const away = lead.ownerId === e1.id ? e1 : e2;
  assert.throws(() => H.applyLeave(away, { type: "Casual", fromDate: today, toDate: "2099-12-31", reason: "Long trip" }), /left this year|holidays/);
  let rerouted: number;
  if (new Date(`${today}T00:00:00Z`).getUTCDay() === 0) {
    // Sunday is a weekly off, so a leave request for today is (correctly) refused; record the approved leave directly.
    assert.throws(() => H.applyLeave(away, { type: "Sick", fromDate: today, toDate: today, reason: "Fever" }), /holidays or weekly offs/);
    db().prepare("INSERT INTO leaves VALUES(?,?,?,?,?,?,?,'Approved',?,NULL,?)").run("sunday-leave", away.id, "Sick", today, today, 1, "Fever", admin.id, new Date().toISOString());
    rerouted = H.rerouteLeadsOnLeave();
  } else {
    H.applyLeave(away, { type: "Sick", fromDate: today, toDate: today, reason: "Fever" });
    const req = (H.listLeaves(admin) as { id: string }[])[0];
    rerouted = H.reviewLeave(admin, { id: req.id, status: "Approved" }).rerouted;
  }
  assert.equal(rerouted >= 1, true);
  const moved = listLeads(admin).find((l) => l.id === lead.id)!;
  assert.notEqual(moved.ownerId, away.id);
  assert.equal(taskDetails(admin, moved.taskId!).task.assigneeId, moved.ownerId);
});

test("payroll: prorated by attendance, statutory deductions, claims reimbursed once", () => {
  H.savePolicy(admin, { leaveQuota: { Casual: 12, Sick: 12, Earned: 15 }, workWeek: 5, holidays: [], pf: true, esi: true, professionalTax: 200, office: null });
  H.saveProfile(admin, { userId: e2.id, monthlySalary: 20_000 });
  const month = "2026-02"; // 20 weekdays
  for (const d of ["02", "03", "04", "05", "06", "09", "10", "11", "12", "13"]) {
    db().prepare("INSERT INTO attendance(id,userId,day,inAt) VALUES(?,?,?,?)").run(`a${d}`, e2.id, `${month}-${d}`, `${month}-${d}T04:00:00Z`);
  }
  H.submitClaim(e2, { spentOn: "2026-02-10", category: "Fuel", amount: 450, description: "Client visit" });
  const claim = (H.listClaims(admin) as { id: string }[])[0];
  H.reviewClaim(admin, { id: claim.id, status: "Approved" });
  const slip = H.computePayslip(e2.id, month);
  assert.equal(slip.workingDays, 20);
  assert.equal(slip.presentDays, 10);
  assert.equal(slip.lopDays, 10);
  assert.equal(slip.earnings.gross, 10_000);
  assert.equal(slip.deductions.pf, 600); // 12% of basic 5,000
  assert.equal(slip.deductions.esi, 75); // 0.75% of 10,000
  assert.equal(slip.reimbursements, 450);
  assert.equal(slip.net, 10_000 - 600 - 75 - 200 + 450);
  const run = H.runPayroll(admin, { month });
  H.finalizePayroll(admin, run.runId);
  assert.equal(H.computePayslip(e2.id, month).reimbursements, 0, "paid claims are not reimbursed twice");
  assert.equal(H.listPayroll(e2)[0].payslips.length, 1, "employee sees their finalized payslip");
});

test("attendance: selfie + GPS clock-in once a day, office radius flag", () => {
  H.savePolicy(admin, { ...H.policy(), office: { lat: 22.5726, lng: 88.3639, radiusM: 300 } });
  const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  assert.throws(() => H.clockIn(e1, { lat: 22.5726, lng: 88.3639 }), /selfie/i);
  assert.deepEqual(H.clockIn(e1, { lat: 22.5727, lng: 88.364, photo }), { ok: true, inOffice: 1 });
  assert.throws(() => H.clockIn(e1, { lat: 22.5, lng: 88.3, photo }), /already/);
  H.clockOut(e1, { lat: 22.6, lng: 88.4 });
  assert.equal(H.attendanceDay(admin).records.length, 1);
});

test("lead sources: Google Ads webhook, JustDial GET push, JSON portal feeds", async () => {
  const key = rotateIntakeKey(admin);
  const g = await intakePost(
    new Request("https://w/api/leads/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_id: "gl-1", google_key: key, user_column_data: [{ column_id: "FULL_NAME", string_value: "Google Lead" }, { column_id: "PHONE_NUMBER", string_value: "+919811100000" }] }),
    }),
  );
  assert.equal(g.status, 200);
  const jd = await intakeGet(new Request(`https://w/api/leads/intake?key=${key}&name=JD%20Lead&mobile=9822200000&category=Interiors&leadid=jd-9`));
  assert.equal(await jd.text(), "RECEIVED");
  const names = listLeads(admin).map((l) => l.name);
  assert.ok(names.includes("Google Lead") && names.includes("JD Lead"));
  const feed = jsonToLeads(JSON.stringify({ data: [{ rfi_id: "77", sender_name: "Trade Buyer", sender_mobile: "9833300000", product_name: "Steel" }] }), { url: "https://x.com/api?from_date=1", label: "TradeIndia" });
  assert.deepEqual([feed[0].name, feed[0].service, feed[0].externalId.endsWith(":77")], ["Trade Buyer", "Steel", true]);
});

test("AI: business questions and email drafts send workspace data to Gemini (stubbed)", async () => {
  const { askBusiness, draftEmail } = await import("../src/lib/ai");
  process.env.GOOGLE_API_KEY = "test";
  const sent: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    sent.push(String(init.body));
    const json = String(init.body).includes("application/json");
    return Response.json({ candidates: [{ content: { parts: [{ text: json ? '{"subject":"Hi","body":"Hello"}' : "Pipeline is healthy." }] } }] });
  }) as typeof fetch;
  try {
    assert.equal((await askBusiness(admin, "How is our pipeline?")).answer, "Pipeline is healthy.");
    assert.equal((await askBusiness(e1, "How am I doing?")).answer, "Pipeline is healthy.", "employee-scoped snapshot works");
    assert.match(sent[1], /only Sales One's leads/);
    const lead = listLeads(admin)[0];
    assert.deepEqual(await draftEmail(admin, { leadId: lead.id, purpose: "Follow up" }), { subject: "Hi", body: "Hello" });
  } finally {
    globalThis.fetch = orig;
  }
});
