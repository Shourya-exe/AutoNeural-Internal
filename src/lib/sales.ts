import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, allUsers, appSecret, findTask, requireAdmin, transaction, recordTaskNotificationEmail } from "./store";
import { ldb, systemActor, normalizePhone } from "./leads";
import { sendEmail, notifyTaskAssigned } from "./email";
import type { User } from "./types";
import { audit, emit } from "./platform";

/**
 * Sales: pipeline fields on leads, quotations → invoices with GST, payments
 * (UPI, Razorpay, Stripe), meetings (Jitsi / Zoom), email & WhatsApp campaigns,
 * and grievance tickets. All data lives in the workspace SQLite database.
 */

export const pipelineStages = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"] as const;

let ready = false;
export function sdb() {
  const c = ldb();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,number TEXT UNIQUE NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('quote','invoice')),leadId TEXT REFERENCES leads(id) ON DELETE SET NULL,customer TEXT NOT NULL,items TEXT NOT NULL,notes TEXT,status TEXT NOT NULL,issueDate TEXT NOT NULL,dueDate TEXT,subtotal REAL NOT NULL,tax REAL NOT NULL,total REAL NOT NULL,paid REAL NOT NULL DEFAULT 0,token TEXT UNIQUE NOT NULL,paymentLinks TEXT,sourceId TEXT,createdBy TEXT REFERENCES users(id),createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,amount REAL NOT NULL,method TEXT NOT NULL,reference TEXT UNIQUE,paidAt TEXT NOT NULL,recordedBy TEXT);
      CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY,leadId TEXT REFERENCES leads(id) ON DELETE SET NULL,title TEXT NOT NULL,startsAt TEXT NOT NULL,minutes INTEGER NOT NULL,provider TEXT NOT NULL,link TEXT NOT NULL,createdBy TEXT REFERENCES users(id),createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,name TEXT NOT NULL,channel TEXT NOT NULL,segment TEXT NOT NULL,subject TEXT,body TEXT,template TEXT,status TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0,sent INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,lastError TEXT,createdBy TEXT REFERENCES users(id),createdAt TEXT NOT NULL,sentAt TEXT);
      CREATE TABLE IF NOT EXISTS tickets(number INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,leadId TEXT REFERENCES leads(id) ON DELETE SET NULL,customerName TEXT NOT NULL,phone TEXT,email TEXT,subject TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,priority TEXT NOT NULL,status TEXT NOT NULL,assigneeId TEXT REFERENCES users(id),updates TEXT NOT NULL DEFAULT '[]',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,resolvedAt TEXT);
      CREATE INDEX IF NOT EXISTS documents_lead ON documents(leadId);
      CREATE INDEX IF NOT EXISTS meetings_lead ON meetings(leadId);`);
    ready = true;
  }
  return c;
}

const now = () => new Date().toISOString();
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
function getSetting<T>(key: string): T | null {
  const row = sdb().prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}
function setSetting(key: string, value: unknown) {
  sdb().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
}
function leadFor(user: User, id: string) {
  const lead = sdb().prepare("SELECT * FROM leads WHERE id=?").get(id) as Record<string, any> | undefined;
  if (!lead || (user.role !== "admin" && lead.ownerId !== user.id)) throw new AppError(404, "Lead not found.");
  return lead;
}
function noteOnLead(leadId: string | null, text: string, actorId = systemActor().id) {
  if (!leadId) return;
  const lead = sdb().prepare("SELECT taskId FROM leads WHERE id=?").get(leadId) as { taskId: string | null } | undefined;
  if (!lead?.taskId) return;
  sdb().prepare("INSERT INTO comments VALUES(?,?,?,?,?)").run(randomUUID(), lead.taskId, actorId, text.slice(0, 4000), now());
  sdb().prepare("UPDATE tasks SET updatedAt=?, version=version+1 WHERE id=?").run(now(), lead.taskId);
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export function updateDeal(user: User, input: unknown) {
  const p = z
    .object({
      id: z.string().uuid(),
      status: z.enum(pipelineStages).optional(),
      value: z.number().min(0).max(1e10).nullable().optional(),
      nextFollowUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      lostReason: z.string().trim().max(300).optional(),
    })
    .parse(input);
  const lead = leadFor(user, p.id);
  if (p.status === "Lost" && !(p.lostReason || lead.lostReason)) throw new AppError(400, "Add a reason when marking a deal lost.");
  sdb()
    .prepare("UPDATE leads SET status=coalesce(?,status), value=?, nextFollowUp=?, lostReason=coalesce(?,lostReason), updatedAt=? WHERE id=?")
    .run(
      p.status ?? null,
      p.value === undefined ? lead.value : p.value,
      p.nextFollowUp === undefined ? lead.nextFollowUp : p.nextFollowUp,
      p.lostReason || null,
      now(),
      p.id,
    );
  if (p.status && p.status !== lead.status) {
    noteOnLead(p.id, `Stage: ${lead.status} → ${p.status}${p.status === "Lost" && p.lostReason ? ` (${p.lostReason})` : ""}.`, user.id);
    emit("lead.stage_changed", p.id, { from: lead.status, to: p.status, by: user.name });
  }
  return { ok: true };
}

// ─── Company profile (appears on quotations and invoices) ────────────────────

export const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(400).default(""),
  state: z.string().trim().max(60).default(""),
  gstin: z.string().trim().max(20).default(""),
  email: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(30).default(""),
  upiId: z.string().trim().max(80).default(""),
  bank: z.string().trim().max(300).default(""),
  terms: z.string().trim().max(1000).default(""),
});
export type Company = z.infer<typeof companySchema>;
export const company = (): Company =>
  getSetting<Company>("company") ?? { name: "AutoNeural", address: "", state: "", gstin: "", email: "info@autoneural.in", phone: "", upiId: "", bank: "", terms: "" };
export function saveCompany(user: User, input: unknown) {
  requireAdmin(user);
  setSetting("company", companySchema.parse(input));
}

// ─── Quotations and invoices ─────────────────────────────────────────────────

const itemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  hsn: z.string().trim().max(12).optional().default(""),
  qty: z.number().positive().max(1e6),
  rate: z.number().min(0).max(1e9),
  gst: z.number().min(0).max(28).default(18),
});
const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(30).optional().default(""),
  gstin: z.string().trim().max(20).optional().default(""),
  address: z.string().trim().max(400).optional().default(""),
  state: z.string().trim().max(60).optional().default(""),
});
const docSchema = z.object({
  kind: z.enum(["quote", "invoice"]),
  leadId: z.string().uuid().nullable().optional(),
  customer: customerSchema,
  items: z.array(itemSchema).min(1).max(100),
  notes: z.string().trim().max(2000).optional().default(""),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type DocItem = z.infer<typeof itemSchema>;
export type Customer = z.infer<typeof customerSchema>;

/** Totals with GST split: CGST+SGST within the seller's state, IGST across states. */
export function totals(items: DocItem[], customerState = "", sellerState = company().state) {
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.rate, 0));
  const tax = round2(items.reduce((s, i) => s + (i.qty * i.rate * i.gst) / 100, 0));
  const inter = !!customerState && !!sellerState && customerState.trim().toLowerCase() !== sellerState.trim().toLowerCase();
  return { subtotal, tax, total: round2(subtotal + tax), igst: inter ? tax : 0, cgst: inter ? 0 : round2(tax / 2), sgst: inter ? 0 : round2(tax / 2) };
}

function nextNumber(kind: "quote" | "invoice") {
  const prefix = `${kind === "quote" ? "QT" : "INV"}-${new Date().getFullYear()}-`;
  const last = sdb().prepare("SELECT number FROM documents WHERE number LIKE ? ORDER BY number DESC LIMIT 1").get(`${prefix}%`) as { number: string } | undefined;
  return `${prefix}${String((last ? Number(last.number.slice(prefix.length)) : 0) + 1).padStart(4, "0")}`;
}

export type Doc = {
  id: string;
  number: string;
  kind: "quote" | "invoice";
  leadId: string | null;
  customer: Customer;
  items: DocItem[];
  notes: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  token: string;
  paymentLinks: Record<string, { id: string; url: string }> | null;
  sourceId: string | null;
  createdAt: string;
};
const parseDoc = (r: Record<string, any>): Doc => ({
  ...r,
  customer: JSON.parse(r.customer),
  items: JSON.parse(r.items),
  paymentLinks: r.paymentLinks ? JSON.parse(r.paymentLinks) : null,
}) as Doc;

export function createDocument(user: User, input: unknown) {
  const p = docSchema.parse(input);
  if (p.leadId) leadFor(user, p.leadId);
  const t = totals(p.items, p.customer.state);
  const id = randomUUID();
  const time = now();
  // Numbering and insert share one write transaction so concurrent saves never collide on a number.
  const number = transaction(() => {
    const number = nextNumber(p.kind);
    sdb()
      .prepare(
        "INSERT INTO documents(id,number,kind,leadId,customer,items,notes,status,issueDate,dueDate,subtotal,tax,total,token,createdBy,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(id, number, p.kind, p.leadId ?? null, JSON.stringify(p.customer), JSON.stringify(p.items), p.notes, p.kind === "quote" ? "Draft" : "Unpaid", today(), p.dueDate ?? null, t.subtotal, t.tax, t.total, randomBytes(24).toString("base64url"), user.id, time, time);
    if (p.leadId && p.kind === "quote") {
      const lead = sdb().prepare("SELECT status FROM leads WHERE id=?").get(p.leadId) as { status: string };
      if (["New", "Contacted", "Qualified"].includes(lead.status)) sdb().prepare("UPDATE leads SET status='Proposal', value=?, updatedAt=? WHERE id=?").run(t.total, time, p.leadId);
    }
    return number;
  });
  noteOnLead(p.leadId ?? null, `${p.kind === "quote" ? "Quotation" : "Invoice"} ${number} created for ₹${t.total.toLocaleString("en-IN")}.`, user.id);
  return getDocument(user, id);
}

/** Admins see every document; salespeople see the ones they created or that belong to their leads. */
const docScope = (user: User) => (user.role === "admin" ? { where: "1=1", args: [] as string[] } : { where: "(d.createdBy=? OR l.ownerId=?)", args: [user.id, user.id] });

export function listDocuments(user: User) {
  const s = docScope(user);
  return (
    sdb()
      .prepare(`SELECT d.* FROM documents d LEFT JOIN leads l ON l.id=d.leadId WHERE ${s.where} ORDER BY d.createdAt DESC LIMIT 500`)
      .all(...s.args) as Record<string, any>[]
  ).map(parseDoc);
}

export function getDocument(user: User, id: string) {
  const s = docScope(user);
  const row = sdb().prepare(`SELECT d.* FROM documents d LEFT JOIN leads l ON l.id=d.leadId WHERE d.id=? AND ${s.where}`).get(id, ...s.args) as
    | Record<string, any>
    | undefined;
  if (!row) throw new AppError(404, "Document not found.");
  return parseDoc(row);
}

export function documentByToken(token: string) {
  const r = sdb().prepare("SELECT * FROM documents WHERE token=?").get(token) as Record<string, any> | undefined;
  return r ? parseDoc(r) : null;
}

export function setDocumentStatus(user: User, input: unknown) {
  const p = z.object({ id: z.string().uuid(), status: z.enum(["Draft", "Sent", "Accepted", "Rejected", "Cancelled"]) }).parse(input);
  const d = getDocument(user, p.id);
  sdb().prepare("UPDATE documents SET status=?, updatedAt=? WHERE id=?").run(p.status, now(), d.id);
  if (d.leadId && p.status === "Accepted") sdb().prepare("UPDATE leads SET status='Negotiation', updatedAt=? WHERE id=? AND status IN ('New','Contacted','Qualified','Proposal')").run(now(), d.leadId);
  return { ok: true };
}

/** The customer accepts a quotation from its public link. */
export function acceptQuote(token: string) {
  const d = documentByToken(token);
  if (!d || d.kind !== "quote") throw new AppError(404, "Quotation not found.");
  if (["Accepted", "Cancelled"].includes(d.status)) return d;
  sdb().prepare("UPDATE documents SET status='Accepted', updatedAt=? WHERE id=?").run(now(), d.id);
  if (d.leadId) sdb().prepare("UPDATE leads SET status='Negotiation', updatedAt=? WHERE id=? AND status IN ('New','Contacted','Qualified','Proposal')").run(now(), d.leadId);
  noteOnLead(d.leadId, `${d.customer.name} accepted quotation ${d.number} online. Convert it to an invoice.`);
  audit(d.customer.name, "quote.accepted", "document", d.id, { number: d.number });
  emit("quote.accepted", d.leadId, { number: d.number, total: d.total });
  return documentByToken(token)!;
}

export function convertToInvoice(user: User, id: string) {
  const q = getDocument(user, id);
  if (q.kind !== "quote") throw new AppError(400, "Only quotations can be converted.");
  const existing = sdb().prepare("SELECT id FROM documents WHERE sourceId=?").get(q.id) as { id: string } | undefined;
  if (existing) return getDocument(user, existing.id);
  const due = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
  const inv = createDocument(user, { kind: "invoice", leadId: q.leadId, customer: q.customer, items: q.items, notes: q.notes ?? "", dueDate: due });
  sdb().prepare("UPDATE documents SET sourceId=? WHERE id=?").run(q.id, inv.id);
  sdb().prepare("UPDATE documents SET status='Accepted', updatedAt=? WHERE id=? AND status!='Accepted'").run(now(), q.id);
  return getDocument(user, inv.id);
}

/** Records a payment (manual or from a gateway webhook); idempotent on `reference`. */
export function recordPayment(documentId: string, amount: number, method: string, reference: string | null, recordedBy: string | null) {
  return transaction(() => {
    if (reference && sdb().prepare("SELECT 1 FROM payments WHERE reference=?").get(reference)) return { duplicate: true };
    const d = sdb().prepare("SELECT * FROM documents WHERE id=?").get(documentId) as Record<string, any> | undefined;
    if (!d || d.kind !== "invoice") throw new AppError(404, "Invoice not found.");
    sdb().prepare("INSERT INTO payments VALUES(?,?,?,?,?,?,?)").run(randomUUID(), documentId, amount, method, reference, now(), recordedBy);
    const paid = round2(Number(d.paid) + amount);
    const status = paid >= Number(d.total) - 0.5 ? "Paid" : "Partially paid";
    sdb().prepare("UPDATE documents SET paid=?, status=?, updatedAt=? WHERE id=?").run(paid, status, now(), documentId);
    if (status === "Paid" && d.leadId) sdb().prepare("UPDATE leads SET status='Won', updatedAt=? WHERE id=? AND status!='Won'").run(now(), d.leadId);
    noteOnLead(d.leadId, `Payment of ₹${amount.toLocaleString("en-IN")} received on ${d.number} via ${method}. ${status}.`);
    audit(recordedBy ?? method, "payment.recorded", "document", documentId, { amount, method, reference });
    if (status === "Paid") emit("invoice.paid", d.leadId, { number: d.number, total: Number(d.total) });
    return { ok: true, status };
  });
}

export function addManualPayment(user: User, input: unknown) {
  const p = z.object({ id: z.string().uuid(), amount: z.number().positive(), method: z.string().trim().min(2).max(40), reference: z.string().trim().max(100).optional() }).parse(input);
  getDocument(user, p.id);
  return recordPayment(p.id, p.amount, p.method, p.reference || null, user.id);
}

export function paymentsFor(documentId: string) {
  return sdb().prepare("SELECT * FROM payments WHERE documentId=? ORDER BY paidAt").all(documentId) as { amount: number; method: string; reference: string | null; paidAt: string }[];
}

/** UPI deep link — works with every Indian UPI app, no gateway needed. */
export function upiLink(d: Doc) {
  const c = company();
  if (!c.upiId) return null;
  const due = round2(d.total - d.paid);
  return `upi://pay?${new URLSearchParams({ pa: c.upiId, pn: c.name, am: due.toFixed(2), cu: "INR", tn: d.number })}`;
}

