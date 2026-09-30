import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupAccounts, allUsers, createEmployee, db, taskDetails } from "../src/lib/store";
import { addLeads, listLeads } from "../src/lib/leads";
import { listCalls, placeCall, recordAgentCall } from "../src/lib/voice";
import { POST as callsRoute } from "../src/app/api/agent/calls/route";
import { POST as whatsappRoute } from "../src/app/api/agent/whatsapp/route";
const dir = mkdtempSync(join(tmpdir(), "autoneural-voice-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");
process.env.AGENT_INGEST_SECRET = "test-agent-secret";
process.env.AGENT_HEALTH_PORT = "1"; // nothing listens here, so the agent counts as stopped

setupAccounts();
const admin = allUsers().find((u) => u.email === "info@autoneural.in")!;
createEmployee(admin, { name: "Sales One", email: "s1@autoneural.in" });
after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

const agentPost = (route: typeof callsRoute, body: unknown, secret = "test-agent-secret") =>
  route(new Request("http://localhost/api/agent/x", { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body) }));

const finished = (over: Record<string, unknown>) => ({
  direction: "outbound",
  customerNumber: "+919876543210",
  duration: 134,
  status: "completed",
  outcome: "completed",
  transcript: "AI: Hi\nCaller: Need a website",
  summary: "Wants a 5-page website, budget discussed.",
  sentiment: "positive",
  nextAction: "Send proposal by Friday",
  roomName: "call-919876543210-a1",
  ...over,
});

test("agent callbacks require the shared secret", async () => {
  assert.equal((await agentPost(callsRoute, finished({}), "wrong")).status, 401);
});

test("a finished outbound call is logged on the lead's task and marks it Contacted, once", async () => {
  const { leadIds } = addLeads([{ externalId: "t:1", name: "Priya", phone: "9876543210", service: "Website" }], "Manual");
  const res = await agentPost(callsRoute, finished({ leadId: leadIds[0] }));
  assert.equal(res.status, 200);
  const lead = listLeads(admin).find((l) => l.id === leadIds[0])!;
  assert.equal(lead.status, "Contacted");
  const comments = taskDetails(admin, lead.taskId!).comments.map((c: { text: string }) => c.text);
  assert.ok(comments.some((t: string) => /AI outbound call, 2m 14s, positive/.test(t) && /Send proposal by Friday/.test(t)));

  // The agent retries on timeouts: the same room is not logged twice.
  assert.equal((await (await agentPost(callsRoute, finished({ leadId: leadIds[0] }))).json()).duplicate, true);
  assert.equal(listCalls(admin).length, 1);
  assert.equal(listCalls(admin)[0].leadName, "Priya");
});

test("an unknown inbound caller becomes a new lead; a missed call does not change status", async () => {
  await agentPost(callsRoute, finished({ direction: "inbound", customerNumber: "+919811122233", roomName: "sip-in-1", summary: "Asked about WhatsApp bots." }));
  const lead = listLeads(admin).find((l) => l.phone === "+919811122233")!;
  assert.equal(lead.source, "AI call");
  assert.equal(lead.status, "Contacted");

  const { leadIds } = addLeads([{ externalId: "t:2", name: "Busy Person", phone: "9800011122" }], "Manual");
  await agentPost(callsRoute, finished({ leadId: leadIds[0], customerNumber: "+919800011122", status: "busy", outcome: "busy", roomName: "call-2", summary: null }));
  assert.equal(listLeads(admin).find((l) => l.id === leadIds[0])!.status, "New");
});

test("WhatsApp requests are handed to the lead owner, never reported as sent", async () => {
  const r = await (await agentPost(whatsappRoute, { phone: "+919876543210", message: "Proposal details", confirmed: true, requestId: "x" })).json();
  assert.equal(r.accepted, false);
  const lead = listLeads(admin).find((l) => l.phone === "+919876543210")!;
  assert.ok(taskDetails(admin, lead.taskId!).comments.some((c: { text: string }) => c.text.includes("Proposal details")));
});

test("placing a call needs LiveKit settings and a running agent", async () => {
  const lead = listLeads(admin)[0];
  await assert.rejects(placeCall(admin, { leadId: lead.id }), /not running/);
});
