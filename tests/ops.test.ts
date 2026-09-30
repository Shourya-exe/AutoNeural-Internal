import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupAccounts, allUsers, createEmployee, db, taskDetails } from "../src/lib/store";
import { addLeads, listLeads } from "../src/lib/leads";
import * as WA from "../src/lib/whatsapp";
import { agentReply } from "../src/lib/wa-agent";
import * as WF from "../src/lib/workflows";
import { logCall, exotelCallback } from "../src/lib/voice";
import { timeline } from "../src/lib/customer";
import { saveBudgets } from "../src/lib/usage";
import { usedThisMonth } from "../src/lib/platform";
import { POST as webhook } from "../src/app/api/whatsapp/webhook/route";
const dir = mkdtempSync(join(tmpdir(), "autoneural-ops-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");
process.env.WORKFLOW_AUTORUN = "0";
Object.assign(process.env, { WHATSAPP_APP_SECRET: "app-secret", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123", GOOGLE_API_KEY: "g" });

setupAccounts();
const admin = allUsers().find((u) => u.email === "info@autoneural.in")!;
const sid = createEmployee(admin, { name: "Sales One", email: "s1@autoneural.in" }).id;
const sales = allUsers().find((u) => u.id === sid)!;
after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

/** Stub Meta Graph + Gemini. `ai` is what Gemini "returns". */
function stubFetch(ai: unknown) {
  const sent: { url: string; body: any }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ url: String(url), body });
    if (String(url).includes("graph.facebook.com")) return Response.json({ messages: [{ id: `wamid.${Math.random().toString(36).slice(2)}` }] });
    return Response.json({ candidates: [{ content: { parts: [{ text: typeof ai === "string" ? ai : JSON.stringify(ai) }] } }], usageMetadata: { totalTokenCount: 1500 } });
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = orig) };
}
const inbound = (from: string, id: string, text: string, name = "Ravi Kumar") =>
  JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }] });
const signed = (raw: string, secret = "app-secret") =>
  webhook(new Request("https://w/api/whatsapp/webhook", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }, body: raw }));

test("WhatsApp webhook: signed only, new number becomes a lead + conversation, retries ignored, STOP opts out", async () => {
  assert.equal((await signed(inbound("919812300000", "w1", "Hi"), "wrong")).status, 401);
  assert.equal((await signed(inbound("919812300000", "w1", "Hi, need a website"))).status, 200);
  await signed(inbound("919812300000", "w1", "Hi, need a website")); // Meta retry
  const lead = listLeads(admin).find((l) => l.phone === "+919812300000")!;
  assert.equal(lead.name, "Ravi Kumar");
  assert.equal(lead.source, "WhatsApp");
  const conv = WA.listConversations(admin)[0];
  assert.equal(conv.leadId, lead.id);
  assert.equal(WA.thread(admin, conv.id).messages.length, 1);
  WA.handleWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: "x-none", status: "read" }] } }] }] }); // unknown id is harmless
  await signed(inbound("919812399999", "w2", "STOP", "Opt Out"));
  assert.equal((db().prepare("SELECT optOut FROM leads WHERE phone='+919812399999'").get() as { optOut: number }).optOut, 1);
});

test("replies: text only inside 24h window; human reply takes over from AI; templates metered", async () => {
  const conv = WA.listConversations(admin).find((c) => c.phone === "+919812300000")!;
  const f = stubFetch("");
  try {
    await WA.sendText(sales, conv.id, "Hello Ravi!");
    const t = WA.thread(admin, conv.id);
    assert.equal(t.messages.at(-1)!.body, "Hello Ravi!");
    assert.equal(t.conversation.aiMode, 0);
    assert.equal(t.conversation.assigneeId, sales.id);
    db().prepare("UPDATE wa_conversations SET lastInboundAt=? WHERE id=?").run(new Date(Date.now() - 25 * 3600_000).toISOString(), conv.id);
    await assert.rejects(WA.sendText(sales, conv.id, "late"), /24-hour window/);
    await WA.sendTemplate(sales, { conversationId: conv.id }, "followup:en", { params: ["Ravi"] });
    assert.equal(f.sent.at(-1)!.body.template.name, "followup");
    await assert.rejects(WA.sendTemplate(null, { phone: "+919812399999" }, "promo", { category: "marketing" }), /opted out/);
    assert.equal(usedThisMonth("whatsapp_utility"), 1);
  } finally {
    f.restore();
  }
});

test("AI WhatsApp agent: answers from knowledge, fills the lead, hands over when interested", async () => {
  WA.saveAgentSettings(admin, { enabled: true, knowledge: "We build websites from ₹25,000.", maxRepliesPerDay: 5, handoffOnInterest: true });
  const f = stubFetch({ reply: "Websites start at ₹25,000. Which city are you in?", lead: { company: "Kumar Traders", service: "Website", city: "Pune" }, intent: "interested", handoff: false, summary: "Wants a website for Kumar Traders" });
  try {
    WA.ingestInbound({ phone: "919876500011", name: "Anita", waId: "w3", type: "text", text: "Want a website for my shop" });
    const conv = WA.listConversations(admin).find((c) => c.phone === "+919876500011")!;
    assert.equal(conv.aiMode, 1);
    const [r, concurrent] = await Promise.all([agentReply(conv.id), agentReply(conv.id)]);
    assert.equal(r.handoff, true);
    assert.deepEqual(concurrent, { skipped: "busy" }, "never two replies at once");
    const lead = listLeads(admin).find((l) => l.phone === "+919876500011")!;
    assert.deepEqual([lead.company, lead.service, lead.city, lead.status], ["Kumar Traders", "Website", "Pune", "Qualified"]);
    const t = WA.thread(admin, conv.id);
    assert.equal(t.messages.at(-1)!.sender, "AI agent");
    assert.equal(t.conversation.aiMode, 0, "handed to a human");
    assert.match(taskDetails(admin, lead.taskId!).comments.map((c: { text: string }) => c.text).join(), /handed this WhatsApp conversation/);
    assert.deepEqual(await agentReply(conv.id), { skipped: "agent off or window closed" });
    assert.equal(usedThisMonth("ai_credit"), 2); // 1,500 tokens = 2 credits
  } finally {
    f.restore();
  }
});

