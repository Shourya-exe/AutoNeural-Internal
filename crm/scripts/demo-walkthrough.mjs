/**
 * End-to-end demo walkthrough against a RUNNING AutoNeural CRM.
 *
 *   node scripts/demo-walkthrough.mjs [baseUrl]
 *
 * Exercises the documented flow with REAL HMAC-signed webhook requests:
 *
 *   1. A person submits a Facebook lead form   → lead created
 *   2. Automations assign a salesperson        → owner set
 *   3. A follow-up task appears                → task created
 *   4. The same person later messages on       → linked to the SAME lead
 *      WhatsApp (identity established by       (original source preserved,
 *      normalised E.164 phone)                  WhatsApp added as a touchpoint)
 *   5. A duplicate webhook delivery            → no duplicate records
 *   6. The salesperson replies                 → outbound stored as SENT
 *   7. The opportunity moves through stages    → persisted + on the timeline
 *   8. Dashboard metrics update                → counted from stored data
 *
 * Nothing is sent to a real provider: outbound is blocked by DEMO_MODE.
 */
import crypto from "node:crypto";

try {
  process.loadEnvFile?.();
} catch {
  /* ignore */
}

const BASE = process.argv[2] ?? process.env.APP_URL ?? "http://localhost:3000";
const BASIC =
  process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASSWORD
    ? "Basic " +
      Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString(
        "base64",
      )
    : null;

const PHONE_E164 = "+919812340001";
const PHONE_RAW = "9812340001"; // deliberately un-normalised, as a form would send
const WA_ID = "919812340001";
const EMAIL = "walkthrough.demo@example.com";
const NAME = "Walkthrough Demo Lead";

function sign(secret, body) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function postWebhook(path, secret, payload) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": sign(secret, body),
    },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const step = (n, msg) => console.log(`\n\x1b[33m${n}.\x1b[0m ${msg}`);
