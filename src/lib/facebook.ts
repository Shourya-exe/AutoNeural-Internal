import { AppError, requireAdmin } from "./store";
import { addLeads, getSetting, ldb, mapRowToLead, setSetting, type LeadInput } from "./leads";
import { verifySignature, verifySubscription } from "./whatsapp";
import { audit } from "./platform";
import type { User } from "./types";

/**
 * Facebook & Instagram Lead Ads, straight from Meta (no Zapier).
 *
 * Meta → /api/facebook/webhook (Page object, "leadgen" field, X-Hub-Signature-256 verified).
 * The webhook carries only a leadgen_id, so each id is queued first and Meta is acknowledged;
 * the answers are then read with the Page access token and added like any other lead. A lead
 * that can't be read yet (expired token, app not granted Leads Access) stays queued and is
 * retried by the minute loop with backoff — Meta keeps leads readable for 90 days.
 *
 * Usually the same Meta app as WhatsApp, so the app secret and verify token fall back to
 * the WhatsApp ones.
 */

const graphBase = () => `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}`; // one Graph version per Meta app
const appSecret = () => process.env.FACEBOOK_APP_SECRET || process.env.WHATSAPP_APP_SECRET;
export const fbConfigured = () => !!(process.env.FACEBOOK_PAGE_ACCESS_TOKEN && appSecret());
export const verifyFacebookSignature = (raw: string, header: string | null) => verifySignature(raw, header, appSecret());
export const verifyFacebookSubscription = (q: URLSearchParams) =>
  verifySubscription(q, process.env.FACEBOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN);

const RETENTION_MS = 90 * 86_400_000;
const now = () => new Date().toISOString();

let ready = false;
function fdb() {
  const c = ldb();
  if (!ready) {
    c.exec(
      "CREATE TABLE IF NOT EXISTS fb_pending(leadgenId TEXT PRIMARY KEY,formId TEXT,receivedAt TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,nextAttemptAt TEXT NOT NULL,lastError TEXT)",
    );
    ready = true;
  }
  return c;
}

async function graph<T>(path: string, token: string, fetchImpl: typeof fetch, method = "GET"): Promise<T> {
  const res = await fetchImpl(`${graphBase()}/${path}`, { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || j.error) throw new Error(`Facebook: ${j.error?.message ?? `HTTP ${res.status}`}`);
  return j;
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

type LeadgenBody = { entry?: { changes?: { field?: string; value?: { leadgen_id?: string | number; form_id?: string | number } }[] }[] };

/** Queues the leads in a verified webhook body. Returns the ids to import (already-imported ones are skipped). */
export function queueLeadgen(body: LeadgenBody) {
  const ids: string[] = [];
  const at = now();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (change.field !== "leadgen" || !v?.leadgen_id) continue;
      const id = String(v.leadgen_id);
      if (fdb().prepare("SELECT 1 FROM leads WHERE externalId=?").get(`fb:${id}`)) continue; // Meta retries webhooks
      fdb()
        .prepare("INSERT OR IGNORE INTO fb_pending(leadgenId,formId,receivedAt,nextAttemptAt) VALUES(?,?,?,?)")
        .run(id, v.form_id ? String(v.form_id) : null, at, at);
      ids.push(id);
    }
  }
  return [...new Set(ids)];
}

// Contact questions Meta pre-fills; every other answer is a custom question the salesperson should see.
const CONTACT_FIELDS = new Set(["full_name", "first_name", "last_name", "email", "phone_number", "city", "company_name"]);

/** Meta's field_data → a lead. Custom questions ("which_project_are_you_interested_in?") become the message. */
export function leadFromAnswers(leadgenId: string, fields: { name: string; values?: string[] }[], formName: string | null): LeadInput | null {
  const lead = mapRowToLead(Object.fromEntries(fields.map((f) => [f.name, (f.values ?? []).join(", ")])));
  if (!lead) return null;
  const answers = fields
    .filter((f) => !CONTACT_FIELDS.has(f.name) && f.values?.some((v) => v.trim()))
    .map((f) => {
      const label = f.name.replace(/_/g, " ");
      return `${label}${/[?:]$/.test(label) ? "" : ":"} ${f.values!.join(", ")}`;
    });
  return {
    ...lead,
    message: answers.length ? answers.join("\n").slice(0, 4000) : lead.message,
    externalId: `fb:${leadgenId}`,
    sourceDetail: formName ? `Facebook lead form: ${formName}`.slice(0, 120) : "Facebook Lead Ads",
  };
}

const formNames = new Map<string, string>();
async function formName(formId: string | null | undefined, token: string, fetchImpl: typeof fetch) {
  if (!formId) return null;
  if (!formNames.has(formId)) {
    // Best effort: without the form name the lead is still added as "Facebook Lead Ads".
    const name = await graph<{ name?: string }>(`${formId}?fields=name`, token, fetchImpl).then((f) => f.name, () => undefined);
    if (name) formNames.set(formId, name);
  }
  return formNames.get(formId) ?? null;
}