export const gateways = () => ({ razorpay: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), stripe: !!process.env.STRIPE_SECRET_KEY });

/** Creates Razorpay / Stripe payment links for the outstanding amount, where configured. */
export async function createPaymentLinks(user: User, id: string, appUrl: string) {
  const d = getDocument(user, id);
  if (d.kind !== "invoice") throw new AppError(400, "Payment links are for invoices.");
  const due = round2(d.total - d.paid);
  if (due <= 0) throw new AppError(400, "This invoice is already paid.");
  const links = { ...(d.paymentLinks ?? {}) };
  const back = `${appUrl}/d/${d.token}`;
  const errors: string[] = [];
  if (gateways().razorpay) {
    const res = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(due * 100),
        currency: "INR",
        description: `${d.number} — ${company().name}`,
        reference_id: `${d.number}-${Date.now().toString(36)}`.slice(0, 40),
        customer: { name: d.customer.name, email: d.customer.email || undefined, contact: d.customer.phone || undefined },
        notify: { sms: false, email: false },
        notes: { documentId: d.id },
        callback_url: back,
        callback_method: "get",
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
    if (res.ok && j.id && j.short_url) links.razorpay = { id: j.id, url: j.short_url };
    else errors.push(`Razorpay: ${j.error?.description ?? `HTTP ${res.status}`}`);
  }
  if (gateways().stripe) {
    const form = new URLSearchParams({
      mode: "payment",
      success_url: back,
      cancel_url: back,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "inr",
      "line_items[0][price_data][unit_amount]": String(Math.round(due * 100)),
      "line_items[0][price_data][product_data][name]": `${d.number} — ${company().name}`,
      "metadata[documentId]": d.id,
      client_reference_id: d.id,
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
    if (res.ok && j.id && j.url) links.stripe = { id: j.id, url: j.url };
    else errors.push(`Stripe: ${j.error?.message ?? `HTTP ${res.status}`}`);
  }
  if (!gateways().razorpay && !gateways().stripe) errors.push("No payment gateway is configured. Customers can still pay by UPI from the invoice link.");
  sdb().prepare("UPDATE documents SET paymentLinks=?, updatedAt=? WHERE id=?").run(JSON.stringify(links), now(), d.id);
  return { links, errors };
}

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Razorpay webhook: X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret). */
export function handleRazorpayWebhook(raw: string, signature: string | null) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !safeEq(createHmac("sha256", secret).update(raw).digest("hex"), signature)) throw new AppError(401, "Bad signature.");
  const e = JSON.parse(raw) as { event?: string; payload?: any };
  if (e.event !== "payment_link.paid") return { ignored: true };
  const link = e.payload?.payment_link?.entity;
  const pay = e.payload?.payment?.entity;
  const docId = link?.notes?.documentId;
  if (!docId || !pay?.id) return { ignored: true };
  return recordPayment(docId, Number(pay.amount) / 100, "Razorpay", `razorpay:${pay.id}`, null);
}

