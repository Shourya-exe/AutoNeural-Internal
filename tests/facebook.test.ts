import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupAccounts, allUsers, createEmployee, db, taskDetails } from "../src/lib/store";
import { listLeads } from "../src/lib/leads";
import * as FB from "../src/lib/facebook";
import { GET, POST } from "../src/app/api/facebook/webhook/route";
const dir = mkdtempSync(join(tmpdir(), "autoneural-fb-"));
process.env.CRM_DATABASE_PATH = join(dir, "test.sqlite");
process.env.WORKFLOW_AUTORUN = "0";
// Lead Ads fall back to the WhatsApp app secret and verify token (same Meta app).
Object.assign(process.env, { WHATSAPP_APP_SECRET: "app-secret", WHATSAPP_VERIFY_TOKEN: "verify-me", FACEBOOK_PAGE_ACCESS_TOKEN: "page-token" });

setupAccounts();
const admin = allUsers().find((u) => u.email === "info@autoneural.in")!;
const sid = createEmployee(admin, { name: "Sales One", email: "s1@autoneural.in" }).id;
const sales = allUsers().find((u) => u.id === sid)!;
after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

/** Stub Meta Graph. `leads` maps leadgen id → field_data (or an error message). */
function stubGraph(leads: Record<string, { name: string; values: string[] }[] | string>) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    calls.push({ url: String(url), method: init.method ?? "GET", auth: new Headers(init.headers).get("authorization") });
    const id = u.pathname.split("/").pop()!;
    if (id === "FORM1") return Response.json({ id, name: "Site visit — Skyline" });
    if (id === "me") return Response.json({ id: "PAGE1", name: "Rapid X Realty" });
    if (id === "subscribed_apps") return Response.json({ success: true });
    const lead = leads[id];
    if (typeof lead === "string") return Response.json({ error: { message: lead } }, { status: 400 });
    return Response.json({ id, form_id: "FORM1", field_data: lead });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = orig) };
}
const leadgen = (...ids: string[]) =>
  JSON.stringify({ object: "page", entry: [{ id: "PAGE1", time: 1, changes: [...ids.map((id) => ({ field: "leadgen", value: { leadgen_id: id, form_id: "FORM1", page_id: "PAGE1" } })), { field: "feed", value: { item: "post" } }] }] });
const signed = (raw: string, secret = "app-secret") =>
  POST(new Request("https://w/api/facebook/webhook", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }, body: raw }));
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), "timed out");
}
const pending = () => (db().prepare("SELECT COUNT(*) AS n FROM fb_pending").get() as { n: number }).n;

test("Facebook webhook: Meta handshake with the verify token", async () => {
  const q = (token: string) => GET(new Request(`https://w/api/facebook/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`));
  assert.equal(await (await q("verify-me")).text(), "12345");
  assert.equal((await q("wrong")).status, 403);
});

test("Facebook webhook: signed only, answers read from Graph, custom questions kept, retries ignored", async () => {
  const g = stubGraph({
    LG1: [
      { name: "full_name", values: ["Asha Verma"] },
      { name: "phone_number", values: ["+919876500001"] },
      { name: "email", values: ["Asha@Example.com"] },
      { name: "which_project_are_you_interested_in?", values: ["Skyline 3BHK"] },
      { name: "budget", values: ["1.2 Cr"] },
    ],
  });
  try {
    assert.equal((await signed(leadgen("LG1"), "wrong")).status, 401);
    assert.equal(g.calls.length, 0, "nothing is fetched for an unsigned body");
    assert.equal((await signed(leadgen("LG1"))).status, 200);
    await until(() => listLeads(admin).some((l) => l.name === "Asha Verma"));

    const lead = listLeads(admin).find((l) => l.name === "Asha Verma")!;
    assert.equal(lead.source, "Facebook");
    assert.equal(lead.sourceDetail, "Facebook lead form: Site visit — Skyline");
    assert.equal(lead.phone, "+919876500001");
    assert.equal(lead.email, "asha@example.com");
    assert.equal(lead.message, "which project are you interested in? Skyline 3BHK\nbudget: 1.2 Cr");
    assert.equal(lead.ownerId, sales.id);
    assert.equal(taskDetails(admin, lead.taskId!).task.title, "Call Asha Verma");
    assert.ok(g.calls.every((c) => c.auth === "Bearer page-token" && !c.url.includes("page-token")), "token sent as a header, never in the URL");
    assert.equal(pending(), 0);

    const before = g.calls.length;
    assert.equal((await signed(leadgen("LG1"))).status, 200); // Meta retry
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(g.calls.length, before, "an imported lead is not fetched again");
    assert.equal(listLeads(admin).filter((l) => l.name === "Asha Verma").length, 1);
  } finally {
    g.restore();
  }
});

test("Facebook leads that can't be read yet stay queued and are retried with backoff", async () => {
  let g = stubGraph({ LG2: "(#200) Requires leads_retrieval permission" });
  try {
    assert.equal((await signed(leadgen("LG2"))).status, 200, "Meta is acknowledged even when the lead can't be read");
    await until(() => FB.facebookStatus().lastError !== null);
    assert.equal(FB.facebookStatus().pending, 1);
    assert.match(FB.facebookStatus().lastError!, /leads_retrieval/);

    const before = g.calls.length;
    assert.deepEqual(await FB.retryFacebookLeads(), { created: 0, pending: 1 });
    assert.equal(g.calls.length, before, "not due yet: backoff respected");
  } finally {
    g.restore();
  }
  g = stubGraph({ LG2: [{ name: "full_name", values: ["Late Lead"] }, { name: "phone_number", values: ["9876500002"] }] });
  try {
    assert.deepEqual(await FB.retryFacebookLeads({ force: true }), { created: 1, pending: 0 });
    assert.equal(listLeads(admin).find((l) => l.name === "Late Lead")?.phone, "+919876500002");
    assert.equal(FB.facebookStatus().lastError, null);
    assert.ok(FB.facebookStatus().lastLeadAt);
  } finally {
    g.restore();
  }
});

test("Subscribe Page: admin only, subscribes the token's Page to leadgen", async () => {
  const g = stubGraph({});
  try {
    await assert.rejects(FB.connectFacebookPage(sales), /administrator/);
    assert.deepEqual(await FB.connectFacebookPage(admin), { id: "PAGE1", name: "Rapid X Realty" });
    const sub = g.calls.find((c) => c.url.includes("/PAGE1/subscribed_apps"))!;
    assert.equal(sub.method, "POST");
    assert.equal(new URL(sub.url).searchParams.get("subscribed_fields"), "leadgen");
    assert.equal(FB.facebookStatus().page?.name, "Rapid X Realty");
  } finally {
    g.restore();
  }
});
