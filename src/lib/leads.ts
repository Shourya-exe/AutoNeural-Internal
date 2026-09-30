import { randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, transaction, findTask, allUsers, requireAdmin, AppError, recordTaskNotificationEmail } from "./store";
import { notifyTaskAssigned } from "./email";
import { MASTER_ADMIN_EMAIL, type User } from "./types";
import { emit } from "./platform";

/**
 * Automatic lead intake for the main workspace.
 *
 * Every lead — from the website form, Zapier/Make/Meta, a Google Sheet or
 * IndiaMART — lands here, is de-duplicated, given an owner (round-robin over the
 * chosen salespeople) and immediately becomes a "Call …" task in that person's
 * task list, so it is worked through the workflow the team already uses.
 */

export const leadStatuses = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"] as const;
export type LeadStatus = (typeof leadStatuses)[number];
export type Lead = {
  id: string;
  number: number;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  service: string | null;
  message: string | null;
  city: string | null;
  source: string;
  sourceDetail: string | null;
  status: LeadStatus;
  ownerId: string | null;
  ownerName: string | null;
  taskId: string | null;
  taskNumber: number | null;
  value: number | null;
  nextFollowUp: string | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
};
export type LeadInput = {
  externalId: string;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  service?: string;
  message?: string;
  city?: string;
  sourceDetail?: string;
};
export type LeadSource = "Website / API" | "Google Sheet" | "IndiaMART" | "Manual" | "AI call" | "WhatsApp" | "Facebook";

let ready = false;
export function ldb() {
  const c = db();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS leads(number INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,externalId TEXT UNIQUE NOT NULL,name TEXT NOT NULL,phone TEXT,email TEXT,company TEXT,service TEXT,message TEXT,city TEXT,source TEXT NOT NULL,sourceDetail TEXT,status TEXT NOT NULL DEFAULT 'New',ownerId TEXT REFERENCES users(id),taskId TEXT REFERENCES tasks(id) ON DELETE SET NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone);
      CREATE INDEX IF NOT EXISTS leads_email ON leads(email);
      CREATE INDEX IF NOT EXISTS leads_owner ON leads(ownerId,createdAt);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    // Pipeline fields (added after the first release).
    for (const col of ["value REAL", "lostReason TEXT", "nextFollowUp TEXT", "optOut INTEGER NOT NULL DEFAULT 0"]) {
      try {
        c.exec(`ALTER TABLE leads ADD COLUMN ${col}`);
      } catch {}
    }
    ready = true;
  }
  return c;
}

export function getSetting<T>(key: string): T | null {
  const row = ldb().prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}
export function setSetting(key: string, value: unknown) {
  ldb()
    .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, JSON.stringify(value));
}