/** Stripe webhook: Stripe-Signature "t=…,v1=…", v1 = HMAC-SHA256(`${t}.${raw}`, secret). */
export function handleStripeWebhook(raw: string, header: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const parts = Object.fromEntries((header ?? "").split(",").map((kv) => kv.split("=") as [string, string]));
  if (!secret || !parts.t || !parts.v1) throw new AppError(401, "Bad signature.");
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) throw new AppError(401, "Stale signature.");
  if (!safeEq(createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex"), parts.v1)) throw new AppError(401, "Bad signature.");
  const e = JSON.parse(raw) as { type?: string; data?: { object?: any } };
  const s = e.data?.object;
  if (e.type !== "checkout.session.completed" || s?.payment_status !== "paid" || !s?.metadata?.documentId) return { ignored: true };
  return recordPayment(s.metadata.documentId, Number(s.amount_total) / 100, "Stripe", `stripe:${s.id}`, null);
}

/** Emails the customer the public link to a quotation or invoice. */
export async function emailDocument(user: User, id: string, appUrl: string) {
  const d = getDocument(user, id);
  if (!d.customer.email) throw new AppError(400, "Add the customer's email first.");
  const c = company();
  const url = `${appUrl}/d/${d.token}`;
  const what = d.kind === "quote" ? "quotation" : "invoice";
  const r = await sendEmail({
    to: d.customer.email,
    subject: `${c.name} ${what} ${d.number}`,
    html: `<p>Dear ${esc(d.customer.name)},</p><p>Please find our ${what} <strong>${d.number}</strong> for <strong>₹${d.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>.</p><p><a href="${url}">View ${what}${d.kind === "invoice" ? " and pay online" : " and accept"}</a></p><p>Regards,<br>${esc(c.name)}${c.phone ? `<br>${esc(c.phone)}` : ""}</p>`,
    replyTo: user.email,
  });
  if (!r.success) throw new AppError(502, r.error || "Email could not be sent.");
  if (d.kind === "quote" && d.status === "Draft") sdb().prepare("UPDATE documents SET status='Sent', updatedAt=? WHERE id=?").run(now(), d.id);
  noteOnLead(d.leadId, `${what[0].toUpperCase() + what.slice(1)} ${d.number} emailed to ${d.customer.email}.`, user.id);
  return { ok: true, url };
}
export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// ─── Meetings (Jitsi by default, Zoom when configured) ───────────────────────

async function zoomLink(topic: string, startsAt: string, minutes: number) {
  const { ZOOM_ACCOUNT_ID: acc, ZOOM_CLIENT_ID: id, ZOOM_CLIENT_SECRET: secret } = process.env;
  if (!acc || !id || !secret) return null;
  const tok = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(acc)}`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
  }).then((r) => r.json() as Promise<{ access_token?: string }>);
  if (!tok.access_token) throw new AppError(502, "Zoom rejected the app credentials.");
  const m = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ topic, type: 2, start_time: startsAt, duration: minutes, timezone: "Asia/Kolkata" }),
  }).then((r) => r.json() as Promise<{ join_url?: string; message?: string }>);
  if (!m.join_url) throw new AppError(502, `Zoom: ${m.message ?? "could not create the meeting"}`);
  return m.join_url;
}

export async function scheduleMeeting(user: User, input: unknown) {
  const p = z
    .object({
      leadId: z.string().uuid(),
      title: z.string().trim().min(3).max(150),
      startsAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Choose a date and time"),
      minutes: z.number().int().min(10).max(480).default(30),
      provider: z.enum(["jitsi", "zoom"]).default("jitsi"),
      invite: z.boolean().default(true),
    })
    .parse(input);
  const lead = leadFor(user, p.leadId);
  const startsAt = new Date(p.startsAt).toISOString();
  const link =
    p.provider === "zoom"
      ? ((await zoomLink(p.title, startsAt, p.minutes)) ?? (() => { throw new AppError(400, "Zoom is not configured (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET)."); })())
      : `https://meet.jit.si/AutoNeural-${randomBytes(9).toString("base64url")}`;
  const owner = allUsers().find((u) => u.id === lead.ownerId) ?? user;
  const when = new Date(startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const taskId = randomUUID();
  transaction(() => {
    sdb().prepare("INSERT INTO meetings VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(), p.leadId, p.title, startsAt, p.minutes, p.provider, link, user.id, now());
    sdb()
      .prepare("INSERT INTO tasks(id,title,description,assigneeId,createdBy,status,priority,dueDate,project,createdAt,updatedAt,completedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)")
      .run(taskId, `Meeting: ${p.title}`.slice(0, 180), `${when} (${p.minutes} min) with ${lead.name}.\nJoin: ${link}`, owner.id, user.id, "To do", "High", new Date(Date.parse(startsAt) + 330 * 60_000).toISOString().slice(0, 10), "Leads", now(), now());
    sdb().prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(randomUUID(), taskId, user.id, `Scheduled a ${p.provider === "zoom" ? "Zoom" : "video"} meeting with ${lead.name}.`, now());
    if (owner.id !== user.id) recordTaskNotificationEmail({ type: "ASSIGNED", task: findTask(user, taskId), sender: user, recipient: owner });
  });
  if (owner.id !== user.id) void notifyTaskAssigned(findTask(user, taskId), owner, user);
  noteOnLead(p.leadId, `Meeting "${p.title}" scheduled for ${when}. Link: ${link}`, user.id);
  let invited = false;
  if (p.invite && lead.email) {
    const r = await sendEmail({
      to: lead.email,
      subject: `Meeting: ${p.title} — ${when}`,
      html: `<p>Hi ${esc(lead.name)},</p><p>You're invited to <strong>${esc(p.title)}</strong> on <strong>${when} IST</strong> (${p.minutes} minutes).</p><p><a href="${link}">Join the meeting</a></p><p>Regards,<br>${esc(user.name)}, ${esc(company().name)}</p>`,
      replyTo: user.email,
    });
    invited = r.success;
  }
  return { ok: true, link, invited };
}

export function meetingsFor(user: User, leadId: string) {
  leadFor(user, leadId);
  return sdb().prepare("SELECT * FROM meetings WHERE leadId=? ORDER BY startsAt DESC").all(leadId);
}

// ─── Campaigns (email and WhatsApp) ──────────────────────────────────────────

const segmentSchema = z.object({ statuses: z.array(z.string()).default([]), sources: z.array(z.string()).default([]) });
const campaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  channel: z.enum(["email", "whatsapp"]),
  segment: segmentSchema,
  subject: z.string().trim().max(200).optional().default(""),
  body: z.string().trim().max(10_000).optional().default(""),
  template: z.string().trim().max(120).optional().default(""),
});