const ok = (msg) => console.log(`   \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg) => {
  console.log(`   \x1b[31m✗\x1b[0m ${msg}`);
  process.exitCode = 1;
};

// The walkthrough inspects the database directly to assert outcomes.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log(`AutoNeural CRM — demo walkthrough against ${BASE}`);
  console.log("(all data below is synthetic; DEMO_MODE blocks real provider calls)\n");

  // Clean any previous run so the walkthrough is repeatable.
  const priorContacts = await prisma.contact.findMany({
    where: { OR: [{ primaryPhone: PHONE_E164 }, { primaryEmail: EMAIL }] },
    select: { id: true },
  });
  if (priorContacts.length) {
    const ids = priorContacts.map((c) => c.id);
    await prisma.message.deleteMany({ where: { conversation: { contactId: { in: ids } } } });
    await prisma.conversation.deleteMany({ where: { contactId: { in: ids } } });
    await prisma.task.deleteMany({ where: { lead: { contactId: { in: ids } } } });
    await prisma.activity.deleteMany({ where: { lead: { contactId: { in: ids } } } });
    await prisma.touchpoint.deleteMany({ where: { lead: { contactId: { in: ids } } } });
    await prisma.automationRun.deleteMany({ where: { lead: { contactId: { in: ids } } } });
    await prisma.lead.deleteMany({ where: { contactId: { in: ids } } });
    await prisma.channelIdentity.deleteMany({ where: { contactId: { in: ids } } });
    await prisma.contact.deleteMany({ where: { id: { in: ids } } });
    await prisma.webhookEvent.deleteMany({
      where: { providerEventId: { contains: "WALKTHROUGH" } },
    });
    console.log(`(cleaned ${priorContacts.length} record(s) from a previous run)`);
  }

  const leadgenId = `WALKTHROUGH_LEAD_${Date.now()}`;

  // ── 1. Facebook lead form submission ───────────────────────────────────────
  step(1, "A person submits the Facebook lead form");
  const leadAdsPayload = {
    object: "page",
    entry: [
      {
        id: "AUTONEURAL_PAGE",
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: leadgenId,
              page_id: "AUTONEURAL_PAGE",
              form_id: "FORM_CONSULT",
              form_name: "AutoNeural — Book a consultation",
              campaign_id: "CAMP_Q3",
              campaign_name: "Q3 AI Agents — Lead Gen",
              ad_id: "AD_112",
              field_data: [
                { name: "full_name", values: [NAME] },
                { name: "email", values: [EMAIL] },
                { name: "phone_number", values: [PHONE_RAW] },
                { name: "company_name", values: ["Walkthrough Clinics"] },
                {
                  name: "which_service_are_you_interested_in?",
                  values: ["AI Calling Systems"],
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const r1 = await postWebhook(
    "/api/webhooks/meta-lead-ads",
    process.env.META_LEADADS_APP_SECRET || "dev-leadads-app-secret",
    leadAdsPayload,
  );
  r1.status === 200
    ? ok(`webhook acknowledged (${r1.status}) — stored ${r1.json.stored} event(s)`)
    : bad(`webhook returned ${r1.status}`);

  await settle();

  const lead = await prisma.lead.findFirst({
    where: { contact: { primaryEmail: EMAIL } },
    include: { contact: true, owner: true, stage: true, tasks: true, touchpoints: true },
    orderBy: { createdAt: "desc" },
  });
  if (!lead) return bad("no lead was created — stopping");

  ok(`lead created: "${lead.title}"`);
  ok(`source preserved as ${lead.sourceChannel} · campaign "${lead.campaignName}"`);
  ok(`phone normalised to E.164: ${lead.contact.primaryPhone}`);
  lead.contact.primaryPhone === PHONE_E164
    ? ok("E.164 normalisation matches the expected value")
    : bad(`expected ${PHONE_E164}, got ${lead.contact.primaryPhone}`);

  // ── 2 & 3. Assignment + follow-up task ─────────────────────────────────────
  step(2, "Automations assign a salesperson");
  lead.owner ? ok(`assigned to ${lead.owner.name} (round-robin)`) : bad("lead is unassigned");

  step(3, "A follow-up task appears");
  const followUp = lead.tasks.find((t) => t.type === "FOLLOW_UP");
  followUp
    ? ok(`task "${followUp.title}" due ${followUp.dueAt?.toISOString()} (UTC)`)
    : bad("no follow-up task was created");

  const notif = await prisma.notification.count({
    where: { userId: lead.ownerId ?? "", type: "LEAD_ASSIGNED" },
  });
  notif > 0 ? ok(`owner notified (${notif} notification)`) : bad("owner was not notified");

  // ── 4. Later WhatsApp enquiry from the same person ─────────────────────────
  step(4, "The same person messages on WhatsApp — identity established by phone");
  const waMsgId = `wamid.WALKTHROUGH_${Date.now()}`;
  const waPayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PHONE_ID" },
              contacts: [{ profile: { name: NAME }, wa_id: WA_ID }],
              messages: [
                {
                  from: WA_ID,
                  id: waMsgId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "Hi — following up on the form I filled. Can we talk today?" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const r2 = await postWebhook(
    "/api/webhooks/whatsapp",
    process.env.WHATSAPP_APP_SECRET || "dev-whatsapp-app-secret",
    waPayload,
  );
  r2.status === 200 ? ok(`webhook acknowledged (${r2.status})`) : bad(`got ${r2.status}`);
  await settle();

  const contacts = await prisma.contact.count({
    where: { OR: [{ primaryPhone: PHONE_E164 }, { primaryEmail: EMAIL }] },
  });
  contacts === 1
    ? ok("linked to the SAME contact — no duplicate created")
    : bad(`expected 1 contact, found ${contacts}`);

  const afterWa = await prisma.lead.findUniqueOrThrow({
    where: { id: lead.id },
    include: { touchpoints: true, conversations: { include: { messages: true } } },
  });
  afterWa.sourceChannel === "META_LEAD_ADS"
    ? ok("original lead source still META_LEAD_ADS")
    : bad(`source changed to ${afterWa.sourceChannel}`);
  afterWa.touchpoints.some((t) => t.channel === "WHATSAPP")
    ? ok("WhatsApp recorded as a subsequent touchpoint")
    : bad("no WhatsApp touchpoint recorded");
  afterWa.conversations.length === 1
    ? ok(`conversation opened with ${afterWa.conversations[0].messages.length} message(s)`)
    : bad(`expected 1 conversation, found ${afterWa.conversations.length}`);

  // ── 5. Duplicate delivery ──────────────────────────────────────────────────
  step(5, "The provider re-delivers the SAME message (at-least-once delivery)");
  const before = await prisma.message.count();
  const r3 = await postWebhook(
    "/api/webhooks/whatsapp",
    process.env.WHATSAPP_APP_SECRET || "dev-whatsapp-app-secret",
    waPayload,
  );
  await settle();
  const after = await prisma.message.count();
  ok(`acknowledged again (${r3.status}) — duplicates reported: ${r3.json.duplicates ?? 0}`);
  after === before
    ? ok(`message count unchanged (${after}) — exactly-once storage`)
    : bad(`message count changed ${before} → ${after}`);

  // ── 5b. Invalid signature ──────────────────────────────────────────────────
  step("5b", "A forged webhook with a bad signature is rejected");
  const forged = await fetch(`${BASE}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": sign("attacker-secret", JSON.stringify(waPayload)),
    },
    body: JSON.stringify(waPayload),
  });
  forged.status === 401
    ? ok("rejected with 401 before anything was stored")
    : bad(`expected 401, got ${forged.status}`);

  // ── 6. Salesperson replies ─────────────────────────────────────────────────
  step(6, "The salesperson replies from the unified inbox");
  const convo = afterWa.conversations[0];
  const replyMsg = await prisma.message.create({
    data: {
      organizationId: lead.organizationId,
      conversationId: convo.id,
      direction: "OUTBOUND",
      type: "TEXT",
      body: "Hi! Yes — I can call you at 4pm today. Does that work?",
      deliveryStatus: "SENT", // never DELIVERED without a provider callback
      providerMessageId: `demo-out-${Date.now()}`,
      senderUserId: lead.ownerId,
      sentAt: new Date(),
    },
  });
  await prisma.lead.updateMany({
    where: { id: lead.id, firstResponseAt: null },
    data: { firstResponseAt: new Date() },
  });
  ok(`reply stored with deliveryStatus=${replyMsg.deliveryStatus} (not "Delivered")`);

  // ── 7. Pipeline progression ────────────────────────────────────────────────
  step(7, "The opportunity moves through the pipeline");
  const stages = await prisma.pipelineStage.findMany({
    where: { organizationId: lead.organizationId },
    orderBy: { order: "asc" },
  });
  for (const key of ["contacted", "qualified", "demo_scheduled"]) {
    const stage = stages.find((s) => s.key === key);
    await prisma.lead.update({ where: { id: lead.id }, data: { stageId: stage.id } });
    await prisma.activity.create({
      data: {
        organizationId: lead.organizationId,
        leadId: lead.id,
        type: "STAGE_CHANGED",
        summary: `Stage → ${stage.name}`,
        meta: { toStage: key },
      },
    });
    ok(`moved to ${stage.name} (persisted + on the activity timeline)`);
  }

  // ── 8. Dashboard reflects it ───────────────────────────────────────────────
  step(8, "Dashboard metrics recompute from stored data");
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [newLeads, unassigned, overdue, open] = await Promise.all([
    prisma.lead.count({
      where: { organizationId: lead.organizationId, createdAt: { gte: since }, archivedAt: null },
    }),
    prisma.lead.count({
      where: { organizationId: lead.organizationId, status: "OPEN", ownerId: null, archivedAt: null },
    }),
    prisma.lead.count({
      where: {
        organizationId: lead.organizationId,
        status: "OPEN",
        archivedAt: null,
        nextFollowUpAt: { lt: new Date() },
      },
    }),
    prisma.lead.aggregate({
      _sum: { estimatedValue: true },
      where: { organizationId: lead.organizationId, status: "OPEN", archivedAt: null },
    }),
  ]);
  ok(`new leads (30d): ${newLeads}`);
  ok(`unassigned: ${unassigned}`);
  ok(`overdue follow-ups: ${overdue}`);
  ok(`open pipeline value: ₹${Number(open._sum.estimatedValue ?? 0).toLocaleString("en-IN")}`);

  const timeline = await prisma.activity.count({ where: { leadId: lead.id } });
  ok(`lead timeline now has ${timeline} entries`);

  console.log(
    `\n\x1b[32mWalkthrough complete.\x1b[0m Open ${BASE}/leads/${lead.id} to see the result.`,
  );
}

/** Give the background worker (or the inline fallback) a moment to finish. */
function settle(ms = 1500) {
  return new Promise((r) => setTimeout(r, ms));
}

main()
  .catch((e) => {
    console.error("\nWalkthrough failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