const now = () => new Date().toISOString();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** Canonical Indian mobile (+91XXXXXXXXXX); other numbers keep their digits with a leading +. */
export function normalizePhone(raw?: string | null) {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `+91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return d.length >= 7 ? `+${d}` : null;
}

// ─── Field matching (shared with crm/server/integrations/lead-sources.ts) ────

const ALIASES = {
  name: ["name", "fullname", "leadname", "contactname", "customername", "firstname", "sendername", "clientname", "yourname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "mobileno", "whatsapp", "whatsappnumber", "contactnumber", "sendermobile", "contactno", "phoneno", "tel"],
  email: ["email", "emailaddress", "emailid", "mail", "senderemail", "youremail"],
  company: ["company", "companyname", "business", "businessname", "organisation", "organization", "sendercompany", "firm"],
  service: ["service", "interest", "interestedin", "product", "productname", "requirement", "queryproductname", "course", "subject", "category", "productsearched"],
  message: ["message", "comments", "comment", "notes", "enquiry", "inquiry", "querymessage", "remarks", "question", "yourmessage"],
  city: ["city", "location", "sendercity", "town"],
} as const;
const normKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map any row/payload (header → value) onto lead fields; null when it has no phone or email. */
export function mapRowToLead(row: Record<string, unknown>): Omit<LeadInput, "externalId"> | null {
  const byKey = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    const value = v == null || typeof v === "object" ? "" : String(v).trim();
    if (value) byKey.set(normKey(k), value);
  }
  const pick = (field: keyof typeof ALIASES) => {
    for (const alias of ALIASES[field]) {
      const v = byKey.get(alias);
      if (v) return v.slice(0, field === "message" ? 4000 : 200);
    }
    return undefined;
  };
  // Facebook lead exports write phones as "p:+919876543210".
  const phone = pick("phone")?.replace(/^p:/i, "");
  const email = pick("email")?.toLowerCase();
  if (!phone && !email) return null;
  const first = pick("name");
  const last = byKey.get("lastname");
  return {
    name: (first && last && !first.includes(last) ? `${first} ${last}` : first) || phone || email!,
    phone,
    email,
    company: pick("company"),
    service: pick("service"),
    message: pick("message"),
    city: pick("city"),
  };
}

// ─── Core: add leads ─────────────────────────────────────────────────────────

export function systemActor(): User {
  const users = allUsers();
  const actor =
    users.find((u) => u.email.toLowerCase() === MASTER_ADMIN_EMAIL) ?? users.find((u) => u.role === "admin");
  if (!actor) throw new AppError(503, "Set up the workspace admin before receiving leads.");
  return actor;
}

/** People on approved leave today (HR module); they get no new leads. */
export function onLeaveToday(): Set<string> {
  try {
    const day = istToday();
    return new Set(
      (ldb().prepare("SELECT userId FROM leaves WHERE status='Approved' AND fromDate<=? AND toDate>=?").all(day, day) as { userId: string }[]).map(
        (r) => r.userId,
      ),
    );
  } catch {
    return new Set(); // leaves table not created yet
  }
}

/** Least-recently-assigned active salesperson who is not on leave; falls back to the master admin. */
export function nextOwner(actor: User, exclude: Set<string> = onLeaveToday()): User {
  const chosen = getSetting<string[]>("lead_owners") ?? [];
  const pool = allUsers().filter(
    (u) => u.status !== "INACTIVE" && !exclude.has(u.id) && (chosen.length ? chosen.includes(u.id) : u.role === "employee"),
  );
  if (!pool.length) return actor;
  const last = new Map(
    (ldb().prepare("SELECT ownerId, MAX(number) AS n FROM leads GROUP BY ownerId").all() as { ownerId: string; n: number }[]).map(
      (r) => [r.ownerId, r.n],
    ),
  );
  return pool.sort((a, b) => (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0))[0];
}

function describe(l: LeadInput, source: string) {
  return [
    `New lead from ${l.sourceDetail || source}. Call within 5 minutes — speed wins deals.`,
    "",
    `Name: ${l.name}`,
    l.phone && `Phone: ${l.phone}  (WhatsApp: https://wa.me/${l.phone.replace(/\D/g, "")})`,
    l.email && `Email: ${l.email}`,
    l.company && `Company: ${l.company}`,
    l.city && `City: ${l.city}`,
    l.service && `Interested in: ${l.service}`,
    l.message && `\nMessage:\n${l.message}`,
  ]
    .filter((x) => x !== undefined && x !== null && x !== "")
    .join("\n");
}

/**
 * Stores new leads and creates a call task for each one. Idempotent on externalId;
 * a repeat enquiry from the same phone/email within 30 days is added as a comment
 * on the existing lead's task instead of creating a duplicate.
 */