function audience(segment: z.infer<typeof segmentSchema>, channel: "email" | "whatsapp") {
  const rows = sdb()
    .prepare("SELECT id,name,email,phone,status,source FROM leads WHERE status!='Duplicate' AND optOut=0")
    .all() as { id: string; name: string; email: string | null; phone: string | null; status: string; source: string }[];
  return rows.filter(
    (l) =>
      (!segment.statuses.length || segment.statuses.includes(l.status)) &&
      (!segment.sources.length || segment.sources.includes(l.source)) &&
      (channel === "email" ? !!l.email : !!l.phone),
  );
}

export function previewAudience(user: User, input: unknown) {
  requireAdmin(user);
  const p = z.object({ channel: z.enum(["email", "whatsapp"]), segment: segmentSchema }).parse(input);
  return { count: audience(p.segment, p.channel).length };
}

export const whatsappConfigured = () => !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

const signLead = (key: string, leadId: string) => createHmac("sha256", key).update(leadId).digest("base64url").slice(0, 22);

/** Signs unsubscribe links with the workspace secret (CRM_SECRET, or one generated and stored on first use). */
export const unsubscribeToken = (leadId: string) => signLead(appSecret(), leadId);

export function unsubscribe(leadId: string, token: string) {
  // Links sent before the workspace secret existed were signed with these values; keep honouring them.
  const legacy = [process.env.AGENT_INGEST_SECRET, process.env.CRM_APP_URL, "autoneural-unsubscribe"].filter(Boolean) as string[];
  const valid = [appSecret(), ...legacy].some((key) => safeEq(signLead(key, leadId), token));
  if (!valid) throw new AppError(400, "Invalid link.");
  sdb().prepare("UPDATE leads SET optOut=1 WHERE id=?").run(leadId);
}