test("AI budget: calls stop when the monthly credit budget is reached", async () => {
  saveBudgets(admin, { aiCreditsPerMonth: 1, voiceMinutesPerMonth: null });
  const { askBusiness } = await import("../src/lib/ai");
  await assert.rejects(askBusiness(admin, "How are we doing?"), /budget/);
  saveBudgets(admin, { aiCreditsPerMonth: null, voiceMinutesPerMonth: null });
});

test("workflow engine: trigger + conditions + wait + conditional step, draft until activated", async () => {
  const { id } = WF.saveWorkflow(admin, {
    definition: {
      name: "IndiaMART follow-up",
      trigger: "lead.created",
      conditions: [{ field: "source", op: "equals", value: "IndiaMART" }],
      steps: [
        { type: "set_stage", stage: "Contacted" },
        { type: "wait", minutes: 30 },
        { type: "create_task", title: "Second follow-up with {{name}}", dueInDays: 0, priority: "High", when: { field: "status", op: "equals", value: "Contacted" } },
        { type: "notify_owner", message: "Won't run", when: { field: "status", op: "equals", value: "Won" } },
      ],
    },
  });
  addLeads([{ externalId: "wf:1", name: "Draft Test", phone: "9811000001" }], "IndiaMART");
  await WF.processQueue();
  assert.equal(WF.listRuns(admin, id).length, 0, "drafts never run");

  WF.setEnabled(admin, id, true);
  const { leadIds } = addLeads([{ externalId: "wf:2", name: "Anil Mehta", phone: "9811000002" }], "IndiaMART");
  addLeads([{ externalId: "wf:3", name: "Other Source", phone: "9811000003" }], "Manual");
  await WF.processQueue();
  let runs = WF.listRuns(admin, id);
  assert.equal(runs.length, 1, "condition filters out other sources");
  assert.equal(runs[0].status, "waiting");
  assert.equal(listLeads(admin).find((l) => l.id === leadIds[0])!.status, "Contacted");

  db().prepare("UPDATE workflow_runs SET resumeAt=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), runs[0].id);
  await WF.processQueue();
  runs = WF.listRuns(admin, id);
  assert.equal(runs[0].status, "done");
  assert.match(runs[0].log.map((l: { result: string }) => l.result).join("|"), /task "Second follow-up with Anil".*skipped \(status equals Won\)/);
  const est = WF.estimate(WF.workflowSchema.parse({ name: "Estimate", trigger: "lead.created", steps: [{ type: "ai_call" }, { type: "whatsapp_template", template: "t" }] }), { voicePerMinute: 8, aiCredit: 0.2, waMarketing: null, waUtility: 0.15 });
  assert.equal(est.perRun, 24.15);
});

test("AI workflow builder returns a validated draft only", async () => {
  const f = stubFetch({ name: "FB → WhatsApp", trigger: "lead.created", conditions: [{ field: "sourceDetail", op: "contains", value: "facebook" }], steps: [{ type: "whatsapp_template", template: "welcome", withName: true, category: "utility" }, { type: "wait", minutes: 30 }, { type: "ai_call", briefing: "", when: { field: "status", op: "equals", value: "New" } }] });
  try {
    const d = await WF.draftFromText(admin, "When a Facebook lead comes, WhatsApp them and call with AI after 30 min if still new");
    assert.equal(d.steps.length, 3);
    assert.equal(WF.listWorkflows(admin).some((w) => w.definition.name === "FB → WhatsApp"), false, "not saved or activated");
  } finally {
    f.restore();
  }
});

test("human calling: log outcome with follow-up; cloud callback needs its token; Customer 360 shows it all", () => {
  const lead = listLeads(admin).find((l) => l.phone === "+919812300000")!;
  logCall(admin, { leadId: lead.id, disposition: "Connected — follow up", minutes: 4, notes: "Send portfolio", nextFollowUp: "2026-10-01" });
  const fresh = listLeads(admin).find((l) => l.id === lead.id)!;
  assert.equal(fresh.nextFollowUp, "2026-10-01");
  assert.throws(() => exotelCallback("x", "bad", {}), /token/);
  const t = timeline(admin, lead.id);
  const kinds = new Set(t.items.map((i) => i.kind));
  for (const k of ["lead", "whatsapp", "call"]) assert.ok(kinds.has(k), `timeline has ${k}`);
  assert.equal(t.next, "Follow up on 2026-10-01");
  db().prepare("UPDATE leads SET ownerId=? WHERE id=?").run(admin.id, lead.id);
  assert.throws(() => timeline(sales, lead.id), /not found/i, "salespeople only see their own customers");
});