export function addLeads(inputs: LeadInput[], source: LeadSource) {
  const actor = systemActor();
  let created = 0,
    duplicates = 0;
  const createdLeads: { id: string; taskId: string; owner: User }[] = [];
  for (const raw of inputs) {
    const l = { ...raw, phone: normalizePhone(raw.phone) ?? undefined, email: raw.email?.toLowerCase() || undefined };
    if (!l.phone && !l.email) continue;
    const result = transaction(() => {
      const c = ldb();
      if (c.prepare("SELECT 1 FROM leads WHERE externalId=?").get(l.externalId)) return "dup";
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const existing = c
        .prepare(
          "SELECT id, taskId FROM leads WHERE status!='Duplicate' AND createdAt>=? AND ((phone IS NOT NULL AND phone=?) OR (email IS NOT NULL AND email=?)) ORDER BY number DESC LIMIT 1",
        )
        .get(since, l.phone ?? null, l.email ?? null) as { id: string; taskId: string | null } | undefined;
      if (existing) {
        // Remember the externalId so the same row/record is not re-processed.
        c.prepare(
          "INSERT INTO leads(id,externalId,name,phone,email,company,service,message,city,source,sourceDetail,status,ownerId,taskId,createdAt,updatedAt) SELECT ?,?,name,phone,email,company,service,message,city,source,sourceDetail,'Duplicate',ownerId,NULL,createdAt,? FROM leads WHERE id=?",
        ).run(randomUUID(), l.externalId, now(), existing.id);
        if (existing.taskId) {
          c.prepare("INSERT INTO comments VALUES(?,?,?,?,?)").run(
            randomUUID(),
            existing.taskId,
            actor.id,
            `Enquired again via ${l.sourceDetail || source}${l.service ? ` about ${l.service}` : ""}.${l.message ? `\n"${l.message}"` : ""}`,
            now(),
          );
          c.prepare("UPDATE tasks SET updatedAt=?, version=version+1 WHERE id=?").run(now(), existing.taskId);
        }
        return "dup";
      }
      const owner = nextOwner(actor);
      const taskId = randomUUID(),
        leadId = randomUUID(),
        time = now();
      c.prepare(
        "INSERT INTO tasks(id,title,description,assigneeId,createdBy,status,priority,dueDate,project,createdAt,updatedAt,completedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)",
      ).run(
        taskId,
        `Call ${l.name}${l.service ? ` — ${l.service}` : ""}`.slice(0, 180),
        describe(l, source).slice(0, 6000),
        owner.id,
        actor.id,
        "To do",
        "High",
        istToday(),
        "Leads",
        time,
        time,
      );
      c.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(
        randomUUID(),
        taskId,
        actor.id,
        `New lead from ${l.sourceDetail || source} auto-assigned to ${owner.name}.`,
        time,
      );
      c.prepare(
        "INSERT INTO leads(id,externalId,name,phone,email,company,service,message,city,source,sourceDetail,status,ownerId,taskId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,'New',?,?,?,?)",
      ).run(
        leadId,
        l.externalId,
        l.name.slice(0, 200),
        l.phone ?? null,
        l.email ?? null,
        l.company ?? null,
        l.service ?? null,
        l.message ?? null,
        l.city ?? null,
        source,
        l.sourceDetail ?? null,
        owner.id,
        taskId,
        time,
        time,
      );
      if (owner.id !== actor.id) {
        recordTaskNotificationEmail({ type: "ASSIGNED", task: findTask(actor, taskId), sender: actor, recipient: owner });
      }
      return { id: leadId, taskId, owner };
    });
    if (result === "dup") duplicates++;
    else {
      created++;
      createdLeads.push(result);
    }
  }
  for (const c of createdLeads) {
    if (c.owner.id !== actor.id) void notifyTaskAssigned(findTask(actor, c.taskId), c.owner, actor);
    emit("lead.created", c.id, { source });
  }
  return { created, duplicates, leadIds: createdLeads.map((c) => c.id) };
}

// ─── Reading and updating ────────────────────────────────────────────────────