/** Creates the campaign and sends it in the background; progress is visible on the campaign row. */
export function launchCampaign(user: User, input: unknown, appUrl: string) {
  requireAdmin(user);
  const p = campaignSchema.parse(input);
  if (p.channel === "email" && (!p.subject || !p.body)) throw new AppError(400, "Email campaigns need a subject and message.");
  if (p.channel === "whatsapp" && !p.template) throw new AppError(400, "WhatsApp campaigns need an approved template name.");
  if (p.channel === "whatsapp" && !whatsappConfigured()) throw new AppError(400, "WhatsApp is not connected (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID).");
  const people = audience(p.segment, p.channel);
  if (!people.length) throw new AppError(400, "No leads match this audience.");
  const id = randomUUID();
  sdb()
    .prepare("INSERT INTO campaigns(id,name,channel,segment,subject,body,template,status,total,createdBy,createdAt) VALUES(?,?,?,?,?,?,?,'Sending',?,?,?)")
    .run(id, p.name, p.channel, JSON.stringify(p.segment), p.subject, p.body, p.template, people.length, user.id, now());
  void (async () => {
    let sent = 0,
      failed = 0,
      lastError: string | null = null;
    for (const l of people) {
      try {
        const first = l.name.split(" ")[0];
        if (p.channel === "email") {
          const off = `${appUrl}/api/unsubscribe?l=${l.id}&t=${unsubscribeToken(l.id)}`;
          const r = await sendEmail({
            to: l.email!,
            subject: p.subject.replaceAll("{{name}}", first),
            html: `${esc(p.body.replaceAll("{{name}}", first)).replace(/\n/g, "<br>")}<p style="color:#888;font-size:12px;margin-top:24px">Don't want these emails? <a href="${off}">Unsubscribe</a>.</p>`,
            replyTo: user.email,
          });
          if (!r.success) throw new Error(r.error || "send failed");
        } else {
          const { sendTemplate } = await import("./whatsapp");
          await sendTemplate(null, { phone: l.phone!, name: l.name, leadId: l.id }, p.template, { params: p.body.includes("{{name}}") ? [first] : [], category: "marketing" });
        }
        sent++;
      } catch (e) {
        failed++;
        lastError = (e as Error).message;
      }
      sdb().prepare("UPDATE campaigns SET sent=?, failed=?, lastError=? WHERE id=?").run(sent, failed, lastError, id);
      await new Promise((r) => setTimeout(r, p.channel === "whatsapp" ? 250 : 150)); // stay under provider rate limits
    }
    sdb().prepare("UPDATE campaigns SET status='Sent', sentAt=? WHERE id=?").run(now(), id);
  })();
  return { ok: true, id, total: people.length };
}