type Pending = { leadgenId: string; formId: string | null; receivedAt: string; attempts: number };
const inflight = new Set<string>();

async function importOne(id: string, fetchImpl: typeof fetch) {
  const row = fdb().prepare("SELECT * FROM fb_pending WHERE leadgenId=?").get(id) as Pending | undefined;
  if (!row) return 0;
  try {
    const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!token) throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN is not set on the server.");
    const lead = await graph<{ field_data?: { name: string; values?: string[] }[]; form_id?: string }>(`${id}?fields=field_data,form_id`, token, fetchImpl);
    const input = leadFromAnswers(id, lead.field_data ?? [], await formName(lead.form_id ?? row.formId, token, fetchImpl));
    const created = input ? addLeads([input], "Facebook").created : 0;
    if (!input) console.warn(`[facebook] lead ${id} has no phone or email; skipped`);
    fdb().prepare("DELETE FROM fb_pending WHERE leadgenId=?").run(id);
    setSetting("fb_last_lead", now());
    return created;
  } catch (e) {
    const attempts = row.attempts + 1;
    const next = new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000).toISOString();
    fdb().prepare("UPDATE fb_pending SET attempts=?, nextAttemptAt=?, lastError=? WHERE leadgenId=?").run(attempts, next, (e as Error).message.slice(0, 500), id);
    console.error(`[facebook] lead ${id} not imported (attempt ${attempts})`, (e as Error).message);
    return 0;
  }
}

/** Reads queued leads from Meta and adds them. Returns how many new leads were created. */
export async function importLeads(ids: string[], fetchImpl: typeof fetch = fetch) {
  let created = 0;
  for (const id of ids) {
    if (inflight.has(id)) continue;
    inflight.add(id);
    try {
      created += await importOne(id, fetchImpl);
    } finally {
      inflight.delete(id);
    }
  }
  return created;
}

/** Retries queued leads that are due (minute loop, lead cron, "Check sources now"). */
export async function retryFacebookLeads(opts: { force?: boolean; fetchImpl?: typeof fetch } = {}) {
  const expired = fdb().prepare("DELETE FROM fb_pending WHERE receivedAt<?").run(new Date(Date.now() - RETENTION_MS).toISOString());
  if (expired.changes) console.error(`[facebook] gave up on ${expired.changes} lead(s) older than 90 days`);
  const due = (
    opts.force
      ? fdb().prepare("SELECT leadgenId FROM fb_pending ORDER BY receivedAt LIMIT 50").all()
      : fdb().prepare("SELECT leadgenId FROM fb_pending WHERE nextAttemptAt<=? ORDER BY receivedAt LIMIT 50").all(now())
  ) as { leadgenId: string }[];
  const created = due.length ? await importLeads(due.map((r) => r.leadgenId), opts.fetchImpl) : 0;
  return { created, pending: (fdb().prepare("SELECT COUNT(*) AS n FROM fb_pending").get() as { n: number }).n };
}

// ─── Admin ───────────────────────────────────────────────────────────────────

type PageRecord = { id: string; name: string; connectedAt: string };

export function facebookStatus() {
  const pending = fdb().prepare("SELECT COUNT(*) AS n FROM fb_pending").get() as { n: number };
  const failed = fdb().prepare("SELECT lastError FROM fb_pending WHERE lastError IS NOT NULL ORDER BY receivedAt DESC LIMIT 1").get() as
    | { lastError: string }
    | undefined;
  return {
    configured: fbConfigured(),
    page: getSetting<PageRecord>("fb_page"),
    lastLeadAt: getSetting<string>("fb_last_lead"),
    pending: pending.n,
    lastError: failed?.lastError ?? null,
  };
}

/** Subscribes the Page behind FACEBOOK_PAGE_ACCESS_TOKEN to this app's "leadgen" webhook. */
export async function connectFacebookPage(user: User, fetchImpl: typeof fetch = fetch) {
  requireAdmin(user);
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) throw new AppError(400, "Set FACEBOOK_PAGE_ACCESS_TOKEN on the server first.");
  try {
    const page = await graph<{ id: string; name: string }>("me?fields=id,name", token, fetchImpl);
    await graph(`${page.id}/subscribed_apps?subscribed_fields=leadgen`, token, fetchImpl, "POST");
    setSetting("fb_page", { id: page.id, name: page.name, connectedAt: now() } satisfies PageRecord);
    audit(user.name, "facebook.page.connect", null, null, { pageId: page.id });
    return { id: page.id, name: page.name };
  } catch (e) {
    const msg = (e as Error).message;
    throw new AppError(502, `${msg}${/[.!?]$/.test(msg) ? "" : "."} Use a Page access token with leads_retrieval and pages_manage_metadata.`);
  }
}