export function listLeads(user: User, limit = 500): Lead[] {
  const admin = user.role === "admin";
  return ldb()
    .prepare(
      `SELECT l.*, u.name AS ownerName, t.number AS taskNumber FROM leads l LEFT JOIN users u ON u.id=l.ownerId LEFT JOIN tasks t ON t.id=l.taskId WHERE l.status!='Duplicate' ${admin ? "" : "AND l.ownerId=?"} ORDER BY l.number DESC LIMIT ?`,
    )
    .all(...(admin ? [limit] : [user.id, limit])) as unknown as Lead[];
}

export function updateLead(user: User, input: unknown) {
  const p = z.object({ id: z.string().uuid(), status: z.enum(leadStatuses) }).parse(input);
  const lead = ldb().prepare("SELECT ownerId FROM leads WHERE id=?").get(p.id) as { ownerId: string } | undefined;
  if (!lead || (user.role !== "admin" && lead.ownerId !== user.id)) throw new AppError(404, "Lead not found.");
  const before = (ldb().prepare("SELECT status FROM leads WHERE id=?").get(p.id) as { status: string }).status;
  ldb().prepare("UPDATE leads SET status=?, updatedAt=? WHERE id=?").run(p.status, now(), p.id);
  if (before !== p.status) emit("lead.stage_changed", p.id, { from: before, to: p.status, by: user.name });
  return { ok: true };
}

export function addManualLead(user: User, input: unknown) {
  const row = z.record(z.unknown()).parse(input);
  const lead = mapRowToLead(row);
  if (!lead) throw new AppError(400, "Enter a phone number or email.");
  return addLeads([{ ...lead, externalId: `manual:${randomUUID()}`, sourceDetail: `Added by ${user.name}` }], "Manual");
}

// ─── Intake API key ──────────────────────────────────────────────────────────

type KeyRecord = { hash: string; prefix: string; createdAt: string };

export function rotateIntakeKey(user: User) {
  requireAdmin(user);
  const key = `anl_${randomBytes(24).toString("base64url")}`;
  setSetting("lead_api_key", { hash: sha(key), prefix: key.slice(0, 10), createdAt: now() } satisfies KeyRecord);
  return key;
}

export function revokeIntakeKey(user: User) {
  requireAdmin(user);
  ldb().prepare("DELETE FROM settings WHERE key='lead_api_key'").run();
}

export function checkIntakeKey(key: string | null | undefined) {
  const rec = getSetting<KeyRecord>("lead_api_key");
  if (!rec || !key) return false;
  const a = Buffer.from(sha(key), "hex"),
    b = Buffer.from(rec.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─── Pulled sources: Google Sheets / CSV and IndiaMART ───────────────────────

type SheetFeed = { id: string; label: string; url: string; lastPulledAt?: string; lastCount?: number; lastError?: string | null };
type IndiaMart = { apiKey: string; lastPulledAt?: string; lastAttemptAt?: string; lastCount?: number; lastError?: string | null };

const SHEET_INTERVAL_MS = 2 * 60_000;
// IndiaMART: ≥5 minutes between calls (more than 5/minute blocks the key for 15 minutes);
// they recommend 10–15. https://help.indiamart.com/knowledge-base/lms-crm-integration-v2
const INDIAMART_INTERVAL_MS = 10 * 60_000;
const INDIAMART_FLOOR_MS = 5 * 60_000;
const INDIAMART_WINDOW_MS = 7 * 86_400_000;

export function toCsvUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError(400, "Enter a valid link.");
  }
  if (url.protocol !== "https:") throw new AppError(400, "Only https:// links are supported.");
  // ponytail: literal-host check only; add DNS-resolution checks if non-admins can add feeds.
  const h = url.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) ||
    h.startsWith("[")
  ) {
    throw new AppError(400, "That address is not reachable.");
  }
  const m = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (h === "docs.google.com" && m && m[1] !== "e") {
    const gid = url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1] ?? "0";
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
  }
  if (h === "docs.google.com" && url.pathname.includes("/pub")) url.searchParams.set("output", "csv");
  return url.toString();
}