export function listCampaigns(user: User) {
  requireAdmin(user);
  return sdb().prepare("SELECT * FROM campaigns ORDER BY createdAt DESC LIMIT 100").all();
}

// ─── Grievance / support tickets ─────────────────────────────────────────────

export const ticketStatuses = ["Open", "In progress", "Waiting on customer", "Resolved", "Closed"] as const;
const ticketSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional().default(""),
  email: z.string().trim().max(120).optional().default(""),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(5000),
  category: z.enum(["Complaint", "Service request", "Billing", "Feedback", "Other"]).default("Complaint"),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("Medium"),
  assigneeId: z.string().uuid().optional(),
});

export function createTicket(user: User | null, input: unknown) {
  const p = ticketSchema.parse(input);
  const phone = normalizePhone(p.phone);
  const lead = phone
    ? (sdb().prepare("SELECT id,ownerId FROM leads WHERE phone=? AND status!='Duplicate' ORDER BY number DESC LIMIT 1").get(phone) as { id: string; ownerId: string } | undefined)
    : undefined;
  const assignee = p.assigneeId ?? lead?.ownerId ?? (user?.role === "employee" ? user.id : null);
  const id = randomUUID();
  sdb()
    .prepare("INSERT INTO tickets(id,leadId,customerName,phone,email,subject,description,category,priority,status,assigneeId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,'Open',?,?,?)")
    .run(id, lead?.id ?? null, p.customerName, phone, p.email || null, p.subject, p.description, p.category, p.priority, assignee, now(), now());
  noteOnLead(lead?.id ?? null, `Grievance raised: ${p.subject}.`, user?.id);
  return { ok: true, id };
}