/** RFC 4180 CSV → rows (quoted fields, "" escapes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function csvToLeads(csv: string, feed: { url: string; label: string }): LeadInput[] {
  const [header, ...body] = parseCsv(csv);
  if (!header) return [];
  const feedKey = sha(feed.url).slice(0, 12);
  return body.slice(0, 5000).flatMap((cells) => {
    const lead = mapRowToLead(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
    // The id comes from the mapped fields only, so editing a "Status" column the team keeps doesn't re-import.
    return lead ? [{ ...lead, externalId: `sheet:${feedKey}:${sha(JSON.stringify(lead)).slice(0, 24)}`, sourceDetail: `Sheet: ${feed.label}` }] : [];
  });
}

const ID_KEYS = ["rfi_id", "rfiid", "leadid", "lead_id", "queryid", "query_id", "inquiryid", "inquiry_id", "enquiryid", "enquiry_id", "unique_query_id", "id"];

/**
 * JSON lead feeds (TradeIndia "My Inquiry API", ExportersIndia and similar portal APIs):
 * an array of records, or an object holding one. Fields are matched by the same aliases.
 */
export function jsonToLeads(text: string, feed: { url: string; label: string }): LeadInput[] {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data)
    ? data
    : (Object.values((data ?? {}) as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ?? [];
  const feedKey = sha(feed.url.replace(/[?&](from_date|to_date)=[^&]*/g, "")).slice(0, 12);
  return list.slice(0, 5000).flatMap((rec) => {
    if (!rec || typeof rec !== "object") return [];
    const row = rec as Record<string, unknown>;
    const lead = mapRowToLead(row);
    if (!lead) return [];
    const idKey = ID_KEYS.find((k) => row[k] != null && String(row[k]).trim());
    const id = idKey ? String(row[idKey]) : sha(JSON.stringify(lead)).slice(0, 24);
    return [{ ...lead, externalId: `feed:${feedKey}:${id}`, sourceDetail: feed.label }];
  });
}

/** Portal APIs take a date range; keep it on yesterday → today so each pull sees new enquiries. */
function withFreshDates(url: string) {
  const u = new URL(url);
  const d = (offset: number) => new Date(Date.now() + 330 * 60_000 - offset * 86_400_000).toISOString().slice(0, 10);
  if (u.searchParams.has("from_date")) u.searchParams.set("from_date", d(1));
  if (u.searchParams.has("to_date")) u.searchParams.set("to_date", d(0));
  return u.toString();
}

async function pullSheets(force: boolean, fetchImpl: typeof fetch) {
  const feeds = getSetting<SheetFeed[]>("lead_sheets") ?? [];
  let created = 0,
    duplicates = 0;
  const errors: string[] = [];
  for (const f of feeds) {
    if (!force && f.lastPulledAt && Date.now() - Date.parse(f.lastPulledAt) < SHEET_INTERVAL_MS) continue;
    f.lastPulledAt = now();
    try {
      const res = await fetchImpl(withFreshDates(f.url), { signal: AbortSignal.timeout(20_000), redirect: "follow" });
      if (!res.ok) throw new Error(`the sheet returned HTTP ${res.status}. Share it as "Anyone with the link can view".`);
      if ((res.headers.get("content-type") ?? "").includes("text/html")) {
        throw new Error('the link opened a web page, not CSV. Share the sheet as "Anyone with the link can view".');
      }
      const text = await res.text();
      const r = addLeads(/^\s*[[{]/.test(text) ? jsonToLeads(text, f) : csvToLeads(text, f), "Google Sheet");
      created += r.created;
      duplicates += r.duplicates;
      f.lastCount = r.created;
      f.lastError = null;
    } catch (e) {
      f.lastError = `${f.label}: ${(e as Error).message}`;
      errors.push(f.lastError);
    }
  }
  // Re-read before saving so a feed added/removed meanwhile is not lost.
  const latest = getSetting<SheetFeed[]>("lead_sheets") ?? [];
  setSetting("lead_sheets", latest.map((f) => feeds.find((x) => x.id === f.id) ?? f));
  return { created, duplicates, error: errors[0] };
}

const IM_TYPES: Record<string, string> = { W: "Direct enquiry", B: "Buy-lead", P: "PNS call", BIZ: "Catalog view", WA: "WhatsApp enquiry" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** IST, e.g. "05-Sep-202614:30:00" — the format IndiaMART's pull API expects. */
export function indiamartTime(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(ist.getUTCDate())}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()}${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`;
}

export function indiamartToLead(r: Record<string, unknown>): LeadInput | null {
  const s = (k: string) => (r[k] == null ? undefined : String(r[k]).trim() || undefined);
  const id = s("UNIQUE_QUERY_ID");
  const phone = s("SENDER_MOBILE") ?? s("SENDER_MOBILE_ALT");
  const email = s("SENDER_EMAIL") ?? s("SENDER_EMAIL_ALT");
  if (!id || (!phone && !email)) return null;
  const type = s("QUERY_TYPE");
  return {
    externalId: `indiamart:${id}`,
    name: s("SENDER_NAME") ?? phone ?? email!,
    phone,
    email,
    company: s("SENDER_COMPANY"),
    service: s("QUERY_PRODUCT_NAME"),
    message: [s("QUERY_SUBJECT"), s("QUERY_MESSAGE")].filter(Boolean).join("\n") || undefined,
    city: [s("SENDER_CITY"), s("SENDER_STATE")].filter(Boolean).join(", ") || undefined,
    sourceDetail: `IndiaMART · ${(type && IM_TYPES[type]) || "Enquiry"}`,
  };
}

type PullResult = { created: number; duplicates: number; error?: string; skipped?: boolean };

async function pullIndiaMart(force: boolean, fetchImpl: typeof fetch, at = new Date()): Promise<PullResult> {
  const cfg = getSetting<IndiaMart>("lead_indiamart");
  if (!cfg) return { created: 0, duplicates: 0 };
  const since = cfg.lastAttemptAt ? at.getTime() - Date.parse(cfg.lastAttemptAt) : Infinity;
  if (since < INDIAMART_FLOOR_MS || (!force && since < INDIAMART_INTERVAL_MS)) return { created: 0, duplicates: 0, skipped: true };
  cfg.lastAttemptAt = at.toISOString();
  setSetting("lead_indiamart", cfg);
  // 5-minute overlap so records that land late are not missed; dedupe makes it safe.
  const start = cfg.lastPulledAt
    ? Math.max(Date.parse(cfg.lastPulledAt) - 5 * 60_000, at.getTime() - INDIAMART_WINDOW_MS + 60_000)
    : at.getTime() - INDIAMART_WINDOW_MS + 60_000;
  const url = new URL("https://mapi.indiamart.com/wservce/crm/crmListing/v2/");
  url.searchParams.set("glusr_crm_key", cfg.apiKey);
  url.searchParams.set("start_time", indiamartTime(new Date(start)));
  url.searchParams.set("end_time", indiamartTime(at));
  let result: PullResult = { created: 0, duplicates: 0 };
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    const body = (await res.json().catch(() => ({}))) as { CODE?: number; MESSAGE?: string; RESPONSE?: unknown };
    if (res.status === 429 || body.CODE === 429) throw new Error("IndiaMART is rate-limiting this key; the next pull will retry.");
    if (body.CODE === 401 || res.status === 401) throw new Error("IndiaMART rejected the API key. Generate a new one in Lead Manager → CRM Integration.");
    if (body.CODE !== 200 && body.CODE !== 204) throw new Error(`IndiaMART error: ${body.MESSAGE ?? `HTTP ${res.status}`}`);
    const records = Array.isArray(body.RESPONSE) ? (body.RESPONSE as Record<string, unknown>[]) : [];
    const leads = records.map(indiamartToLead).filter((l): l is LeadInput => !!l);
    result = addLeads(leads, "IndiaMART");
    cfg.lastPulledAt = at.toISOString();
    cfg.lastCount = result.created;
    cfg.lastError = null;
  } catch (e) {
    cfg.lastError = (e as Error).message;
    result.error = cfg.lastError;
  }
  const latest = getSetting<IndiaMart>("lead_indiamart");
  if (latest?.apiKey === cfg.apiKey) setSetting("lead_indiamart", cfg);
  return result;
}

let pulling: Promise<unknown> | null = null;
/** Pull every connected source. Safe to call often: each source throttles itself and runs are never concurrent. */
export function pullLeadSources(opts: { force?: boolean; fetchImpl?: typeof fetch; now?: Date } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  pulling ??= (async () => {
    try {
      const sheets = await pullSheets(!!opts.force, fetchImpl);
      const indiamart = await pullIndiaMart(!!opts.force, fetchImpl, opts.now);
      return { sheets, indiamart };
    } finally {
      pulling = null;
    }
  })();
  return pulling as Promise<{ sheets: Awaited<ReturnType<typeof pullSheets>>; indiamart: Awaited<ReturnType<typeof pullIndiaMart>> }>;
}

// ─── Admin configuration ─────────────────────────────────────────────────────

export function leadSourceSettings(user: User) {
  requireAdmin(user);
  const key = getSetting<KeyRecord>("lead_api_key");
  const im = getSetting<IndiaMart>("lead_indiamart");
  return {
    apiKey: key ? { prefix: key.prefix, createdAt: key.createdAt } : null,
    sheets: (getSetting<SheetFeed[]>("lead_sheets") ?? []).map(({ url, ...f }) => ({ ...f, host: new URL(url).host })),
    indiamart: im ? { lastPulledAt: im.lastPulledAt ?? null, lastCount: im.lastCount ?? null, lastError: im.lastError ?? null } : null,
    owners: getSetting<string[]>("lead_owners") ?? [],
  };
}

export async function addSheetFeed(user: User, input: unknown) {
  requireAdmin(user);
  const p = z.object({ label: z.string().trim().min(1).max(60), url: z.string() }).parse(input);
  const url = toCsvUrl(p.url);
  const feeds = getSetting<SheetFeed[]>("lead_sheets") ?? [];
  if (feeds.length >= 20) throw new AppError(400, "Up to 20 sheets are supported.");
  if (feeds.some((f) => f.url === url)) throw new AppError(409, "This sheet is already connected.");
  setSetting("lead_sheets", [...feeds, { id: randomBytes(6).toString("hex"), label: p.label, url }]);
  return (await pullLeadSources({ force: true })).sheets;
}

export function removeSheetFeed(user: User, id: string) {
  requireAdmin(user);
  setSetting("lead_sheets", (getSetting<SheetFeed[]>("lead_sheets") ?? []).filter((f) => f.id !== id));
}

export async function connectIndiaMart(user: User, apiKey: unknown) {
  requireAdmin(user);
  // A new key restarts the cursor, so the last 7 days are backfilled.
  setSetting("lead_indiamart", { apiKey: z.string().trim().min(10).max(200).parse(apiKey) } satisfies IndiaMart);
  return (await pullLeadSources({ force: true })).indiamart;
}

export function disconnectIndiaMart(user: User) {
  requireAdmin(user);
  ldb().prepare("DELETE FROM settings WHERE key='lead_indiamart'").run();
}

export function setLeadOwners(user: User, ids: unknown) {
  requireAdmin(user);
  const valid = new Set(allUsers().map((u) => u.id));
  setSetting("lead_owners", z.array(z.string()).parse(ids).filter((id) => valid.has(id)));
}