export function updateTicket(user: User, input: unknown) {
  const p = z
    .object({ id: z.string().uuid(), status: z.enum(ticketStatuses).optional(), assigneeId: z.string().uuid().nullable().optional(), note: z.string().trim().max(2000).optional() })
    .parse(input);
  const t = sdb().prepare("SELECT * FROM tickets WHERE id=?").get(p.id) as Record<string, any> | undefined;
  if (!t || (user.role !== "admin" && t.assigneeId !== user.id)) throw new AppError(404, "Ticket not found.");
  if (p.assigneeId && !allUsers().some((u) => u.id === p.assigneeId)) throw new AppError(400, "Choose an active teammate.");
  const updates = JSON.parse(t.updates) as { at: string; by: string; text: string }[];
  const changes = [
    p.status && p.status !== t.status ? `Status → ${p.status}` : "",
    p.assigneeId !== undefined && p.assigneeId !== t.assigneeId ? `Assigned to ${allUsers().find((u) => u.id === p.assigneeId)?.name ?? "nobody"}` : "",
    p.note ?? "",
  ].filter(Boolean);
  if (changes.length) updates.push({ at: now(), by: user.name, text: changes.join(". ") });
  const status = p.status ?? t.status;
  sdb()
    .prepare("UPDATE tickets SET status=?, assigneeId=?, updates=?, updatedAt=?, resolvedAt=? WHERE id=?")
    .run(status, p.assigneeId === undefined ? t.assigneeId : p.assigneeId, JSON.stringify(updates), now(), ["Resolved", "Closed"].includes(status) ? (t.resolvedAt ?? now()) : null, p.id);
  return { ok: true };
}

export function listTickets(user: User) {
  const admin = user.role === "admin";
  return (
    sdb()
      .prepare(`SELECT t.*, u.name AS assigneeName FROM tickets t LEFT JOIN users u ON u.id=t.assigneeId ${admin ? "" : "WHERE t.assigneeId=?"} ORDER BY t.number DESC LIMIT 500`)
      .all(...(admin ? [] : [user.id])) as Record<string, any>[]
  ).map((t) => ({ ...t, updates: JSON.parse(t.updates) }) as Record<string, any>);
}

// ─── Sales dashboard ─────────────────────────────────────────────────────────

export function salesSummary(user: User) {
  const admin = user.role === "admin";
  const scope = admin ? "" : "AND ownerId=?";
  const args = admin ? [] : [user.id];
  // Salespeople see totals for their own documents and tickets only, matching what their lists show.
  const doc = docScope(user);
  const docs = `FROM documents d LEFT JOIN leads l ON l.id=d.leadId WHERE ${doc.where}`;
  const q = <T>(sql: string, ...a: unknown[]) => sdb().prepare(sql).get(...(a as never[])) as T;
  const t = today();
  return {
    stages: sdb().prepare(`SELECT status, COUNT(*) AS n, COALESCE(SUM(value),0) AS value FROM leads WHERE status!='Duplicate' ${scope} GROUP BY status`).all(...args),
    followUpsDue: q<{ n: number }>(`SELECT COUNT(*) AS n FROM leads WHERE nextFollowUp<=? AND status NOT IN ('Won','Lost','Duplicate') ${scope}`, t, ...args).n,
    quotesOpen: q<{ n: number; v: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(d.total),0) AS v ${docs} AND d.kind='quote' AND d.status IN ('Draft','Sent')`, ...doc.args),
    outstanding: q<{ n: number; v: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(d.total-d.paid),0) AS v ${docs} AND d.kind='invoice' AND d.status IN ('Unpaid','Partially paid')`, ...doc.args),
    overdue: q<{ n: number; v: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(d.total-d.paid),0) AS v ${docs} AND d.kind='invoice' AND d.status IN ('Unpaid','Partially paid') AND d.dueDate<?`, ...doc.args, t),
    collectedThisMonth: q<{ v: number }>(`SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p JOIN documents d ON d.id=p.documentId LEFT JOIN leads l ON l.id=d.leadId WHERE ${doc.where} AND p.paidAt>=?`, ...doc.args, `${t.slice(0, 7)}-01`).v,
    openTickets: q<{ n: number }>(`SELECT COUNT(*) AS n FROM tickets WHERE status NOT IN ('Resolved','Closed') ${admin ? "" : "AND assigneeId=?"}`, ...args).n,
  };
}
